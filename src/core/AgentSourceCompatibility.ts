import * as crypto from 'crypto';
import type { Dirent } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import { spawn } from 'child_process';
import { parseFrontmatter } from './FrontmatterParser';
import {
  type SkillerLockEntry,
  readSkillerLock,
  upsertSkillerLockEntries,
  removeSkillerLockEntries,
} from './SkillerLock';

const CANONICAL_SKILLS_DIR = path.join('.agents', 'skills');
const LEGACY_CLAUDE_SKILLS_DIR = path.join('.claude', 'skills');
const SKIP_DIRS = new Set([
  '.git',
  '.next',
  'build',
  'coverage',
  'dist',
  'fixtures',
  'node_modules',
  'test',
  'tests',
  'tmp',
  'tmp-fixtures',
]);

interface ParsedSource {
  ref?: string;
  source: string;
  subpath?: string;
  type: 'git' | 'github' | 'local';
  url: string;
}

interface SourceWorkspace {
  cleanup: () => Promise<void>;
  parsed: ParsedSource;
  rootPath: string;
  searchPath: string;
}

export interface AgentSkillCandidate {
  compiledContent: string;
  computedHash: string;
  description: string;
  installName: string;
  name: string;
  sourceRelPath: string;
}

export interface CompatibleSourceInspection {
  agentSkills: AgentSkillCandidate[];
  nativeSkillNames: string[];
  workspace: SourceWorkspace;
}

interface NativeSkillLockEntry {
  computedHash: string;
  source: string;
  sourceType: string;
}

interface NativeSkillLockFile {
  skills: Record<string, NativeSkillLockEntry>;
  version: number;
}

export interface LockPruneResult {
  prunedKeys: string[];
  prunedOutputNames: string[];
  warnings: string[];
}

const NATIVE_SKILLS_LOCK_VERSION = 1;

function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

function normalizeSkillNameForFilesystem(name: string): string {
  return name.trim().replace(/:/g, '-');
}

function createEmptyNativeSkillsLock(): NativeSkillLockFile {
  return {
    version: NATIVE_SKILLS_LOCK_VERSION,
    skills: {},
  };
}

async function readNativeSkillsLock(
  projectRoot: string,
): Promise<NativeSkillLockFile> {
  try {
    const raw = JSON.parse(
      await fs.readFile(path.join(projectRoot, 'skills-lock.json'), 'utf8'),
    ) as NativeSkillLockFile;
    if (
      raw.version !== NATIVE_SKILLS_LOCK_VERSION ||
      !raw.skills ||
      typeof raw.skills !== 'object'
    ) {
      return createEmptyNativeSkillsLock();
    }
    return raw;
  } catch {
    return createEmptyNativeSkillsLock();
  }
}

