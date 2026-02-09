import type { Dirent } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { MAX_RECURSION_DEPTH, logVerboseInfo, logWarn } from '../constants';
import { parseFrontmatter } from './FrontmatterParser';

export interface SyncClaudeProjectArgs {
  projectRoot: string;
  targetSkillsDirs: string[];
  verbose: boolean;
  dryRun: boolean;
}

interface ManagedEntry {
  sourceKind: 'command' | 'agent';
  sourceRelPath: string;
  destRelPath: string;
}

interface ManifestFile {
  version: number;
  entries: ManagedEntry[];
}

interface ExpectedItem {
  itemKey: string;
  sourceKind: 'command' | 'agent';
  sourcePath: string;
  sourceRelPath: string;
  baseName: string;
}

const MANIFEST_FILENAME = '.skiller-claude.json';
const MANIFEST_VERSION = 1;
const LEGACY_PLUGIN_MARKER_FILENAME = '.skiller-plugin.json';

function sanitizeId(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '_');
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function makeItemKey(
  sourceKind: 'command' | 'agent',
  sourceRelPath: string,
): string {
  return `${sourceKind}::${sourceRelPath}`;
}

function getCommandsRoot(projectRoot: string): string {
  return path.join(projectRoot, '.claude', 'commands');
}

function getAgentsRoot(projectRoot: string): string {
  return path.join(projectRoot, '.claude', 'agents');
}

async function discoverCommandFiles(
  projectRoot: string,
): Promise<Array<{ name: string; file: string; rel: string }>> {
  const commandsRoot = getCommandsRoot(projectRoot);
  if (!(await fileExists(commandsRoot))) return [];

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
      const name = sanitizeId(path.basename(entry.name, '.md'));
      const rel = path.relative(projectRoot, full).replace(/\\/g, '/');
      results.push({ name, file: full, rel });
    }
  }

  await walk(commandsRoot, 0);
  return results;
}

async function discoverAgentFiles(
  projectRoot: string,
): Promise<Array<{ name: string; file: string; rel: string }>> {
  const agentsRoot = getAgentsRoot(projectRoot);
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

      const name = sanitizeId(fmName.trim());
      const rel = path.relative(projectRoot, full).replace(/\\/g, '/');
      results.push({ name, file: full, rel });
    }
  }

  await walk(agentsRoot, 0);
  return results;
}

async function readManifestFile(
  targetSkillsDir: string,
): Promise<ManifestFile | null> {
  const manifestPath = path.join(targetSkillsDir, MANIFEST_FILENAME);
  try {
    const raw = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as unknown;
    if (!raw || typeof raw !== 'object') return null;
    const obj = raw as Record<string, unknown>;
    if (typeof obj.version !== 'number') return null;
    if (!Array.isArray(obj.entries)) return null;

    const entries: ManagedEntry[] = [];
    for (const entry of obj.entries as unknown[]) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      if (e.sourceKind !== 'command' && e.sourceKind !== 'agent') continue;
      if (typeof e.sourceRelPath !== 'string') continue;
      if (typeof e.destRelPath !== 'string') continue;
      entries.push({
        sourceKind: e.sourceKind,
        sourceRelPath: e.sourceRelPath,
        destRelPath: e.destRelPath,
      });
    }

    return {
      version: obj.version as number,
      entries,
    };
  } catch {
    return null;
  }
}

async function writeManifestFile(
  targetSkillsDir: string,
  entries: ManagedEntry[],
  dryRun: boolean,
): Promise<void> {
  const manifestPath = path.join(targetSkillsDir, MANIFEST_FILENAME);

  if (entries.length === 0) {
    if (dryRun) return;
    try {
      await fs.unlink(manifestPath);
    } catch {
      // ignore
    }
    return;
  }

  const manifest: ManifestFile = {
    version: MANIFEST_VERSION,
    entries: [...entries].sort((a, b) => {
      const ak = `${a.destRelPath}::${a.sourceKind}::${a.sourceRelPath}`;
      const bk = `${b.destRelPath}::${b.sourceKind}::${b.sourceRelPath}`;
      return ak.localeCompare(bk);
    }),
  };

  if (dryRun) return;
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}

async function ensureDir(dir: string, dryRun: boolean): Promise<void> {
  if (dryRun) return;
  await fs.mkdir(dir, { recursive: true });
}

