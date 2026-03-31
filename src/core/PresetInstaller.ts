import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { parse as parseTOML, stringify as stringifyTOML } from '@iarna/toml';
import {
  createSourceWorkspace,
  type SourceWorkspace,
} from './AgentSourceCompatibility';
import {
  deepMergeConfig,
  isPlainRecord,
  stripSymbols,
  withoutSync,
} from './ConfigLoader';
import { matchesPattern } from './FileSystemUtils';
import { CANONICAL_SKILLER_DIR, SKILLER_CONFIG_FILE } from './project-paths';

const PRESET_CONFIG_FILENAME = 'preset.toml';
const PRESET_MANIFEST_RELATIVE_PATH = path
  .join(CANONICAL_SKILLER_DIR, '.skiller-preset-manifest.json')
  .replace(/\\/g, '/');

const HARD_DENY_PATTERNS = [
  '.agents/skills/**',
  '.claude/skills/**',
  PRESET_MANIFEST_RELATIVE_PATH,
  '.agents/.skiller-sync-manifest.json',
  '.git/**',
  'node_modules/**',
];

const COPY_EXCEPTIONS = new Set(['.agents/skiller.toml']);

interface PresetManifest {
  version: 1;
  source: string;
  preset: string;
  files: Record<string, string>;
}

export interface PresetInstallResult {
  preset: string;
  presetRoot: string;
  removed: string[];
  synced: string[];
}

interface PresetConfig {
  include: string[];
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/');
}

function isLikelyLocalPath(input: string): boolean {
  return (
    path.isAbsolute(input) ||
    input.startsWith('./') ||
    input.startsWith('../') ||
    input === '.' ||
    input === '..' ||
    /^[a-zA-Z]:[/\\]/.test(input)
  );
}

function hashBuffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readPresetManifest(
  projectRoot: string,
): Promise<PresetManifest | null> {
  try {
    return JSON.parse(
      await fs.readFile(
        path.join(projectRoot, PRESET_MANIFEST_RELATIVE_PATH),
        'utf8',
      ),
    ) as PresetManifest;
  } catch {
    return null;
  }
}

async function writePresetManifest(
  projectRoot: string,
  manifest: PresetManifest,
): Promise<void> {
  const manifestPath = path.join(projectRoot, PRESET_MANIFEST_RELATIVE_PATH);
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}

async function removeEmptyDirectoriesUpward(
  fromDir: string,
  stopDir: string,
): Promise<void> {
  let current = fromDir;
  const normalizedStop = path.resolve(stopDir);

  while (path.resolve(current).startsWith(normalizedStop)) {
    if (path.resolve(current) === normalizedStop) return;

    try {
      const entries = await fs.readdir(current);
      if (entries.length > 0) return;
      await fs.rmdir(current);
    } catch {
      return;
    }

    current = path.dirname(current);
  }
}

async function collectPresetFiles(rootDir: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;

      const fullPath = path.join(currentDir, entry.name);
      const relativePath = normalizeRelativePath(
        path.relative(rootDir, fullPath),
      );

      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      if (entry.isFile()) {
        results.push(relativePath);
      }
    }
  }

  await walk(rootDir);
  return results.sort((a, b) => a.localeCompare(b));
}

async function collectFileFromPath(targetPath: string): Promise<string> {
  const stats = await fs.stat(targetPath);

  if (stats.isFile()) {
    return targetPath;
  }

  throw new Error(
    `[skiller] Included path '${targetPath}' must resolve to a file, not a directory.`,
  );
}

function isHardDenied(relativePath: string): boolean {
  return HARD_DENY_PATTERNS.some((pattern) =>
    matchesPattern(relativePath, pattern),
  );
}

function isPresetAllowlisted(relativePath: string): boolean {
  if (
    relativePath === 'skills-lock.json' ||
    relativePath === 'skiller-lock.json'
  ) {
    return true;
  }

  return (
    relativePath.startsWith('.agents/') ||
    relativePath.startsWith('.claude/') ||
    relativePath.startsWith('.codex/')
  );
}

async function readRawTomlFile(
  filePath: string,
): Promise<Record<string, unknown>> {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    const parsed = text.trim() ? parseTOML(text) : {};
    const stripped = stripSymbols(parsed);
    return isPlainRecord(stripped) ? stripped : {};
  } catch {
    return {};
  }
}