async function writeNativeSkillsLock(
  projectRoot: string,
  lock: NativeSkillLockFile,
): Promise<void> {
  const sortedSkills: Record<string, NativeSkillLockEntry> = {};

  for (const key of Object.keys(lock.skills).sort((a, b) =>
    a.localeCompare(b),
  )) {
    sortedSkills[key] = lock.skills[key]!;
  }

  await fs.writeFile(
    path.join(projectRoot, 'skills-lock.json'),
    JSON.stringify(
      {
        version: NATIVE_SKILLS_LOCK_VERSION,
        skills: sortedSkills,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
}

function isLocalPath(input: string): boolean {
  return (
    path.isAbsolute(input) ||
    input.startsWith('./') ||
    input.startsWith('../') ||
    input === '.' ||
    input === '..' ||
    /^[a-zA-Z]:[/\\]/.test(input)
  );
}

function sanitizeSubpath(subpath: string): string {
  const normalized = subpath.replace(/\\/g, '/');
  for (const segment of normalized.split('/')) {
    if (segment === '..') {
      throw new Error(`Unsafe subpath '${subpath}'`);
    }
  }
  return normalized;
}

function inferLocalSourceRootFromFile(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const agentMarker = '/agents/';
  const skillsMarker = '/skills/';

  if (normalized.includes(agentMarker)) {
    return filePath.slice(0, normalized.indexOf(agentMarker));
  }

  if (normalized.includes(skillsMarker)) {
    return filePath.slice(0, normalized.indexOf(skillsMarker));
  }

  return path.dirname(filePath);
}

export function parseCompatibleSource(input: string): ParsedSource {
  const trimmed = input.trim();

  if (isLocalPath(trimmed)) {
    return {
      source: path.resolve(trimmed),
      type: 'local',
      url: path.resolve(trimmed),
    };
  }

  const githubPrefixMatch = trimmed.match(/^github:(.+)$/);
  if (githubPrefixMatch) {
    return parseCompatibleSource(githubPrefixMatch[1]!);
  }

  const githubBlobMatch = trimmed.match(
    /github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)/,
  );
  if (githubBlobMatch) {
    const [, owner, repo, ref, subpath] = githubBlobMatch;
    return {
      ref,
      source: `${owner}/${repo.replace(/\.git$/, '')}`,
      subpath: sanitizeSubpath(subpath!),
      type: 'github',
      url: `https://github.com/${owner}/${repo.replace(/\.git$/, '')}.git`,
    };
  }

  const githubTreeWithPathMatch = trimmed.match(
    /github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+)/,
  );
  if (githubTreeWithPathMatch) {
    const [, owner, repo, ref, subpath] = githubTreeWithPathMatch;
    return {
      ref,
      source: `${owner}/${repo.replace(/\.git$/, '')}`,
      subpath: sanitizeSubpath(subpath!),
      type: 'github',
      url: `https://github.com/${owner}/${repo.replace(/\.git$/, '')}.git`,
    };
  }

  const githubTreeMatch = trimmed.match(
    /github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)$/,
  );
  if (githubTreeMatch) {
    const [, owner, repo, ref] = githubTreeMatch;
    return {
      ref,
      source: `${owner}/${repo.replace(/\.git$/, '')}`,
      type: 'github',
      url: `https://github.com/${owner}/${repo.replace(/\.git$/, '')}.git`,
    };
  }

  const githubRepoMatch = trimmed.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (githubRepoMatch) {
    const [, owner, repo] = githubRepoMatch;
    return {
      source: `${owner}/${repo.replace(/\.git$/, '')}`,
      type: 'github',
      url: `https://github.com/${owner}/${repo.replace(/\.git$/, '')}.git`,
    };
  }

  const shorthandMatch = trimmed.match(/^([^/]+)\/([^/]+)$/);
  if (shorthandMatch) {
    const [, owner, repo] = shorthandMatch;
    return {
      source: `${owner}/${repo}`,
      type: 'github',
      url: `https://github.com/${owner}/${repo}.git`,
    };
  }

  if (
    trimmed.startsWith('git@') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('http://')
  ) {
    return {
      source: trimmed,
      type: 'git',
      url: trimmed,
    };
  }

  throw new Error(`Unsupported source '${input}'`);
}

async function runGitClone(url: string, ref?: string): Promise<string> {
  const cloneDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skiller-agents-'));
  const args = ['clone', '--depth', '1'];
  if (ref) {
    args.push('--branch', ref);
  }
  args.push(url, cloneDir);

  await new Promise<void>((resolve, reject) => {
    const child = spawn('git', args, {
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      stdio: 'pipe',
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(stderr.trim() || `git clone failed with exit code ${code}`),
      );
    });
  });

  return cloneDir;
}

async function withSourceWorkspace(
  rawSource: string,
): Promise<SourceWorkspace> {
  const parsed = parseCompatibleSource(rawSource);
  return withParsedSourceWorkspace(parsed);
}

async function withParsedSourceWorkspace(
  parsed: ParsedSource,
): Promise<SourceWorkspace> {
  if (parsed.type === 'local') {
    const targetPath = parsed.subpath
      ? path.join(parsed.url, parsed.subpath)
      : parsed.url;
    let rootPath = parsed.url;
    let searchPath = targetPath;

    try {
      const stats = await fs.stat(targetPath);
      if (stats.isFile()) {
        rootPath = inferLocalSourceRootFromFile(targetPath);
        searchPath = targetPath;
      }
    } catch {
      // Let downstream callers surface missing paths consistently.
    }

    return {
      cleanup: async () => undefined,
      parsed,
      rootPath,
      searchPath,
    };
  }

  const cloneDir = await runGitClone(parsed.url, parsed.ref);
  const searchPath = parsed.subpath
    ? path.join(cloneDir, parsed.subpath)
    : cloneDir;

  return {
    cleanup: async () => {
      await fs.rm(cloneDir, { force: true, recursive: true });
    },
    parsed,
    rootPath: cloneDir,
    searchPath,
  };
}

