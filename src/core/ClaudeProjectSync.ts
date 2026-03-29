import type { Dirent } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { MAX_RECURSION_DEPTH, logVerboseInfo, logWarn } from '../constants';
import { parseFrontmatter } from './FrontmatterParser';
import {
  isClaudeManifestEntry,
  loadSkillsManifestEntries,
  loadLocalSkillNames,
  type ClaudeSkillsManifestEntry,
  type SkillsManifestEntry,
  writeSkillsManifestEntries,
} from './SkillsManifest';
import { CANONICAL_SKILLER_DIR } from './project-paths';

export interface SyncClaudeProjectArgs {
  projectRoot: string;
  targetSkillsDirs: string[];
  verbose: boolean;
  dryRun: boolean;
}

interface ExpectedItem {
  itemKey: string;
  sourceKind: 'command' | 'agent';
  sourcePath: string;
  sourceRelPath: string;
  baseName: string;
}

type ManagedEntry = ClaudeSkillsManifestEntry;

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
      const relFromCommands = path
        .relative(commandsRoot, full)
        .replace(/\\/g, '/');
      const withoutExt = relFromCommands.endsWith('.md')
        ? relFromCommands.slice(0, -'.md'.length)
        : relFromCommands;
      const segments = withoutExt.split('/').filter(Boolean);
      const name = segments.map(sanitizeId).join('-');
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

async function discoverLocalSkillNames(
  projectRoot: string,
): Promise<Set<string>> {
  return new Set(await loadLocalSkillNames(projectRoot));
}

async function discoverCanonicalSkillNames(
  projectRoot: string,
): Promise<Set<string>> {
  const skillsRoot = path.join(projectRoot, CANONICAL_SKILLER_DIR, 'skills');
  if (!(await fileExists(skillsRoot))) return new Set<string>();

  const names = new Set<string>();

  async function walk(
    current: string,
    rel: string,
    depth: number,
  ): Promise<void> {
    if (depth >= MAX_RECURSION_DEPTH) return;

    if (rel && (await fileExists(path.join(current, 'SKILL.md')))) {
      names.add(rel.split('/').filter(Boolean).map(sanitizeId).join('-'));
      return;
    }

    let entries: Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const nextRel = rel ? `${rel}/${entry.name}` : entry.name;
      await walk(path.join(current, entry.name), nextRel, depth + 1);
    }
  }

  await walk(skillsRoot, '', 0);
  return names;
}

export async function syncClaudeProjectCommandsAndAgentsToSkillsDirs(
  args: SyncClaudeProjectArgs,
): Promise<void> {
  const { projectRoot, targetSkillsDirs, verbose, dryRun } = args;

  const localSkillNames = await discoverLocalSkillNames(projectRoot);
  const canonicalSkillNames = await discoverCanonicalSkillNames(projectRoot);

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

    const managedEntries: ManagedEntry[] = [];
    const otherEntries: SkillsManifestEntry[] = [];
    if (targetExists) {
      const allEntries = await loadSkillsManifestEntries(
        projectRoot,
        targetSkillsDir,
      );
      for (const entry of allEntries) {
        if (isClaudeManifestEntry(entry)) {
          managedEntries.push(entry);
        } else {
          otherEntries.push(entry);
        }
      }
    }

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
    const reservedCanonicalNames = new Set<string>([
      ...canonicalSkillNames,
      ...localSkillNames,
    ]);
    const canonicalSkillsDir = path.join(
      projectRoot,
      CANONICAL_SKILLER_DIR,
      'skills',
    );

    if (path.resolve(targetSkillsDir) === path.resolve(canonicalSkillsDir)) {
      for (const entry of managedEntries) {
        reservedCanonicalNames.delete(entry.destRelPath);
      }
    }

    const activeItems = sortedItems.filter((item) => {
      if (!reservedCanonicalNames.has(item.baseName)) {
        return true;
      }

      logVerboseInfo(
        `Skipping claude ${item.sourceKind} '${item.baseName}' because canonical skills already own that name`,
        verbose,
        dryRun,
      );
      return false;
    });

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
        if (!managedDest.has(d.name)) {
          reserved.add(d.name);
        }
      }
    }

    const taken = new Set<string>(reserved);
    const assignedDestByItemKey = new Map<string, string>();

    // Preserve previous destinations when they are still available.
    for (const item of activeItems) {
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
    for (const item of activeItems) {
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

    const assignedItems = activeItems.map((item) => ({
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
        if (!managedDest.has(destRelPath)) {
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
        sourceType: 'claude',
        sourceKind: item.sourceKind,
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
