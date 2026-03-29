import * as fs from 'fs/promises';
import * as path from 'path';
import type { Dirent } from 'fs';
import { CANONICAL_SKILLER_DIR, LEGACY_SKILLER_DIR } from './project-paths';

// Project-level manifest (stored in `.claude/.skiller.json`) that tracks what
// Skiller installed into each target agent skills directory for this project.
export const SKILLS_MANIFEST_FILENAME = '.skiller.json';
export const LEGACY_UNIFIED_SKILLS_MANIFEST_FILENAME = '.skiller-skills.json';
export const LEGACY_PLUGIN_MANIFEST_FILENAME = '.skiller-plugins.json';
export const LEGACY_CLAUDE_MANIFEST_FILENAME = '.skiller-claude.json';
export const SKILLS_MANIFEST_VERSION = 1;

export type SkillsManifestEntry =
  | PluginSkillsManifestEntry
  | ClaudeSkillsManifestEntry;

export interface PluginSkillsManifestEntry {
  sourceType: 'plugin';
  pluginId: string;
  pluginVersion?: string;
  sourceKind: 'skill' | 'command' | 'agent';
  sourceRelPath: string;
  destRelPath: string;
}

export interface ClaudeSkillsManifestEntry {
  sourceType: 'claude';
  sourceKind: 'command' | 'agent';
  sourceRelPath: string;
  destRelPath: string;
}

interface ProjectSkillsManifestFile {
  version: number;
  targets: Record<string, SkillsManifestEntry[]>;
  localSkills?: string[];
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export function isPluginManifestEntry(
  entry: SkillsManifestEntry,
): entry is PluginSkillsManifestEntry {
  return entry.sourceType === 'plugin';
}

export function isClaudeManifestEntry(
  entry: SkillsManifestEntry,
): entry is ClaudeSkillsManifestEntry {
  return entry.sourceType === 'claude';
}

function normalizeEntries(
  entries: SkillsManifestEntry[],
): SkillsManifestEntry[] {
  // Dedupe by a stable identity that doesn't depend on JSON key order.
  const seen = new Set<string>();
  const out: SkillsManifestEntry[] = [];

  for (const e of entries) {
    const key =
      e.sourceType === 'plugin'
        ? `plugin::${e.destRelPath}::${e.pluginId}::${e.sourceKind}::${e.sourceRelPath}`
        : `claude::${e.destRelPath}::${e.sourceKind}::${e.sourceRelPath}`;

    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }

  out.sort((a, b) => {
    const ak =
      a.sourceType === 'plugin'
        ? `plugin::${a.destRelPath}::${a.pluginId}::${a.sourceKind}::${a.sourceRelPath}`
        : `claude::${a.destRelPath}::${a.sourceKind}::${a.sourceRelPath}`;
    const bk =
      b.sourceType === 'plugin'
        ? `plugin::${b.destRelPath}::${b.pluginId}::${b.sourceKind}::${b.sourceRelPath}`
        : `claude::${b.destRelPath}::${b.sourceKind}::${b.sourceRelPath}`;
    return ak.localeCompare(bk);
  });

  return out;
}

function parseUnifiedEntries(raw: unknown): SkillsManifestEntry[] {
  if (!raw || typeof raw !== 'object') return [];
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.entries)) return [];

  const entries: SkillsManifestEntry[] = [];

  for (const entry of obj.entries as unknown[]) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;

    const sourceType = e.sourceType;
    const sourceKind = e.sourceKind;

    if (sourceType === 'plugin') {
      if (typeof e.pluginId !== 'string') continue;
      if (
        sourceKind !== 'skill' &&
        sourceKind !== 'command' &&
        sourceKind !== 'agent'
      )
        continue;
      if (typeof e.sourceRelPath !== 'string') continue;
      if (typeof e.destRelPath !== 'string') continue;
      entries.push({
        sourceType: 'plugin',
        pluginId: e.pluginId,
        pluginVersion:
          typeof e.pluginVersion === 'string' ? e.pluginVersion : undefined,
        sourceKind,
        sourceRelPath: e.sourceRelPath,
        destRelPath: e.destRelPath,
      });
      continue;
    }

    if (sourceType === 'claude') {
      if (sourceKind !== 'command' && sourceKind !== 'agent') continue;
      if (typeof e.sourceRelPath !== 'string') continue;
      if (typeof e.destRelPath !== 'string') continue;
      entries.push({
        sourceType: 'claude',
        sourceKind,
        sourceRelPath: e.sourceRelPath,
        destRelPath: e.destRelPath,
      });
      continue;
    }
  }

  return entries;
}