function parseSourceFromLockEntry(entry: SkillerLockEntry): ParsedSource {
  if (entry.sourceType === 'local') {
    return {
      ref: entry.ref,
      source: entry.source,
      subpath: entry.subpath,
      type: 'local',
      url: entry.source,
    };
  }

  if (entry.sourceType === 'github') {
    return {
      ref: entry.ref,
      source: entry.source,
      subpath: entry.subpath,
      type: 'github',
      url: `https://github.com/${entry.source}.git`,
    };
  }

  return {
    ref: entry.ref,
    source: entry.source,
    subpath: entry.subpath,
    type: 'git',
    url: entry.source,
  };
}

function cloneRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return { ...(value as Record<string, unknown>) };
}

function buildCompiledSkillContent(
  name: string,
  rawFrontmatter: Record<string, unknown> | null,
  body: string,
  sourceRelPath: string,
): string {
  const frontmatter = rawFrontmatter ? { ...rawFrontmatter } : {};
  if (typeof frontmatter.name !== 'string' || frontmatter.name.length === 0) {
    frontmatter.name = name;
  }
  if (
    typeof frontmatter.description !== 'string' ||
    frontmatter.description.length === 0
  ) {
    frontmatter.description = `Skill: ${name}`;
  }

  const metadata = cloneRecord(frontmatter.metadata);
  const skiller = cloneRecord(metadata.skiller);
  skiller.source = sourceRelPath;
  metadata.skiller = skiller;
  frontmatter.metadata = metadata;

  return `---
${yaml.dump(frontmatter, { lineWidth: -1, noRefs: true }).trim()}
---

${body.trim()}
`;
}

function shouldSkipDir(name: string): boolean {
  return SKIP_DIRS.has(name);
}

function isValidRelativePath(value: string): boolean {
  return value.startsWith('./');
}

async function collectDeclaredPluginBases(basePath: string): Promise<string[]> {
  const pluginBases = new Set<string>();

  try {
    const marketplace = JSON.parse(
      await fs.readFile(
        path.join(basePath, '.claude-plugin', 'marketplace.json'),
        'utf8',
      ),
    ) as {
      metadata?: { pluginRoot?: string };
      plugins?: Array<{ source?: string }>;
    };

    const pluginRoot = marketplace.metadata?.pluginRoot;
    const validPluginRoot =
      pluginRoot === undefined || isValidRelativePath(pluginRoot);

    if (validPluginRoot) {
      for (const plugin of marketplace.plugins ?? []) {
        if (typeof plugin.source !== 'string') continue;
        if (!isValidRelativePath(plugin.source)) continue;
        pluginBases.add(path.join(basePath, pluginRoot ?? '', plugin.source));
      }
    }
  } catch {
    // Ignore invalid or missing marketplace manifests.
  }

  try {
    await fs.access(path.join(basePath, '.claude-plugin', 'plugin.json'));
    pluginBases.add(basePath);
  } catch {
    // Ignore.
  }

  return [...pluginBases];
}