async function readPresetConfig(presetRoot: string): Promise<PresetConfig> {
  const configPath = path.join(presetRoot, PRESET_CONFIG_FILENAME);
  const raw = await readRawTomlFile(configPath);

  if (Object.keys(raw).length === 0) {
    return { include: [] };
  }

  if (raw.version !== undefined && raw.version !== 1) {
    throw new Error(
      `[skiller] ${PRESET_CONFIG_FILENAME} in '${presetRoot}' must use version = 1.`,
    );
  }

  if (raw.include !== undefined && !Array.isArray(raw.include)) {
    throw new Error(
      `[skiller] ${PRESET_CONFIG_FILENAME} in '${presetRoot}' must set include = ["path", ...].`,
    );
  }

  return {
    include: Array.isArray(raw.include)
      ? raw.include.map((entry) => String(entry))
      : [],
  };
}

function deriveTargetRelativePath(sourcePath: string): string | null {
  const segments = normalizeRelativePath(path.resolve(sourcePath)).split('/');
  const specialFileNames = new Set(['skills-lock.json', 'skiller-lock.json']);

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;

    if (
      segment === '.agents' ||
      segment === '.claude' ||
      segment === '.codex'
    ) {
      return segments.slice(index).join('/');
    }

    if (specialFileNames.has(segment) && index === segments.length - 1) {
      return segment;
    }
  }

  return null;
}

async function looksLikePresetRoot(dirPath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(path.join(dirPath, '.agents'));
    return stats.isDirectory();
  } catch {
    return false;
  }
}

async function resolvePresetRoot(
  workspace: SourceWorkspace,
  presetName?: string,
): Promise<{ preset: string; presetRoot: string }> {
  const { searchPath } = workspace;

  const namedCandidates = presetName
    ? [
        path.join(searchPath, 'presets', presetName),
        path.join(searchPath, presetName),
        path.join(searchPath, '.agents', 'presets', presetName),
      ]
    : [];

  if (presetName) {
    if (
      path.basename(searchPath) === presetName &&
      (await looksLikePresetRoot(searchPath))
    ) {
      return { preset: presetName, presetRoot: searchPath };
    }

    for (const candidate of namedCandidates) {
      if (await looksLikePresetRoot(candidate)) {
        return { preset: presetName, presetRoot: candidate };
      }
    }

    throw new Error(
      `[skiller] Preset '${presetName}' was not found under source '${workspace.parsed.source}'.`,
    );
  }

  if (await looksLikePresetRoot(searchPath)) {
    return { preset: path.basename(searchPath), presetRoot: searchPath };
  }

  const presetsDir = path.join(searchPath, 'presets');
  let presetDirs: string[] = [];

  try {
    const entries = await fs.readdir(presetsDir, { withFileTypes: true });
    presetDirs = (
      await Promise.all(
        entries
          .filter((entry) => entry.isDirectory())
          .map(async (entry) => {
            const candidate = path.join(presetsDir, entry.name);
            return (await looksLikePresetRoot(candidate)) ? candidate : null;
          }),
      )
    ).filter((entry): entry is string => !!entry);
  } catch {
    // Ignore missing presets directories.
  }

  if (presetDirs.length === 1) {
    return {
      preset: path.basename(presetDirs[0]!),
      presetRoot: presetDirs[0]!,
    };
  }

  const defaultPreset = presetDirs.find(
    (candidate) => path.basename(candidate) === 'default',
  );
  if (defaultPreset) {
    return { preset: 'default', presetRoot: defaultPreset };
  }

  throw new Error(
    `[skiller] No preset could be selected from source '${workspace.parsed.source}'. Pass --preset <name>.`,
  );
}

async function resolvePresetSourceInput(
  projectRoot: string,
  rawSource: string,
): Promise<string> {
  if (!isLikelyLocalPath(rawSource)) {
    return rawSource;
  }

  const cwdCandidate = path.resolve(rawSource);
  if (await pathExists(cwdCandidate)) {
    return cwdCandidate;
  }

  const projectCandidate = path.resolve(projectRoot, rawSource);
  if (await pathExists(projectCandidate)) {
    return projectCandidate;
  }

  return cwdCandidate;
}

async function writeMergedConfig(
  projectRoot: string,
  baseConfigPath?: string,
): Promise<string> {
  const localConfigPath = path.join(
    projectRoot,
    CANONICAL_SKILLER_DIR,
    SKILLER_CONFIG_FILE,
  );

  const [baseRaw, localRaw] = await Promise.all([
    baseConfigPath ? readRawTomlFile(baseConfigPath) : Promise.resolve({}),
    readRawTomlFile(localConfigPath),
  ]);

  const merged = deepMergeConfig(withoutSync(baseRaw), withoutSync(localRaw));
  const rendered = stringifyTOML(merged);

  await fs.mkdir(path.dirname(localConfigPath), { recursive: true });
  await fs.writeFile(localConfigPath, rendered, 'utf8');

  return hashBuffer(Buffer.from(rendered, 'utf8'));
}