function normalizePathForKey(p: string): string {
  return path.resolve(p).replace(/\\/g, '/');
}

function computeTargetKey(
  projectRoot: string,
  targetSkillsDir: string,
): string {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const resolvedTarget = path.resolve(targetSkillsDir);
  if (resolvedTarget === resolvedProjectRoot) return '.';
  if (resolvedTarget.startsWith(resolvedProjectRoot + path.sep)) {
    return path
      .relative(resolvedProjectRoot, resolvedTarget)
      .replace(/\\/g, '/');
  }
  return normalizePathForKey(resolvedTarget);
}

function computeCompatibleTargetKeys(
  projectRoot: string,
  targetSkillsDir: string,
): string[] {
  const keys = new Set<string>([
    computeTargetKey(projectRoot, targetSkillsDir),
    normalizePathForKey(targetSkillsDir),
  ]);

  const resolvedTarget = path.resolve(targetSkillsDir);
  const canonicalSkillsDir = path.resolve(
    projectRoot,
    CANONICAL_SKILLER_DIR,
    'skills',
  );
  const legacySkillsDir = path.resolve(
    projectRoot,
    LEGACY_SKILLER_DIR,
    'skills',
  );

  if (
    resolvedTarget === canonicalSkillsDir ||
    resolvedTarget === legacySkillsDir
  ) {
    const aliasTarget =
      resolvedTarget === canonicalSkillsDir
        ? legacySkillsDir
        : canonicalSkillsDir;
    keys.add(computeTargetKey(projectRoot, aliasTarget));
    keys.add(normalizePathForKey(aliasTarget));
  }

  return [...keys];
}

function parseProjectTargets(
  raw: unknown,
): Record<string, SkillsManifestEntry[]> {
  if (!raw || typeof raw !== 'object') return {};
  const obj = raw as Record<string, unknown>;
  if (!obj.targets || typeof obj.targets !== 'object') return {};

  const targetsObj = obj.targets as Record<string, unknown>;
  const out: Record<string, SkillsManifestEntry[]> = {};

  for (const [targetKey, rawEntries] of Object.entries(targetsObj)) {
    // Stored as an array of entries per target.
    if (!Array.isArray(rawEntries)) continue;
    out[targetKey] = normalizeEntries(
      parseUnifiedEntries({ entries: rawEntries } as unknown),
    );
  }

  return out;
}

function parseLocalSkills(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') return [];
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.localSkills)) return [];

  return [
    ...new Set(
      obj.localSkills.filter((v): v is string => typeof v === 'string'),
    ),
  ].sort((a, b) => a.localeCompare(b));
}

async function readProjectManifestRaw(
  projectRoot: string,
): Promise<unknown | null> {
  const canonicalManifestPath = path.join(
    projectRoot,
    CANONICAL_SKILLER_DIR,
    SKILLS_MANIFEST_FILENAME,
  );
  const legacyManifestPath = path.join(
    projectRoot,
    LEGACY_SKILLER_DIR,
    SKILLS_MANIFEST_FILENAME,
  );

  for (const manifestPath of [canonicalManifestPath, legacyManifestPath]) {
    if (!(await fileExists(manifestPath))) continue;
    try {
      return JSON.parse(await fs.readFile(manifestPath, 'utf8')) as unknown;
    } catch {
      return null;
    }
  }

  return null;
}

function parseLegacyPluginEntries(raw: unknown): PluginSkillsManifestEntry[] {
  if (!raw || typeof raw !== 'object') return [];
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.entries)) return [];

  const entries: PluginSkillsManifestEntry[] = [];
  for (const entry of obj.entries as unknown[]) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.pluginId !== 'string') continue;
    const sourceKind = e.sourceKind;
    if (
      sourceKind !== 'skill' &&
      sourceKind !== 'command' &&
      sourceKind !== 'agent'
    )
      continue;
    if (typeof e.sourceRelPath !== 'string') continue;
    if (typeof e.destRelPath !== 'string') continue;
    entries.push({
      sourceType: 'plugin',
      pluginId: e.pluginId,
      pluginVersion:
        typeof e.pluginVersion === 'string' ? e.pluginVersion : undefined,
      sourceKind,
      sourceRelPath: e.sourceRelPath,
      destRelPath: e.destRelPath,
    });
  }

  return entries;
}