async function discoverAgentFiles(
  basePath: string,
  rootPath = basePath,
): Promise<Array<{ absolutePath: string; relativePath: string }>> {
  try {
    const stats = await fs.stat(basePath);
    if (stats.isFile()) {
      if (!basePath.endsWith('.md')) return [];
      return [
        {
          absolutePath: basePath,
          relativePath: path.relative(rootPath, basePath).replace(/\\/g, '/'),
        },
      ];
    }
  } catch {
    return [];
  }

  const discovered = new Map<
    string,
    { absolutePath: string; relativePath: string }
  >();
  const candidateDirs = new Set<string>([path.join(basePath, 'agents')]);

  for (const pluginBase of await collectDeclaredPluginBases(basePath)) {
    candidateDirs.add(path.join(pluginBase, 'agents'));
  }

  const walk = async (currentDir: string, depth: number): Promise<void> => {
    if (depth > 8) return;

    let entries: Dirent[];
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (shouldSkipDir(entry.name)) continue;
        if (entry.name === 'agents') {
          candidateDirs.add(absolutePath);
        }
        await walk(absolutePath, depth + 1);
        continue;
      }
    }
  };

  await walk(basePath, 0);

  const collectMarkdown = async (dir: string, depth: number): Promise<void> => {
    if (depth > 8) return;

    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (shouldSkipDir(entry.name)) continue;
        await collectMarkdown(absolutePath, depth + 1);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;

      const relativePath = path
        .relative(basePath, absolutePath)
        .replace(/\\/g, '/');
      discovered.set(relativePath, { absolutePath, relativePath });
    }
  };

  for (const candidateDir of candidateDirs) {
    await collectMarkdown(candidateDir, 0);
  }

  return [...discovered.values()].sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath),
  );
}

async function discoverSkillNames(basePath: string): Promise<string[]> {
  try {
    const stats = await fs.stat(basePath);
    if (stats.isFile()) {
      if (path.basename(basePath) !== 'SKILL.md') return [];
      const parsed = parseFrontmatter(await fs.readFile(basePath, 'utf8'));
      const declaredName =
        typeof parsed.frontmatter?.name === 'string'
          ? parsed.frontmatter.name
          : path.basename(path.dirname(basePath));
      return [normalizeSkillNameForFilesystem(declaredName)];
    }
  } catch {
    // Ignore missing paths.
  }

  const discovered = new Set<string>();
  const candidateDirs = new Set<string>([path.join(basePath, 'skills')]);

  try {
    const parsed = parseFrontmatter(
      await fs.readFile(path.join(basePath, 'SKILL.md'), 'utf8'),
    );
    const declaredName =
      typeof parsed.frontmatter?.name === 'string'
        ? parsed.frontmatter.name
        : path.basename(basePath);
    discovered.add(normalizeSkillNameForFilesystem(declaredName));
  } catch {
    // Ignore missing root SKILL.md.
  }

  for (const pluginBase of await collectDeclaredPluginBases(basePath)) {
    candidateDirs.add(path.join(pluginBase, 'skills'));
  }

  for (const candidateDir of candidateDirs) {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(candidateDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillMdPath = path.join(candidateDir, entry.name, 'SKILL.md');
      try {
        const parsed = parseFrontmatter(await fs.readFile(skillMdPath, 'utf8'));
        const declaredName =
          typeof parsed.frontmatter?.name === 'string'
            ? parsed.frontmatter.name
            : entry.name;
        discovered.add(normalizeSkillNameForFilesystem(declaredName));
      } catch {
        continue;
      }
    }
  }

  return [...discovered].sort((a, b) => a.localeCompare(b));
}

async function discoverAgentSkillCandidates(
  basePath: string,
  rootPath = basePath,
): Promise<AgentSkillCandidate[]> {
  const agentFiles = await discoverAgentFiles(basePath, rootPath);
  const candidates: AgentSkillCandidate[] = [];

  for (const agentFile of agentFiles) {
    const parsed = parseFrontmatter(
      await fs.readFile(agentFile.absolutePath, 'utf8'),
    );
    const declaredName = parsed.frontmatter?.name;
    const description = parsed.frontmatter?.description;

    if (typeof declaredName !== 'string' || typeof description !== 'string') {
      continue;
    }

    const compiledContent = buildCompiledSkillContent(
      declaredName,
      parsed.rawFrontmatter,
      parsed.body,
      agentFile.relativePath,
    );

    candidates.push({
      compiledContent,
      computedHash: hashContent(compiledContent),
      description,
      installName: normalizeSkillNameForFilesystem(declaredName),
      name: declaredName,
      sourceRelPath: agentFile.relativePath,
    });
  }

  return candidates.sort((a, b) => a.installName.localeCompare(b.installName));
}

