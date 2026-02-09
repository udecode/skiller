import type { Dirent } from 'fs';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { MAX_RECURSION_DEPTH, logVerboseInfo, logWarn } from '../constants';
import { parseFrontmatter } from './FrontmatterParser';
import { copySkillsDirectory } from './SkillsUtils';
import {
  isPluginManifestEntry,
  loadSkillsManifestEntries,
  type PluginSkillsManifestEntry,
  type SkillsManifestEntry,
  writeSkillsManifestEntries,
} from './SkillsManifest';

export interface InstalledPluginEntry {
  scope: 'project' | 'user';
  projectPath?: string;
  installPath: string;
  version?: string;
  installedAt?: string;
  lastUpdated?: string;
  gitCommitSha?: string;
}

export interface InstalledPluginsIndex {
  version: number;
  plugins: Record<string, InstalledPluginEntry[]>;
}

export interface SyncClaudePluginsArgs {
  projectRoot: string;
  targetSkillsDirs: string[];
  verbose: boolean;
  dryRun: boolean;
}

interface PluginResolvedInstall {
  pluginId: string;
  installPath: string;
  version?: string;
}

interface PluginResolvedSource {
  pluginId: string;
  pluginRoot: string;
  version?: string;
}

interface LegacyMarkerFile {
  pluginId: string;
  pluginVersion?: string;
  sourceKind: 'skill' | 'command' | 'agent';
  sourceRelPath: string;
  generatedName: string;
}

interface ExpectedPluginItem {
  itemKey: string;
  pluginId: string;
  pluginVersion?: string;
  kind: 'skill' | 'command' | 'agent';
  sourcePath: string;
  sourceRelPath: string;
  baseName: string;
}

const LEGACY_MARKER_FILENAME = '.skiller-plugin.json';
type ManagedEntry = PluginSkillsManifestEntry;

function getUserHomeDir(): string {
  // Prefer env vars so tests (and users) can override deterministically.
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

function sanitizeId(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '_');
}

