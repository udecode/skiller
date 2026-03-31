import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import type { SyncConfig, SyncMode } from '../types';
import { matchesPattern } from './FileSystemUtils';
import { CANONICAL_SKILLER_DIR, SKILLER_CONFIG_FILE } from './project-paths';
import { loadConfig } from './ConfigLoader';

const SYNC_MANIFEST_RELATIVE_PATH = path
  .join(CANONICAL_SKILLER_DIR, '.skiller-sync-manifest.json')
  .replace(/\\/g, '/');

const PRESET_ROOT_ALLOWLIST = new Set([
  '.agents',
  '.claude',
  '.codex',
  'skills-lock.json',
  'skiller-lock.json',
]);

const PRESET_ROOT_IGNORES = new Set(['.DS_Store', '.git', 'node_modules']);

const HARD_DENY_PATTERNS = [
  '.agents/skills/**',
  '.claude/skills/**',
  '.agents/.skiller-sync-manifest.json',
  '.git/**',
  'node_modules/**',
];

const COPY_EXCEPTIONS = new Set(['.agents/skiller.toml']);

interface SyncManifest {
  version: 1;
  source: string;
  mode: Exclude<SyncMode, 'auto'>;
  files: Record<string, string>;
  mergedConfigSourceHash: string | null;
}