function parseRequestedSkillFilters(args: string[] | undefined): {
  names: Set<string>;
  wildcard: boolean;
} {
  const names = new Set<string>();
  let wildcard = false;

  const argv = args ?? [];
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current !== '--skill' && current !== '-s') continue;

    for (
      let valueIndex = index + 1;
      valueIndex < argv.length;
      valueIndex += 1
    ) {
      const value = argv[valueIndex];
      if (value.startsWith('-')) break;
      if (value === '*') {
        wildcard = true;
        continue;
      }
      names.add(normalizeSkillNameForFilesystem(value));
    }
  }

  return { names, wildcard };
}

export function hasListFlag(args: string[] | undefined): boolean {
  return (args ?? []).some((arg) => arg === '--list' || arg === '-l');
}

export function hasGlobalFlag(args: string[] | undefined): boolean {
  return (args ?? []).some((arg) => arg === '--global' || arg === '-g');
}

export function extractAddSource(args: string[] | undefined): string | null {
  for (const arg of args ?? []) {
    if (arg.startsWith('-')) continue;
    return arg;
  }
  return null;
}

export function buildAdjustedSkillsAddArgs(
  originalArgs: string[] | undefined,
  nativeSkillNames: string[],
): string[] {
  const args = [...(originalArgs ?? [])];
  const next: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (current === '--skill' || current === '-s') {
      index += 1;
      while (index < args.length && !args[index]!.startsWith('-')) {
        index += 1;
      }
      index -= 1;
      continue;
    }
    next.push(current);
  }

  if (nativeSkillNames.length > 0) {
    next.push('--skill', ...nativeSkillNames);
  }

  return next;
}

export async function inspectCompatibleSource(
  rawSource: string,
  args?: string[],
): Promise<CompatibleSourceInspection> {
  const workspace = await withSourceWorkspace(rawSource);
  const [nativeSkillNames, discoveredAgentSkills] = await Promise.all([
    discoverSkillNames(workspace.searchPath),
    discoverAgentSkillCandidates(workspace.searchPath, workspace.rootPath),
  ]);

  const requested = parseRequestedSkillFilters(args);
  const agentSkills = discoveredAgentSkills.filter((agentSkill) => {
    if (requested.wildcard || requested.names.size === 0) return true;
    return requested.names.has(agentSkill.installName);
  });

  return {
    agentSkills: agentSkills.sort((a, b) =>
      a.installName.localeCompare(b.installName),
    ),
    nativeSkillNames: requested.wildcard
      ? nativeSkillNames
      : nativeSkillNames.filter(
          (name) => requested.names.size === 0 || requested.names.has(name),
        ),
    workspace,
  };
}

export async function installAgentSkillsFromInspection(
  projectRoot: string,
  inspection: CompatibleSourceInspection,
): Promise<string[]> {
  const installed: string[] = [];
  const lockEntries: Record<string, SkillerLockEntry> = {};
  const canonicalSkillsDir = path.join(projectRoot, CANONICAL_SKILLS_DIR);

  for (const agentSkill of inspection.agentSkills) {
    const skillDir = path.join(canonicalSkillsDir, agentSkill.installName);
    await fs.rm(skillDir, { force: true, recursive: true });
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, 'SKILL.md'),
      agentSkill.compiledContent,
      'utf8',
    );

    lockEntries[agentSkill.installName] = {
      computedHash: agentSkill.computedHash,
      ref: inspection.workspace.parsed.ref,
      source: inspection.workspace.parsed.source,
      sourceRelPath: agentSkill.sourceRelPath,
      sourceType: inspection.workspace.parsed.type,
      subpath: inspection.workspace.parsed.subpath,
    };
    installed.push(agentSkill.installName);
  }

  await upsertSkillerLockEntries(projectRoot, lockEntries);
  await inspection.workspace.cleanup();

  return installed.sort((a, b) => a.localeCompare(b));
}

function groupLockEntriesBySource<
  T extends {
    ref?: string;
    source: string;
    sourceType: string;
    subpath?: string;
  },
>(skills: Record<string, T>): Map<string, Array<[string, T]>> {
  const groups = new Map<string, Array<[string, T]>>();

  for (const [skillName, entry] of Object.entries(skills)) {
    const key = JSON.stringify([
      entry.source,
      entry.sourceType,
      entry.ref ?? '',
      entry.subpath ?? '',
    ]);
    const existing = groups.get(key) ?? [];
    existing.push([skillName, entry]);
    groups.set(key, existing);
  }

  return groups;
}