function parseDate(dateStr?: string): number {
  if (!dateStr) return 0;
  const t = Date.parse(dateStr);
  return Number.isFinite(t) ? t : 0;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function dirExists(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

function makeItemKey(
  pluginId: string,
  sourceKind: 'skill' | 'command' | 'agent',
  sourceRelPath: string,
): string {
  return `${pluginId}::${sourceKind}::${sourceRelPath}`;
}

export async function readEnabledPlugins(
  projectRoot: string,
): Promise<string[] | null> {
  const settingsPath = path.join(projectRoot, '.claude', 'settings.json');
  let raw: unknown;

  try {
    raw = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
  } catch {
    return null;
  }

  if (!raw || typeof raw !== 'object') return [];
  const enabledPlugins = (raw as Record<string, unknown>).enabledPlugins;
  if (!enabledPlugins || typeof enabledPlugins !== 'object') return [];

  return Object.entries(enabledPlugins as Record<string, unknown>)
    .filter(([, v]) => v === true)
    .map(([k]) => k);
}

export async function readInstalledPluginsIndex(
  claudeDir: string,
): Promise<InstalledPluginsIndex | null> {
  const indexPath = path.join(claudeDir, 'plugins', 'installed_plugins.json');
  try {
    const raw = JSON.parse(await fs.readFile(indexPath, 'utf8')) as unknown;
    if (!raw || typeof raw !== 'object') return null;
    const obj = raw as Record<string, unknown>;
    if (!obj.plugins || typeof obj.plugins !== 'object') return null;
    return raw as InstalledPluginsIndex;
  } catch {
    return null;
  }
}

function parsePluginId(
  pluginId: string,
): { pluginName: string; marketplaceId: string } | null {
  // `pluginId` format is typically `<pluginName>@<marketplaceId>`.
  // Split by the last `@` so scoped names like `@org/foo@market` work.
  const at = pluginId.lastIndexOf('@');
  if (at <= 0 || at === pluginId.length - 1) return null;
  return {
    pluginName: pluginId.slice(0, at),
    marketplaceId: pluginId.slice(at + 1),
  };
}

async function resolvePluginMarketplaceRoot(
  pluginId: string,
  claudeDir: string,
): Promise<string | null> {
  const parsed = parsePluginId(pluginId);
  if (!parsed) return null;

  const marketplaceRoot = path.join(
    claudeDir,
    'plugins',
    'marketplaces',
    parsed.marketplaceId,
  );

  const candidates = [
    path.join(marketplaceRoot, 'plugins', parsed.pluginName),
    path.join(marketplaceRoot, 'external_plugins', parsed.pluginName),
    path.join(marketplaceRoot, '.claude-plugin', 'plugins', parsed.pluginName),
    path.join(
      marketplaceRoot,
      '.claude-plugin',
      'external_plugins',
      parsed.pluginName,
    ),
  ];

  for (const candidate of candidates) {
    if (await dirExists(candidate)) return candidate;
  }

  return null;
}

export function resolvePluginInstall(
  pluginId: string,
  projectRoot: string,
  index: InstalledPluginsIndex,
): PluginResolvedInstall | null {
  const entries = index.plugins?.[pluginId];
  if (!entries || !Array.isArray(entries) || entries.length === 0) return null;

  const resolvedProjectRoot = path.resolve(projectRoot);

  const projectCandidates = entries
    .filter(
      (e) => e && e.scope === 'project' && typeof e.projectPath === 'string',
    )
    .filter((e) => {
      const pp = path.resolve(e.projectPath as string);
      return (
        resolvedProjectRoot === pp ||
        resolvedProjectRoot.startsWith(pp + path.sep)
      );
    })
    .map((e) => ({
      entry: e,
      projectPath: path.resolve(e.projectPath as string),
    }));

  // Prefer the most specific projectPath match, then newest timestamp.
  if (projectCandidates.length > 0) {
    projectCandidates.sort((a, b) => {
      if (a.projectPath.length !== b.projectPath.length) {
        return b.projectPath.length - a.projectPath.length;
      }
      const at =
        parseDate(a.entry.lastUpdated) || parseDate(a.entry.installedAt);
      const bt =
        parseDate(b.entry.lastUpdated) || parseDate(b.entry.installedAt);
      return bt - at;
    });

    const chosen = projectCandidates[0].entry;
    return {
      pluginId,
      installPath: chosen.installPath,
      version: chosen.version,
    };
  }

  const userCandidates = entries.filter((e) => e && e.scope === 'user');
  if (userCandidates.length === 0) {
    // Fallback: if the plugin is installed for a different project but enabled
    // here, still use the newest available install. This avoids noisy
    // "not installed" warnings for plugins that don't ship skills/commands.
    const anyCandidates = entries.filter(
      (e) => e && typeof e.installPath === 'string' && e.installPath.length > 0,
    );
    if (anyCandidates.length === 0) return null;

    anyCandidates.sort((a, b) => {
      const at = parseDate(a.lastUpdated) || parseDate(a.installedAt);
      const bt = parseDate(b.lastUpdated) || parseDate(b.installedAt);
      return bt - at;
    });

    return {
      pluginId,
      installPath: anyCandidates[0].installPath,
      version: anyCandidates[0].version,
    };
  }

  userCandidates.sort((a, b) => {
    const at = parseDate(a.lastUpdated) || parseDate(a.installedAt);
    const bt = parseDate(b.lastUpdated) || parseDate(b.installedAt);
    return bt - at;
  });

  return {
    pluginId,
    installPath: userCandidates[0].installPath,
    version: userCandidates[0].version,
  };
}

export async function discoverPluginSkillDirs(
  installPath: string,
): Promise<Array<{ relId: string; dir: string }>> {
  const skillsRoot = path.join(installPath, 'skills');
  if (!(await fileExists(skillsRoot))) return [];

  const results: Array<{ relId: string; dir: string }> = [];

  async function walk(current: string, depth: number): Promise<void> {
    if (depth >= MAX_RECURSION_DEPTH) return;

    let entries: Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    // Skill root if contains SKILL.md
    const hasSkillMd = entries.some((e) => e.isFile() && e.name === 'SKILL.md');
    if (hasSkillMd) {
      const relId = path.relative(skillsRoot, current).replace(/\\/g, '/');
      results.push({ relId, dir: current });
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      await walk(path.join(current, entry.name), depth + 1);
    }
  }

  await walk(skillsRoot, 0);
  return results;
}

export async function discoverPluginCommandFiles(
  installPath: string,
): Promise<Array<{ rel: string; file: string }>> {
  const commandsRoot = path.join(installPath, 'commands');
  if (!(await fileExists(commandsRoot))) return [];

  const results: Array<{ rel: string; file: string }> = [];

  async function walk(current: string, depth: number): Promise<void> {
    if (depth >= MAX_RECURSION_DEPTH) return;

    let entries: Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const rel = path.relative(commandsRoot, full).replace(/\\/g, '/');
      results.push({ rel, file: full });
    }
  }

  await walk(commandsRoot, 0);
  return results;
}

export async function discoverPluginAgentFiles(
  installPath: string,
): Promise<Array<{ name: string; file: string; rel: string }>> {
  const agentsRoot = path.join(installPath, 'agents');
  if (!(await fileExists(agentsRoot))) return [];

  const results: Array<{ name: string; file: string; rel: string }> = [];

  async function walk(current: string, depth: number): Promise<void> {
    if (depth >= MAX_RECURSION_DEPTH) return;

    let entries: Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;

      let content: string;
      try {
        content = await fs.readFile(full, 'utf8');
      } catch {
        continue;
      }

      const parsed = parseFrontmatter(content);
      const fmName =
        parsed.rawFrontmatter && typeof parsed.rawFrontmatter.name === 'string'
          ? parsed.rawFrontmatter.name
          : parsed.frontmatter?.name;
      if (typeof fmName !== 'string' || fmName.trim() === '') continue;

      const rel = path.relative(agentsRoot, full).replace(/\\/g, '/');
      results.push({ name: fmName.trim(), file: full, rel });
    }
  }

  await walk(agentsRoot, 0);
  return results;
}