function parseLegacyClaudeEntries(raw: unknown): ClaudeSkillsManifestEntry[] {
  if (!raw || typeof raw !== 'object') return [];
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.entries)) return [];

  const entries: ClaudeSkillsManifestEntry[] = [];
  for (const entry of obj.entries as unknown[]) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const sourceKind = e.sourceKind;
    if (sourceKind !== 'command' && sourceKind !== 'agent') continue;
    if (typeof e.sourceRelPath !== 'string') continue;
    if (typeof e.destRelPath !== 'string') continue;
    entries.push({
      sourceType: 'claude',
      sourceKind,
      sourceRelPath: e.sourceRelPath,
      destRelPath: e.destRelPath,
    });
  }

  return entries;
}

async function loadLegacyTargetSkillsManifestEntries(
  targetSkillsDir: string,
): Promise<SkillsManifestEntry[]> {
  const legacyManifestPath = path.join(
    targetSkillsDir,
    SKILLS_MANIFEST_FILENAME,
  );
  if (await fileExists(legacyManifestPath)) {
    try {
      const raw = JSON.parse(
        await fs.readFile(legacyManifestPath, 'utf8'),
      ) as unknown;
      return normalizeEntries(parseUnifiedEntries(raw));
    } catch {
      return [];
    }
  }

  // Migration: previous versions used a different unified filename.
  const legacyUnifiedPath = path.join(
    targetSkillsDir,
    LEGACY_UNIFIED_SKILLS_MANIFEST_FILENAME,
  );
  if (await fileExists(legacyUnifiedPath)) {
    try {
      const raw = JSON.parse(
        await fs.readFile(legacyUnifiedPath, 'utf8'),
      ) as unknown;
      return normalizeEntries(parseUnifiedEntries(raw));
    } catch {
      return [];
    }
  }

  // No unified manifest yet: merge legacy manifests if present.
  const merged: SkillsManifestEntry[] = [];

  const legacyPluginPath = path.join(
    targetSkillsDir,
    LEGACY_PLUGIN_MANIFEST_FILENAME,
  );
  if (await fileExists(legacyPluginPath)) {
    try {
      const raw = JSON.parse(
        await fs.readFile(legacyPluginPath, 'utf8'),
      ) as unknown;
      merged.push(...parseLegacyPluginEntries(raw));
    } catch {
      // ignore
    }
  }

  const legacyClaudePath = path.join(
    targetSkillsDir,
    LEGACY_CLAUDE_MANIFEST_FILENAME,
  );
  if (await fileExists(legacyClaudePath)) {
    try {
      const raw = JSON.parse(
        await fs.readFile(legacyClaudePath, 'utf8'),
      ) as unknown;
      merged.push(...parseLegacyClaudeEntries(raw));
    } catch {
      // ignore
    }
  }

  return normalizeEntries(merged);
}

export async function loadSkillsManifestEntries(
  projectRoot: string,
  targetSkillsDir: string,
): Promise<SkillsManifestEntry[]> {
  const raw = await readProjectManifestRaw(projectRoot);
  if (raw) {
    const targets = parseProjectTargets(raw);
    for (const key of computeCompatibleTargetKeys(
      projectRoot,
      targetSkillsDir,
    )) {
      const entries = targets[key];
      if (entries) return normalizeEntries(entries);
    }
    return [];
  }

  // Legacy migration: prior versions stored manifests in the target skills dir.
  return await loadLegacyTargetSkillsManifestEntries(targetSkillsDir);
}

export async function loadLocalSkillNames(
  projectRoot: string,
): Promise<string[]> {
  const raw = await readProjectManifestRaw(projectRoot);
  return parseLocalSkills(raw);
}