async function installSingleAgentSkill(
  projectRoot: string,
  skillName: string,
  candidate: AgentSkillCandidate,
  entry: SkillerLockEntry,
): Promise<void> {
  const skillDir = path.join(projectRoot, CANONICAL_SKILLS_DIR, skillName);
  await fs.rm(skillDir, { force: true, recursive: true });
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(
    path.join(skillDir, 'SKILL.md'),
    candidate.compiledContent,
    'utf8',
  );

  await upsertSkillerLockEntries(projectRoot, {
    [skillName]: {
      ...entry,
      computedHash: candidate.computedHash,
    },
  });
}

export async function restoreAgentSkillsFromLock(
  projectRoot: string,
): Promise<{ restored: string[]; warnings: string[] }> {
  const lock = await readSkillerLock(projectRoot);
  const restored: string[] = [];
  const warnings: string[] = [];

  for (const entries of groupLockEntriesBySource(lock.skills).values()) {
    const [, entry] = entries[0]!;
    const workspace = await withParsedSourceWorkspace(
      parseSourceFromLockEntry(entry),
    );
    const agentSkills = await discoverAgentSkillCandidates(
      workspace.searchPath,
      workspace.rootPath,
    );
    const candidates = new Map(
      agentSkills.map((candidate) => [candidate.sourceRelPath, candidate]),
    );

    for (const [skillName, lockEntry] of entries) {
      const candidate = candidates.get(lockEntry.sourceRelPath);
      if (!candidate) {
        warnings.push(
          `Could not restore '${skillName}' from ${lockEntry.source}: missing ${lockEntry.sourceRelPath}`,
        );
        continue;
      }
      await installSingleAgentSkill(
        projectRoot,
        skillName,
        candidate,
        lockEntry,
      );
      restored.push(skillName);
    }

    await workspace.cleanup();
  }

  return {
    restored: restored.sort((a, b) => a.localeCompare(b)),
    warnings,
  };
}

export async function getOutdatedAgentSkills(
  projectRoot: string,
): Promise<{ outdated: string[]; warnings: string[] }> {
  const lock = await readSkillerLock(projectRoot);
  const outdated: string[] = [];
  const warnings: string[] = [];

  for (const entries of groupLockEntriesBySource(lock.skills).values()) {
    const [, entry] = entries[0]!;
    const workspace = await withParsedSourceWorkspace(
      parseSourceFromLockEntry(entry),
    );
    const agentSkills = await discoverAgentSkillCandidates(
      workspace.searchPath,
      workspace.rootPath,
    );
    const candidates = new Map(
      agentSkills.map((candidate) => [candidate.sourceRelPath, candidate]),
    );

    for (const [skillName, lockEntry] of entries) {
      const candidate = candidates.get(lockEntry.sourceRelPath);
      if (!candidate) {
        warnings.push(
          `Could not check '${skillName}' from ${lockEntry.source}: missing ${lockEntry.sourceRelPath}`,
        );
        continue;
      }
      if (candidate.computedHash !== lockEntry.computedHash) {
        outdated.push(skillName);
      }
    }

    await workspace.cleanup();
  }

  return {
    outdated: outdated.sort((a, b) => a.localeCompare(b)),
    warnings,
  };
}

export async function updateAgentSkillsFromLock(
  projectRoot: string,
): Promise<{ updated: string[]; warnings: string[] }> {
  const lock = await readSkillerLock(projectRoot);
  const updated: string[] = [];
  const warnings: string[] = [];

  for (const entries of groupLockEntriesBySource(lock.skills).values()) {
    const [, entry] = entries[0]!;
    const workspace = await withParsedSourceWorkspace(
      parseSourceFromLockEntry(entry),
    );
    const agentSkills = await discoverAgentSkillCandidates(
      workspace.searchPath,
      workspace.rootPath,
    );
    const candidates = new Map(
      agentSkills.map((candidate) => [candidate.sourceRelPath, candidate]),
    );

    for (const [skillName, lockEntry] of entries) {
      const candidate = candidates.get(lockEntry.sourceRelPath);
      if (!candidate) {
        warnings.push(
          `Could not update '${skillName}' from ${lockEntry.source}: missing ${lockEntry.sourceRelPath}`,
        );
        continue;
      }
      if (candidate.computedHash === lockEntry.computedHash) {
        continue;
      }
      await installSingleAgentSkill(
        projectRoot,
        skillName,
        candidate,
        lockEntry,
      );
      updated.push(skillName);
    }

    await workspace.cleanup();
  }

  return {
    updated: updated.sort((a, b) => a.localeCompare(b)),
    warnings,
  };
}