async function removeDir(dir: string, dryRun: boolean): Promise<void> {
  if (dryRun) return;
  await fs.rm(dir, { recursive: true, force: true });
}

async function writeMarkdownAsSkill(
  srcPath: string,
  destDir: string,
  generatedName: string,
  kindLabel: string,
  dryRun: boolean,
): Promise<void> {
  const content = await fs.readFile(srcPath, 'utf8');
  const { rawFrontmatter, body } = parseFrontmatter(content);
  const fm: Record<string, unknown> = rawFrontmatter
    ? { ...rawFrontmatter }
    : {};

  fm.name = generatedName;
  if (typeof fm.description !== 'string' || fm.description.trim() === '') {
    fm.description = `${kindLabel}: ${path.basename(srcPath, '.md')}`;
  }

  const next = `---\n${yaml
    .dump(fm, { lineWidth: -1, noRefs: true })
    .trim()}\n---\n\n${body}\n`;

  if (dryRun) return;
  await fs.writeFile(path.join(destDir, 'SKILL.md'), next, 'utf8');
}

async function readPluginManagedDestNames(
  targetSkillsDir: string,
): Promise<Set<string>> {
  const manifestPath = path.join(targetSkillsDir, '.skiller-plugins.json');
  const names = new Set<string>();

  try {
    const raw = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as unknown;
    if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      if (Array.isArray(obj.entries)) {
        for (const entry of obj.entries as unknown[]) {
          if (!entry || typeof entry !== 'object') continue;
          const e = entry as Record<string, unknown>;
          if (typeof e.destRelPath === 'string' && e.destRelPath.length > 0) {
            names.add(e.destRelPath);
          }
        }
      }
    }
  } catch {
    // ignore
  }

  // Legacy: prior versions wrote per-skill plugin marker files. Treat any
  // folder containing one as plugin-managed so project items can take over.
  try {
    const dirents = await fs.readdir(targetSkillsDir, { withFileTypes: true });
    for (const d of dirents) {
      if (!d.isDirectory()) continue;
      try {
        await fs.access(
          path.join(targetSkillsDir, d.name, LEGACY_PLUGIN_MARKER_FILENAME),
        );
        names.add(d.name);
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }

  return names;
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
      names.add(path.basename(current));
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

export async function syncClaudeProjectCommandsAndAgentsToSkillsDirs(
  args: SyncClaudeProjectArgs,
): Promise<void> {
  const { projectRoot, targetSkillsDirs, verbose, dryRun } = args;

  const localSkillNames = await discoverLocalSkillNames(projectRoot);

  const commands = await discoverCommandFiles(projectRoot);
  const agents = await discoverAgentFiles(projectRoot);

  const expectedItems: ExpectedItem[] = [];

  for (const cmd of commands) {
    expectedItems.push({
      itemKey: makeItemKey('command', cmd.rel),
      sourceKind: 'command',
      sourcePath: cmd.file,
      sourceRelPath: cmd.rel,
      baseName: cmd.name,
    });
  }

  for (const agent of agents) {
    expectedItems.push({
      itemKey: makeItemKey('agent', agent.rel),
      sourceKind: 'agent',
      sourcePath: agent.file,
      sourceRelPath: agent.rel,
      baseName: agent.name,
    });
  }

  const sortedItems = [...expectedItems].sort((a, b) => {
    const ak = `${a.baseName}::${a.sourceKind}::${a.sourceRelPath}`;
    const bk = `${b.baseName}::${b.sourceKind}::${b.sourceRelPath}`;
    return ak.localeCompare(bk);
  });

  for (const targetSkillsDir of targetSkillsDirs) {
    const targetExists = await fileExists(targetSkillsDir);

    const managedEntries = targetExists
      ? ((await readManifestFile(targetSkillsDir))?.entries ?? [])
      : [];

    const prevDestByItemKey = new Map<string, string>();
    for (const entry of managedEntries) {
      prevDestByItemKey.set(
        makeItemKey(entry.sourceKind, entry.sourceRelPath),
        entry.destRelPath,
      );
    }

    const managedDest = new Set<string>(
      managedEntries.map((e) => e.destRelPath),
    );

    const pluginManagedDest = targetExists
      ? await readPluginManagedDestNames(targetSkillsDir)
      : new Set<string>();

    const reserved = new Set<string>(localSkillNames);

    if (targetExists) {
      let dirents: Dirent[] = [];
      try {
        dirents = await fs.readdir(targetSkillsDir, { withFileTypes: true });
      } catch {
        dirents = [];
      }

      for (const d of dirents) {
        if (!d.isDirectory()) continue;
        // Reserve any existing folder we do not manage, except plugin-managed
        // folders (project should be able to take those over).
        if (!managedDest.has(d.name) && !pluginManagedDest.has(d.name)) {
          reserved.add(d.name);
        }
      }
    }

    const taken = new Set<string>(reserved);
    const assignedDestByItemKey = new Map<string, string>();

    // Preserve previous destinations when they are still available.
    for (const item of sortedItems) {
      const prev = prevDestByItemKey.get(item.itemKey);
      if (!prev) continue;
      // Migration: previous versions used `claude__<name>`.
      // Don't preserve legacy namespaced destinations so we can rename to the
      // new `claude-<name>` format.
      if (prev.startsWith('claude__')) continue;
      if (taken.has(prev)) continue;
      assignedDestByItemKey.set(item.itemKey, prev);
      taken.add(prev);
    }

    // Assign baseName, otherwise namespace with "claude-".
    for (const item of sortedItems) {
      if (assignedDestByItemKey.has(item.itemKey)) continue;

      const base = item.baseName;
      if (!taken.has(base)) {
        assignedDestByItemKey.set(item.itemKey, base);
        taken.add(base);
        continue;
      }

      const namespacedBase = `claude-${base}`;
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

    if (assignedItems.length > 0) {
      await ensureDir(targetSkillsDir, dryRun);
    } else if (!targetExists && managedEntries.length === 0) {
      // Nothing to do.
      continue;
    }

    // Install/update expected items
    for (const item of assignedItems) {
      const destRelPath = item.destRelPath;
      const destDir = path.join(targetSkillsDir, destRelPath);

      if (await fileExists(destDir)) {
        const isManagedByProject = managedDest.has(destRelPath);
        const isManagedByPlugin = pluginManagedDest.has(destRelPath);

        if (!isManagedByProject && !isManagedByPlugin) {
          logWarn(
            `[claude] Destination exists but is not skiller-managed, skipping: ${destDir}`,
            dryRun,
          );
          continue;
        }

        logVerboseInfo(
          dryRun
            ? `DRY RUN: Would update claude ${item.sourceKind} '${destRelPath}' in ${targetSkillsDir}`
            : `Updating claude ${item.sourceKind} '${destRelPath}' in ${targetSkillsDir}`,
          verbose,
          dryRun,
        );
        await removeDir(destDir, dryRun);
      }

      logVerboseInfo(
        dryRun
          ? `DRY RUN: Would install claude ${item.sourceKind} '${destRelPath}' to ${targetSkillsDir}`
          : `Installing claude ${item.sourceKind} '${destRelPath}' to ${targetSkillsDir}`,
        verbose,
        dryRun,
      );

      await ensureDir(destDir, dryRun);
      if (!dryRun) {
        await writeMarkdownAsSkill(
          item.sourcePath,
          destDir,
          destRelPath,
          item.sourceKind === 'command' ? 'Command' : 'Agent',
          dryRun,
        );
      }
    }

    // Cleanup stale managed folders
    const expectedDest = new Set<string>(
      assignedItems.map((i) => i.destRelPath),
    );
    const nextEntries: ManagedEntry[] = [];

    for (const entry of managedEntries) {
      if (expectedDest.has(entry.destRelPath)) {
        // Still expected; re-add below.
        continue;
      }

      if (reserved.has(entry.destRelPath)) {
        // User/local took over the folder name; stop managing it but don't delete.
        continue;
      }

      logVerboseInfo(
        dryRun
          ? `DRY RUN: Would remove stale claude skill '${entry.destRelPath}' from ${targetSkillsDir}`
          : `Removing stale claude skill '${entry.destRelPath}' from ${targetSkillsDir}`,
        verbose,
        dryRun,
      );
      await removeDir(path.join(targetSkillsDir, entry.destRelPath), dryRun);
    }

    for (const item of assignedItems) {
      nextEntries.push({
        sourceKind: item.sourceKind,
        sourceRelPath: item.sourceRelPath,
        destRelPath: item.destRelPath,
      });
    }

    await writeManifestFile(targetSkillsDir, nextEntries, dryRun);
  }
}