function generateBaseNameFromRelId(relId: string): string {
  const normalized = relId.replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  return segments.map(sanitizeId).join('-');
}

function generateBaseNameFromCommandRelPath(commandRelPath: string): string {
  const normalized = commandRelPath.replace(/\\/g, '/');
  const withoutExt = normalized.endsWith('.md')
    ? normalized.slice(0, -'.md'.length)
    : normalized;
  const segments = withoutExt.split('/').filter(Boolean);
  return segments.map(sanitizeId).join('-');
}

function pluginBaseNamespacePrefix(pluginId: string): string {
  const parsed = parsePluginId(pluginId);
  if (parsed) return sanitizeId(parsed.pluginName);
  return sanitizeId(pluginId);
}

function computePluginNamespacePrefixes(
  pluginIds: string[],
): Map<string, string> {
  const out = new Map<string, string>();

  const pluginIdsByBase = new Map<string, string[]>();
  for (const pluginId of pluginIds) {
    const base = pluginBaseNamespacePrefix(pluginId);
    const bucket = pluginIdsByBase.get(base) ?? [];
    bucket.push(pluginId);
    pluginIdsByBase.set(base, bucket);
  }

  for (const [base, ids] of pluginIdsByBase.entries()) {
    ids.sort((a, b) => a.localeCompare(b));
    if (ids.length === 1) {
      out.set(ids[0], base);
      continue;
    }

    // If multiple enabled plugins share the same plugin name, disambiguate
    // without including the marketplace in the folder name.
    ids.forEach((id, idx) => {
      out.set(id, idx === 0 ? base : `${base}-${idx + 1}`);
    });
  }

  return out;
}