export async function removeAgentManagedSkills(
  projectRoot: string,
  skillNames: string[],
): Promise<string[]> {
  const removed = await removeSkillerLockEntries(projectRoot, skillNames);
  if (removed.length === 0) return [];

  for (const skillName of removed) {
    await fs.rm(path.join(projectRoot, CANONICAL_SKILLS_DIR, skillName), {
      force: true,
      recursive: true,
    });
    await fs.rm(path.join(projectRoot, LEGACY_CLAUDE_SKILLS_DIR, skillName), {
      force: true,
      recursive: true,
    });
  }

  return removed;
}

export async function pruneMissingNativeSkillsFromLock(
  projectRoot: string,
): Promise<LockPruneResult> {
  const lock = await readNativeSkillsLock(projectRoot);
  const prunedKeys: string[] = [];
  const prunedOutputNames: string[] = [];
  const warnings: string[] = [];

  for (const entries of groupLockEntriesBySource(lock.skills).values()) {
    const [, entry] = entries[0]!;
    if (
      entry.sourceType === 'node_modules' ||
      entry.sourceType === 'well-known'
    ) {
      continue;
    }

    let workspace: SourceWorkspace | null = null;

    try {
      workspace = await withSourceWorkspace(entry.source);
      const availableSkillNames = new Set(
        await discoverSkillNames(workspace.searchPath),
      );

      for (const [skillName] of entries) {
        const installName = normalizeSkillNameForFilesystem(skillName);
        if (availableSkillNames.has(installName)) continue;
        prunedKeys.push(skillName);
        prunedOutputNames.push(installName);
      }
    } catch (error) {
      warnings.push(
        `Could not inspect '${entry.source}' for stale skills: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      if (workspace) {
        await workspace.cleanup();
      }
    }
  }

  if (prunedKeys.length > 0) {
    for (const skillName of prunedKeys) {
      delete lock.skills[skillName];
    }
    await writeNativeSkillsLock(projectRoot, lock);
  }

  return {
    prunedKeys: prunedKeys.sort((a, b) => a.localeCompare(b)),
    prunedOutputNames: prunedOutputNames.sort((a, b) => a.localeCompare(b)),
    warnings,
  };
}

export async function pruneMissingAgentSkillsFromLock(
  projectRoot: string,
): Promise<LockPruneResult> {
  const lock = await readSkillerLock(projectRoot);
  const prunedKeys: string[] = [];
  const prunedOutputNames: string[] = [];
  const warnings: string[] = [];

  for (const entries of groupLockEntriesBySource(lock.skills).values()) {
    const [, entry] = entries[0]!;
    let workspace: SourceWorkspace | null = null;

    try {
      workspace = await withParsedSourceWorkspace(
        parseSourceFromLockEntry(entry),
      );
      const agentSkills = await discoverAgentSkillCandidates(
        workspace.searchPath,
        workspace.rootPath,
      );
      const candidates = new Set(
        agentSkills.map((candidate) => candidate.sourceRelPath),
      );

      for (const [skillName, lockEntry] of entries) {
        if (candidates.has(lockEntry.sourceRelPath)) continue;
        prunedKeys.push(skillName);
        prunedOutputNames.push(normalizeSkillNameForFilesystem(skillName));
      }
    } catch (error) {
      warnings.push(
        `Could not inspect '${entry.source}' for stale agent-derived skills: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      if (workspace) {
        await workspace.cleanup();
      }
    }
  }

  if (prunedKeys.length > 0) {
    await removeSkillerLockEntries(projectRoot, prunedKeys);
  }

  return {
    prunedKeys: prunedKeys.sort((a, b) => a.localeCompare(b)),
    prunedOutputNames: prunedOutputNames.sort((a, b) => a.localeCompare(b)),
    warnings,
  };
}
