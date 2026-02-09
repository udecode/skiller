import * as fs from 'fs/promises';
import * as path from 'path';
import type { Dirent } from 'fs';

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

interface SkillsManifestFile {
  version: number;
  entries: SkillsManifestEntry[];
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

export async function loadSkillsManifestEntries(
  targetSkillsDir: string,
): Promise<SkillsManifestEntry[]> {
  const manifestPath = path.join(targetSkillsDir, SKILLS_MANIFEST_FILENAME);
  if (await fileExists(manifestPath)) {
    try {
      const raw = JSON.parse(
        await fs.readFile(manifestPath, 'utf8'),
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

export async function writeSkillsManifestEntries(
  targetSkillsDir: string,
  entries: SkillsManifestEntry[],
  dryRun: boolean,
): Promise<void> {
  const manifestPath = path.join(targetSkillsDir, SKILLS_MANIFEST_FILENAME);
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

  const normalized = normalizeEntries(entries);

  if (normalized.length === 0) {
    if (dryRun) return;
    await Promise.allSettled([
      fs.unlink(manifestPath),
      fs.unlink(legacyUnifiedPath),
      fs.unlink(legacyPluginPath),
      fs.unlink(legacyClaudePath),
    ]);
    return;
  }

  const manifest: SkillsManifestFile = {
    version: SKILLS_MANIFEST_VERSION,
    entries: normalized,
  };

  if (dryRun) return;

  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  // Clean up legacy manifests once unified is written.
  await Promise.allSettled([
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