export async function installPresetIntoProject(
  projectRoot: string,
  options: { preset?: string; source: string },
): Promise<PresetInstallResult> {
  const resolvedSource = await resolvePresetSourceInput(
    projectRoot,
    options.source,
  );
  const workspace = await createSourceWorkspace(resolvedSource);

  try {
    const { preset, presetRoot } = await resolvePresetRoot(
      workspace,
      options.preset,
    );
    const previousManifest = await readPresetManifest(projectRoot);
    const presetConfig = await readPresetConfig(presetRoot);

    const nextSources = new Map<string, string>();
    let mergedConfigSourcePath: string | undefined;

    for (const includePath of presetConfig.include) {
      const resolvedIncludePath = path.resolve(presetRoot, includePath);
      const sourcePath = await collectFileFromPath(resolvedIncludePath);
      const targetRelativePath = deriveTargetRelativePath(sourcePath);
      if (!targetRelativePath) {
        throw new Error(
          `[skiller] Included path '${includePath}' in '${preset}/${PRESET_CONFIG_FILENAME}' must resolve under .agents, .claude, .codex, skills-lock.json, or skiller-lock.json.`,
        );
      }

      if (isHardDenied(targetRelativePath)) {
        throw new Error(
          `[skiller] Included path '${includePath}' resolves to denied target '${targetRelativePath}'.`,
        );
      }

      if (COPY_EXCEPTIONS.has(targetRelativePath)) {
        mergedConfigSourcePath = sourcePath;
        continue;
      }

      if (!isPresetAllowlisted(targetRelativePath)) {
        throw new Error(
          `[skiller] Included path '${includePath}' resolves to unsupported target '${targetRelativePath}'.`,
        );
      }

      nextSources.set(targetRelativePath, sourcePath);
    }

    const selectedFiles = (await collectPresetFiles(presetRoot)).filter(
      (relativePath) =>
        relativePath !== PRESET_CONFIG_FILENAME &&
        !isHardDenied(relativePath) &&
        isPresetAllowlisted(relativePath),
    );

    if (
      selectedFiles.includes(
        path
          .join(CANONICAL_SKILLER_DIR, SKILLER_CONFIG_FILE)
          .replace(/\\/g, '/'),
      )
    ) {
      mergedConfigSourcePath = path.join(
        presetRoot,
        CANONICAL_SKILLER_DIR,
        SKILLER_CONFIG_FILE,
      );
    }

    const nextFiles: Record<string, string> = {};
    const synced: string[] = [];

    for (const [targetRelativePath, sourcePath] of [
      ...nextSources.entries(),
    ].sort(([left], [right]) => left.localeCompare(right))) {
      const content = await fs.readFile(sourcePath);
      const targetPath = path.join(projectRoot, targetRelativePath);

      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, content);

      nextFiles[targetRelativePath] = hashBuffer(content);
      synced.push(targetRelativePath);
    }

    for (const relativePath of selectedFiles) {
      const sourcePath = path.join(presetRoot, relativePath);
      const targetPath = path.join(projectRoot, relativePath);

      if (COPY_EXCEPTIONS.has(relativePath)) {
        continue;
      }

      const content = await fs.readFile(sourcePath);

      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, content);

      nextFiles[relativePath] = hashBuffer(content);
      synced.push(relativePath);
    }

    const mergedConfigHash = await writeMergedConfig(
      projectRoot,
      mergedConfigSourcePath,
    );
    nextFiles['.agents/skiller.toml'] = mergedConfigHash;
    synced.push('.agents/skiller.toml');

    const removed: string[] = [];
    if (previousManifest) {
      for (const relativePath of Object.keys(previousManifest.files)) {
        if (nextFiles[relativePath]) continue;

        const targetPath = path.join(projectRoot, relativePath);
        await fs.rm(targetPath, { force: true });
        await removeEmptyDirectoriesUpward(
          path.dirname(targetPath),
          projectRoot,
        );
        removed.push(relativePath);
      }
    }

    await writePresetManifest(projectRoot, {
      version: 1,
      source: options.source,
      preset,
      files: nextFiles,
    });

    return {
      preset,
      presetRoot,
      removed: removed.sort((a, b) => a.localeCompare(b)),
      synced: [...new Set(synced)].sort((a, b) => a.localeCompare(b)),
    };
  } finally {
    await workspace.cleanup();
  }
}