export interface SyncResult {
  applied: boolean;
  source?: string;
  mode?: Exclude<SyncMode, 'auto'>;
  synced: string[];
  removed: string[];
  removedNativeLockSkills: string[];
  removedAgentLockSkills: string[];
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/');
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

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

async function readLockSkillNames(filePath: string): Promise<string[]> {
  const raw = await readJsonFile<{ skills?: Record<string, unknown> }>(
    filePath,
  );
  return raw?.skills ? Object.keys(raw.skills) : [];
}

async function readManifest(projectRoot: string): Promise<SyncManifest | null> {
  return readJsonFile<SyncManifest>(
    path.join(projectRoot, SYNC_MANIFEST_RELATIVE_PATH),
  );
}

async function collectSourceFiles(rootDir: string): Promise<string[]> {
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

async function normalizePatterns(
  sourceRoot: string,
  patterns: string[] | undefined,
): Promise<string[] | undefined> {
  if (!patterns || patterns.length === 0) return undefined;

  const normalized: string[] = [];
  for (const pattern of patterns) {
    const next = normalizeRelativePath(pattern);
    if (next.includes('*')) {
      normalized.push(next);
      continue;
    }

    const candidate = path.join(sourceRoot, next);
    try {
      const stat = await fs.stat(candidate);
      if (stat.isDirectory()) {
        normalized.push(`${next.replace(/\/$/, '')}/**`);
      } else {
        normalized.push(next);
      }
    } catch {
      normalized.push(next);
    }
  }

  return normalized;
}

async function detectSyncMode(
  sync: SyncConfig,
): Promise<Exclude<SyncMode, 'auto'>> {
  if (sync.mode === 'preset' || sync.mode === 'repo') {
    return sync.mode;
  }

  if (sync.include && sync.include.length > 0) {
    return 'repo';
  }

  const entries = await fs.readdir(sync.source, { withFileTypes: true });
  const interestingEntries = entries.filter(
    (entry) => !PRESET_ROOT_IGNORES.has(entry.name),
  );

  if (
    interestingEntries.length > 0 &&
    interestingEntries.every((entry) => PRESET_ROOT_ALLOWLIST.has(entry.name))
  ) {
    return 'preset';
  }

  throw new Error(
    `[skiller] Sync source '${sync.source}' is not a valid preset root. Set [sync].mode = "repo" and add include patterns, or point source at a curated preset directory.`,
  );
}

async function selectSyncFiles(
  sourceRoot: string,
  mode: Exclude<SyncMode, 'auto'>,
  sync: SyncConfig,
): Promise<string[]> {
  const sourceFiles = await collectSourceFiles(sourceRoot);
  const normalizedInclude = await normalizePatterns(sourceRoot, sync.include);
  const normalizedExclude = await normalizePatterns(sourceRoot, sync.exclude);

  if (
    mode === 'repo' &&
    (!normalizedInclude || normalizedInclude.length === 0)
  ) {
    throw new Error(
      '[skiller] Repo sync mode requires [sync].include to be set.',
    );
  }

  return sourceFiles.filter((relativePath) => {
    if (isHardDenied(relativePath) || COPY_EXCEPTIONS.has(relativePath)) {
      return false;
    }

    if (mode === 'preset' && !isPresetAllowlisted(relativePath)) {
      return false;
    }

    if (
      normalizedExclude?.some((pattern) =>
        matchesPattern(relativePath, pattern),
      )
    ) {
      return false;
    }

    if (mode === 'repo' && normalizedInclude) {
      return normalizedInclude.some((pattern) =>
        matchesPattern(relativePath, pattern),
      );
    }

    return true;
  });
}

async function readMergedConfigSourceHash(
  sourceRoot: string,
): Promise<string | null> {
  const configPath = path.join(
    sourceRoot,
    CANONICAL_SKILLER_DIR,
    SKILLER_CONFIG_FILE,
  );
  try {
    return hashBuffer(await fs.readFile(configPath));
  } catch {
    return null;
  }
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

async function writeManifest(
  projectRoot: string,
  manifest: SyncManifest,
): Promise<void> {
  const manifestPath = path.join(projectRoot, SYNC_MANIFEST_RELATIVE_PATH);
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}

export async function syncProjectFiles(
  projectRoot: string,
): Promise<SyncResult> {
  const config = await loadConfig({ projectRoot });
  if (!config.sync) {
    return {
      applied: false,
      synced: [],
      removed: [],
      removedNativeLockSkills: [],
      removedAgentLockSkills: [],
    };
  }

  const sync = config.sync;
  if (!(await pathExists(sync.source))) {
    throw new Error(`[skiller] Sync source '${sync.source}' does not exist.`);
  }

  const sourceStat = await fs.stat(sync.source);
  if (!sourceStat.isDirectory()) {
    throw new Error(
      `[skiller] Sync source '${sync.source}' must be a directory.`,
    );
  }

  const previousManifest = await readManifest(projectRoot);
  const previousNativeLockNames = await readLockSkillNames(
    path.join(projectRoot, 'skills-lock.json'),
  );
  const previousAgentLockNames = await readLockSkillNames(
    path.join(projectRoot, 'skiller-lock.json'),
  );

  const mode = await detectSyncMode(sync);
  const selectedFiles = await selectSyncFiles(sync.source, mode, sync);
  const nextFiles: Record<string, string> = {};
  const synced: string[] = [];

  for (const relativePath of selectedFiles) {
    const sourcePath = path.join(sync.source, relativePath);
    const targetPath = path.join(projectRoot, relativePath);
    const content = await fs.readFile(sourcePath);
    const hash = hashBuffer(content);

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, content);

    nextFiles[relativePath] = hash;
    synced.push(relativePath);
  }

  const removed: string[] = [];
  if (sync.clean && previousManifest) {
    for (const relativePath of Object.keys(previousManifest.files)) {
      if (nextFiles[relativePath]) continue;

      const targetPath = path.join(projectRoot, relativePath);
      await fs.rm(targetPath, { force: true });
      await removeEmptyDirectoriesUpward(path.dirname(targetPath), projectRoot);
      removed.push(relativePath);
    }
  }

  const manifest: SyncManifest = {
    version: 1,
    source: sync.source,
    mode,
    files: nextFiles,
    mergedConfigSourceHash: await readMergedConfigSourceHash(sync.source),
  };
  await writeManifest(projectRoot, manifest);

  const currentNativeLockNames =
    nextFiles['skills-lock.json'] || removed.includes('skills-lock.json')
      ? await readLockSkillNames(path.join(projectRoot, 'skills-lock.json'))
      : previousNativeLockNames;
  const currentAgentLockNames =
    nextFiles['skiller-lock.json'] || removed.includes('skiller-lock.json')
      ? await readLockSkillNames(path.join(projectRoot, 'skiller-lock.json'))
      : previousAgentLockNames;

  return {
    applied: true,
    source: sync.source,
    mode,
    synced: synced.sort((a, b) => a.localeCompare(b)),
    removed: removed.sort((a, b) => a.localeCompare(b)),
    removedNativeLockSkills: previousNativeLockNames
      .filter((name) => !currentNativeLockNames.includes(name))
      .sort((a, b) => a.localeCompare(b)),
    removedAgentLockSkills: previousAgentLockNames
      .filter((name) => !currentAgentLockNames.includes(name))
      .sort((a, b) => a.localeCompare(b)),
  };
}