async function readLegacyMarkerFile(
  dir: string,
): Promise<LegacyMarkerFile | null> {
  const markerPath = path.join(dir, LEGACY_MARKER_FILENAME);
  try {
    const raw = JSON.parse(await fs.readFile(markerPath, 'utf8')) as unknown;
    if (!raw || typeof raw !== 'object') return null;
    const obj = raw as Record<string, unknown>;
    if (typeof obj.pluginId !== 'string') return null;
    if (typeof obj.generatedName !== 'string') return null;
    if (
      obj.sourceKind !== 'skill' &&
      obj.sourceKind !== 'command' &&
      obj.sourceKind !== 'agent'
    )
      return null;
    if (typeof obj.sourceRelPath !== 'string') return null;
    const pluginVersion =
      typeof obj.pluginVersion === 'string' ? obj.pluginVersion : undefined;
    return {
      pluginId: obj.pluginId,
      pluginVersion,
      sourceKind: obj.sourceKind,
      sourceRelPath: obj.sourceRelPath,
      generatedName: obj.generatedName,
    } as LegacyMarkerFile;
  } catch {
    return null;
  }
}

async function removeLegacyMarkerFile(
  dir: string,
  dryRun: boolean,
): Promise<void> {
  const markerPath = path.join(dir, LEGACY_MARKER_FILENAME);
  if (dryRun) return;
  try {
    await fs.unlink(markerPath);
  } catch {
    // ignore
  }
}

async function loadManagedEntries(
  projectRoot: string,
  targetSkillsDir: string,
  dryRun: boolean,
): Promise<{
  pluginEntries: ManagedEntry[];
  otherEntries: SkillsManifestEntry[];
}> {
  const allEntries = await loadSkillsManifestEntries(
    projectRoot,
    targetSkillsDir,
  );
  const pluginEntries: ManagedEntry[] = [];
  const otherEntries: SkillsManifestEntry[] = [];

  for (const entry of allEntries) {
    if (isPluginManifestEntry(entry)) {
      pluginEntries.push(entry);
    } else {
      otherEntries.push(entry);
    }
  }

  // Migration: absorb legacy per-skill markers and remove them so they don't
  // show up in every skill folder.
  let dirents: Dirent[];
  try {
    dirents = await fs.readdir(targetSkillsDir, { withFileTypes: true });
  } catch {
    return { pluginEntries, otherEntries };
  }

  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue;
    const folder = path.join(targetSkillsDir, dirent.name);
    const legacy = await readLegacyMarkerFile(folder);
    if (!legacy) continue;

    const managed: ManagedEntry = {
      sourceType: 'plugin',
      pluginId: legacy.pluginId,
      pluginVersion: legacy.pluginVersion,
      sourceKind: legacy.sourceKind,
      sourceRelPath: legacy.sourceRelPath,
      destRelPath: dirent.name,
    };

    const already = pluginEntries.some(
      (e) =>
        e.destRelPath === managed.destRelPath &&
        e.pluginId === managed.pluginId &&
        e.sourceKind === managed.sourceKind &&
        e.sourceRelPath === managed.sourceRelPath,
    );
    if (!already) {
      pluginEntries.push(managed);
    }

    await removeLegacyMarkerFile(folder, dryRun);
  }

  return { pluginEntries, otherEntries };
}

async function discoverLocalSkillNames(
  projectRoot: string,
): Promise<Set<string>> {
  const localSkillsDir = path.join(projectRoot, '.claude', 'skills');
  if (!(await fileExists(localSkillsDir))) return new Set();

  const names = new Set<string>();

  async function walk(current: string, depth: number): Promise<void> {
    if (depth >= MAX_RECURSION_DEPTH) return;

    let entries: Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    const hasSkillMd = entries.some((e) => e.isFile() && e.name === 'SKILL.md');
    if (hasSkillMd) {
      const rel = path.relative(localSkillsDir, current).replace(/\\/g, '/');
      const segments = rel.split('/').filter(Boolean);
      if (segments.length > 0) {
        names.add(segments.map(sanitizeId).join('-'));
      } else {
        names.add(sanitizeId(path.basename(current)));
      }
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      await walk(path.join(current, entry.name), depth + 1);
    }
  }

  await walk(localSkillsDir, 0);
  return names;
}