export async function writeLocalSkillNames(
  projectRoot: string,
  localSkillNames: string[],
  dryRun: boolean,
): Promise<void> {
  const projectSkillerDir = path.join(projectRoot, CANONICAL_SKILLER_DIR);
  const projectManifestPath = path.join(
    projectSkillerDir,
    SKILLS_MANIFEST_FILENAME,
  );

  const raw = await readProjectManifestRaw(projectRoot);
  const existingTargets = parseProjectTargets(raw);
  const nextLocalSkills = [...new Set(localSkillNames)].sort((a, b) =>
    a.localeCompare(b),
  );

  if (dryRun) return;

  await fs.mkdir(projectSkillerDir, { recursive: true });

  const manifest: ProjectSkillsManifestFile = {
    version: SKILLS_MANIFEST_VERSION,
    targets: existingTargets,
    localSkills: nextLocalSkills,
  };

  await fs.writeFile(
    projectManifestPath,
    JSON.stringify(manifest, null, 2) + '\n',
  );
}

export async function writeSkillsManifestEntries(
  projectRoot: string,
  targetSkillsDir: string,
  entries: SkillsManifestEntry[],
  dryRun: boolean,
): Promise<void> {
  const normalized = normalizeEntries(entries);

  const projectClaudeDir = path.join(projectRoot, CANONICAL_SKILLER_DIR);
  const projectManifestPath = path.join(
    projectClaudeDir,
    SKILLS_MANIFEST_FILENAME,
  );

  const preferredTargetKey = computeTargetKey(projectRoot, targetSkillsDir);
  const absoluteTargetKey = normalizePathForKey(targetSkillsDir);

  let existingTargets: Record<string, SkillsManifestEntry[]> = {};
  const raw = await readProjectManifestRaw(projectRoot);
  existingTargets = parseProjectTargets(raw);
  const existingLocalSkills = parseLocalSkills(raw);

  if (normalized.length === 0) {
    delete existingTargets[preferredTargetKey];
    if (preferredTargetKey !== absoluteTargetKey) {
      delete existingTargets[absoluteTargetKey];
    }
  } else {
    existingTargets[preferredTargetKey] = normalized;
    if (preferredTargetKey !== absoluteTargetKey) {
      delete existingTargets[absoluteTargetKey];
    }
  }

  if (dryRun) return;

  // Ensure `.claude` exists since the manifest lives there.
  await fs.mkdir(projectClaudeDir, { recursive: true });

  const targetKeys = Object.keys(existingTargets).sort((a, b) =>
    a.localeCompare(b),
  );
  if (targetKeys.length === 0) {
    await Promise.allSettled([fs.unlink(projectManifestPath)]);
  } else {
    const nextTargets: Record<string, SkillsManifestEntry[]> = {};
    for (const key of targetKeys) nextTargets[key] = existingTargets[key];

    const manifest: ProjectSkillsManifestFile = {
      version: SKILLS_MANIFEST_VERSION,
      targets: nextTargets,
      localSkills: existingLocalSkills,
    };
    await fs.writeFile(
      projectManifestPath,
      JSON.stringify(manifest, null, 2) + '\n',
    );
  }

  // Remove legacy per-target manifests so users see a single `.claude/.skiller.json`.
  const legacyManifestPath = path.join(
    targetSkillsDir,
    SKILLS_MANIFEST_FILENAME,
  );
  const legacyUnifiedPath = path.join(
    targetSkillsDir,
    LEGACY_UNIFIED_SKILLS_MANIFEST_FILENAME,
  );
  const legacyPluginPath = path.join(
    targetSkillsDir,
    LEGACY_PLUGIN_MANIFEST_FILENAME,
  );
  const legacyClaudePath = path.join(
    targetSkillsDir,
    LEGACY_CLAUDE_MANIFEST_FILENAME,
  );
  await Promise.allSettled([
    fs.unlink(legacyManifestPath),
    fs.unlink(legacyUnifiedPath),
    fs.unlink(legacyPluginPath),
    fs.unlink(legacyClaudePath),
  ]);
}

export async function listSkillDirectories(
  targetSkillsDir: string,
): Promise<Dirent[]> {
  try {
    const dirents = await fs.readdir(targetSkillsDir, { withFileTypes: true });
    return dirents.filter((d) => d.isDirectory());
  } catch {
    return [];
  }
}