async function discoverLocalCommandNames(
  projectRoot: string,
): Promise<Set<string>> {
  const localCommandsDir = path.join(projectRoot, '.claude', 'commands');
  if (!(await fileExists(localCommandsDir))) return new Set();

  const names = new Set<string>();

  async function walk(current: string, depth: number): Promise<void> {
    if (depth >= MAX_RECURSION_DEPTH) return;

    let entries: Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const rel = path.relative(localCommandsDir, full).replace(/\\/g, '/');
      const withoutExt = rel.endsWith('.md')
        ? rel.slice(0, -'.md'.length)
        : rel;
      const segments = withoutExt.split('/').filter(Boolean);
      names.add(segments.map(sanitizeId).join('-'));
    }
  }

  await walk(localCommandsDir, 0);
  return names;
}

async function discoverLocalAgentNames(
  projectRoot: string,
): Promise<Set<string>> {
  const localAgentsDir = path.join(projectRoot, '.claude', 'agents');
  if (!(await fileExists(localAgentsDir))) return new Set();

  const names = new Set<string>();

  async function walk(current: string, depth: number): Promise<void> {
    if (depth >= MAX_RECURSION_DEPTH) return;

    let entries: Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;

      let content: string;
      try {
        content = await fs.readFile(full, 'utf8');
      } catch {
        continue;
      }

      const parsed = parseFrontmatter(content);
      const fmName =
        parsed.rawFrontmatter && typeof parsed.rawFrontmatter.name === 'string'
          ? parsed.rawFrontmatter.name
          : parsed.frontmatter?.name;
      if (typeof fmName !== 'string' || fmName.trim() === '') continue;

      names.add(sanitizeId(fmName.trim()));
    }
  }

  await walk(localAgentsDir, 0);
  return names;
}

async function ensureDir(dir: string, dryRun: boolean): Promise<void> {
  if (dryRun) return;
  await fs.mkdir(dir, { recursive: true });
}

async function removeDir(dir: string, dryRun: boolean): Promise<void> {
  if (dryRun) return;
  await fs.rm(dir, { recursive: true, force: true });
}

async function rewriteSkillMdName(
  skillMdPath: string,
  name: string,
  pluginId: string,
  dryRun: boolean,
): Promise<void> {
  let content: string;
  try {
    content = await fs.readFile(skillMdPath, 'utf8');
  } catch {
    return;
  }

  const { rawFrontmatter, body } = parseFrontmatter(content);
  const fm: Record<string, unknown> = rawFrontmatter
    ? { ...rawFrontmatter }
    : {};
  fm.name = name;
  if (typeof fm.description !== 'string' || fm.description.trim() === '') {
    fm.description = `Plugin skill from ${pluginId}`;
  }

  const next = `---\n${yaml
    .dump(fm, { lineWidth: -1, noRefs: true })
    .trim()}\n---\n\n${body}\n`;

  if (dryRun) return;
  await fs.writeFile(skillMdPath, next, 'utf8');
}

async function writeMarkdownAsSkill(
  srcMarkdownPath: string,
  destDir: string,
  generatedName: string,
  pluginId: string,
  kindLabel: string,
  dryRun: boolean,
): Promise<void> {
  const content = await fs.readFile(srcMarkdownPath, 'utf8');
  const { rawFrontmatter, body } = parseFrontmatter(content);
  const fm: Record<string, unknown> = rawFrontmatter
    ? { ...rawFrontmatter }
    : {};

  fm.name = generatedName;
  if (typeof fm.description !== 'string' || fm.description.trim() === '') {
    fm.description = `${kindLabel} from ${pluginId}: ${path.basename(srcMarkdownPath, '.md')}`;
  }

  const next = `---\n${yaml
    .dump(fm, { lineWidth: -1, noRefs: true })
    .trim()}\n---\n\n${body}\n`;

  if (dryRun) return;
  await fs.writeFile(path.join(destDir, 'SKILL.md'), next, 'utf8');
}

export async function syncClaudePluginsToSkillsDirs(
  args: SyncClaudePluginsArgs,
): Promise<void> {
  const { projectRoot, targetSkillsDirs, verbose, dryRun } = args;

  const enabledPlugins = await readEnabledPlugins(projectRoot);
  if (enabledPlugins === null) {
    // Fail-safe: no project settings.json (or invalid) => no sync, no cleanup.
    return;
  }

  const claudeDir = path.join(getUserHomeDir(), '.claude');
  const index = await readInstalledPluginsIndex(claudeDir);

  const localSkillNames = await discoverLocalSkillNames(projectRoot);
  const localCommandNames = await discoverLocalCommandNames(projectRoot);
  const localAgentNames = await discoverLocalAgentNames(projectRoot);
  const localReservedNames = new Set<string>([
    ...localSkillNames,
    ...localCommandNames,
    ...localAgentNames,
  ]);

  const resolvedSources: PluginResolvedSource[] = [];
  const unresolvedEnabled = new Set<string>();

  for (const pluginId of enabledPlugins) {
    const pluginRoot = await resolvePluginMarketplaceRoot(pluginId, claudeDir);
    if (!pluginRoot) {
      unresolvedEnabled.add(pluginId);
      const hasIndexEntry = Boolean(index?.plugins?.[pluginId]?.length);
      if (hasIndexEntry) {
        logVerboseInfo(
          `[plugins] Enabled plugin has no marketplace content, skipping: ${pluginId}`,
          verbose,
          dryRun,
        );
      } else {
        logWarn(`[plugins] Enabled plugin not installed: ${pluginId}`, dryRun);
      }
      continue;
    }

    const resolved = index
      ? resolvePluginInstall(pluginId, projectRoot, index)
      : null;

    resolvedSources.push({
      pluginId,
      pluginRoot,
      version: resolved?.version,
    });
  }

  const expectedItems: ExpectedPluginItem[] = [];

  for (const plugin of resolvedSources) {
    const skillDirs = await discoverPluginSkillDirs(plugin.pluginRoot);
    for (const s of skillDirs) {
      const baseName = generateBaseNameFromRelId(s.relId);
      const sourceRelPath = `skills/${s.relId}`;
      expectedItems.push({
        itemKey: makeItemKey(plugin.pluginId, 'skill', sourceRelPath),
        pluginId: plugin.pluginId,
        pluginVersion: plugin.version,
        kind: 'skill',
        sourcePath: s.dir,
        sourceRelPath,
        baseName,
      });
    }

    const commandFiles = await discoverPluginCommandFiles(plugin.pluginRoot);
    for (const c of commandFiles) {
      const baseName = generateBaseNameFromCommandRelPath(c.rel);
      const sourceRelPath = `commands/${c.rel}`;
      expectedItems.push({
        itemKey: makeItemKey(plugin.pluginId, 'command', sourceRelPath),
        pluginId: plugin.pluginId,
        pluginVersion: plugin.version,
        kind: 'command',
        sourcePath: c.file,
        sourceRelPath,
        baseName,
      });
    }

    const agentFiles = await discoverPluginAgentFiles(plugin.pluginRoot);
    for (const a of agentFiles) {
      const baseName = sanitizeId(a.name);
      const sourceRelPath = `agents/${a.rel}`;
      expectedItems.push({
        itemKey: makeItemKey(plugin.pluginId, 'agent', sourceRelPath),
        pluginId: plugin.pluginId,
        pluginVersion: plugin.version,
        kind: 'agent',
        sourcePath: a.file,
        sourceRelPath,
        baseName,
      });
    }
  }

  const sortedItems = [...expectedItems].sort((a, b) => {
    const ak = `${a.baseName}::${a.pluginId}::${a.kind}::${a.sourceRelPath}`;
    const bk = `${b.baseName}::${b.pluginId}::${b.kind}::${b.sourceRelPath}`;
    return ak.localeCompare(bk);
  });

  const pluginNamespacePrefixByPluginId = computePluginNamespacePrefixes([
    ...new Set(resolvedSources.map((p) => p.pluginId)),
  ]);

  // Sync into each target skills dir.
  for (const targetSkillsDir of targetSkillsDirs) {
    const targetExists = await fileExists(targetSkillsDir);
    if (!targetExists && sortedItems.length === 0) continue;

    let managedEntries: ManagedEntry[] = [];
    let otherEntries: SkillsManifestEntry[] = [];
    if (targetExists) {
      const loaded = await loadManagedEntries(
        projectRoot,
        targetSkillsDir,
        dryRun,
      );
      managedEntries = loaded.pluginEntries;
      otherEntries = loaded.otherEntries;
    }

    // Map previous destinations by itemKey for stability.
    const prevDestByItemKey = new Map<string, string>();
    for (const entry of managedEntries) {
      prevDestByItemKey.set(
        makeItemKey(entry.pluginId, entry.sourceKind, entry.sourceRelPath),
        entry.destRelPath,
      );
    }

    const managedDest = new Set<string>(
      managedEntries.map((e) => e.destRelPath),
    );

    // Reserve: local skills always win. Also reserve any existing non-managed folders.
    const reserved = new Set<string>(localReservedNames);

    if (targetExists) {
      let dirents: Dirent[] = [];
      try {
        dirents = await fs.readdir(targetSkillsDir, { withFileTypes: true });
      } catch {
        dirents = [];
      }
      for (const d of dirents) {
        if (!d.isDirectory()) continue;
        if (!managedDest.has(d.name)) {
          reserved.add(d.name);
        }
      }
    }

    // Assign destinations.
    const taken = new Set<string>(reserved);
    const assignedDestByItemKey = new Map<string, string>();

    // First pass: preserve previous dest if available.
    for (const item of sortedItems) {
      const prev = prevDestByItemKey.get(item.itemKey);
      if (!prev) continue;
      const desiredPrefix =
        pluginNamespacePrefixByPluginId.get(item.pluginId) ??
        sanitizeId(item.pluginId);

      // Migration: previous versions used `${pluginId}__${name}`, then
      // `${pluginId}-${name}`. If we changed the namespace prefix (for example
      // to omit marketplace), don't preserve the old destination so the item
      // can be renamed.
      if (prev.startsWith(`${sanitizeId(item.pluginId)}__`)) continue;
      if (
        prev.startsWith(`${sanitizeId(item.pluginId)}-`) &&
        desiredPrefix !== sanitizeId(item.pluginId)
      )
        continue;
      if (taken.has(prev)) continue;
      assignedDestByItemKey.set(item.itemKey, prev);
      taken.add(prev);
    }

    // Second pass: use baseName if possible, otherwise namespace.
    for (const item of sortedItems) {
      if (assignedDestByItemKey.has(item.itemKey)) continue;

      const base = item.baseName;
      if (!taken.has(base)) {
        assignedDestByItemKey.set(item.itemKey, base);
        taken.add(base);
        continue;
      }

      const namespacedBase = `${pluginNamespacePrefixByPluginId.get(item.pluginId) ?? sanitizeId(item.pluginId)}-${base}`;
      let candidate = namespacedBase;
      let i = 2;
      while (taken.has(candidate)) {
        candidate = `${namespacedBase}-${i++}`;
      }
      assignedDestByItemKey.set(item.itemKey, candidate);
      taken.add(candidate);
    }

    const assignedItems = sortedItems.map((item) => ({
      ...item,
      destRelPath: assignedDestByItemKey.get(item.itemKey) as string,
    }));

    // Install/update expected items
    if (assignedItems.length > 0) {
      await ensureDir(targetSkillsDir, dryRun);
    }

    for (const item of assignedItems) {
      const destRelPath = item.destRelPath;
      const destDir = path.join(targetSkillsDir, destRelPath);

      if (await fileExists(destDir)) {
        // Only overwrite if it's skiller-managed for this target.
        if (!managedDest.has(destRelPath)) {
          // Should not happen due to reserved/taken logic; keep as a safety net.
          logWarn(
            `[plugins] Destination exists but is not skiller-managed, skipping: ${destDir}`,
            dryRun,
          );
          continue;
        }

        logVerboseInfo(
          dryRun
            ? `DRY RUN: Would update plugin skill '${destRelPath}' in ${targetSkillsDir}`
            : `Updating plugin skill '${destRelPath}' in ${targetSkillsDir}`,
          verbose,
          dryRun,
        );
        await removeDir(destDir, dryRun);
      }

      if (item.kind === 'skill') {
        logVerboseInfo(
          dryRun
            ? `DRY RUN: Would install plugin skill '${destRelPath}' to ${targetSkillsDir}`
            : `Installing plugin skill '${destRelPath}' to ${targetSkillsDir}`,
          verbose,
          dryRun,
        );

        if (!dryRun) {
          await copySkillsDirectory(item.sourcePath, destDir);
        }

        await rewriteSkillMdName(
          path.join(destDir, 'SKILL.md'),
          destRelPath,
          item.pluginId,
          dryRun,
        );

        // Remove any leftover legacy marker file from older versions.
        await removeLegacyMarkerFile(destDir, dryRun);
      } else {
        const kindLabel = item.kind === 'command' ? 'command' : 'agent';
        logVerboseInfo(
          dryRun
            ? `DRY RUN: Would install plugin ${kindLabel} '${destRelPath}' as skill to ${targetSkillsDir}`
            : `Installing plugin ${kindLabel} '${destRelPath}' as skill to ${targetSkillsDir}`,
          verbose,
          dryRun,
        );
        await ensureDir(destDir, dryRun);
        if (!dryRun) {
          await writeMarkdownAsSkill(
            item.sourcePath,
            destDir,
            destRelPath,
            item.pluginId,
            item.kind === 'command' ? 'Command' : 'Agent',
            dryRun,
          );
        }
        await removeLegacyMarkerFile(destDir, dryRun);
      }
    }

    // Cleanup stale managed folders (from manifest/legacy).
    const expectedDest = new Set<string>(
      assignedItems.map((i) => i.destRelPath),
    );
    const nextEntries: ManagedEntry[] = [];

    for (const entry of managedEntries) {
      const isEnabled = enabledPlugins.includes(entry.pluginId);
      const unresolved = unresolvedEnabled.has(entry.pluginId);
      const shouldKeepBecauseUnresolved = isEnabled && unresolved;

      if (shouldKeepBecauseUnresolved) {
        nextEntries.push(entry);
        continue;
      }

      if (!isEnabled) {
        if (reserved.has(entry.destRelPath)) {
          // Local/user took over the name; stop managing it but don't delete.
          continue;
        }
        logVerboseInfo(
          dryRun
            ? `DRY RUN: Would remove stale plugin skill '${entry.destRelPath}' from ${targetSkillsDir}`
            : `Removing stale plugin skill '${entry.destRelPath}' from ${targetSkillsDir}`,
          verbose,
          dryRun,
        );
        await removeDir(path.join(targetSkillsDir, entry.destRelPath), dryRun);
        continue;
      }

      if (!expectedDest.has(entry.destRelPath)) {
        if (reserved.has(entry.destRelPath)) {
          // Local/user took over the name; stop managing it but don't delete.
          continue;
        }
        logVerboseInfo(
          dryRun
            ? `DRY RUN: Would remove stale plugin skill '${entry.destRelPath}' from ${targetSkillsDir}`
            : `Removing stale plugin skill '${entry.destRelPath}' from ${targetSkillsDir}`,
          verbose,
          dryRun,
        );
        await removeDir(path.join(targetSkillsDir, entry.destRelPath), dryRun);
        continue;
      }

      // Still expected; we'll re-add it below as part of nextEntries generation.
    }

    // Add expected entries for installed items
    for (const item of assignedItems) {
      nextEntries.push({
        sourceType: 'plugin',
        pluginId: item.pluginId,
        pluginVersion: item.pluginVersion,
        sourceKind: item.kind,
        sourceRelPath: item.sourceRelPath,
        destRelPath: item.destRelPath,
      });
    }

    await writeSkillsManifestEntries(
      projectRoot,
      targetSkillsDir,
      [...otherEntries, ...nextEntries],
      dryRun,
    );
  }
}
