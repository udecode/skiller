import * as fs from 'fs/promises';
import * as path from 'path';
import { CANONICAL_SKILLER_DIR, LEGACY_SKILLER_DIR } from './project-paths';
import { SKILLS_MANIFEST_FILENAME } from './SkillsManifest';

interface LegacyPluginManifestLocation {
  manifestPath: string;
  pluginIds: string[];
}

async function readEnabledPluginIds(projectRoot: string): Promise<string[]> {
  const settingsPath = path.join(
    projectRoot,
    LEGACY_SKILLER_DIR,
    'settings.json',
  );

  try {
    const raw = JSON.parse(await fs.readFile(settingsPath, 'utf8')) as unknown;
    if (!raw || typeof raw !== 'object') return [];

    const enabledPlugins = (raw as Record<string, unknown>).enabledPlugins;
    if (!enabledPlugins || typeof enabledPlugins !== 'object') return [];

    return Object.entries(enabledPlugins as Record<string, unknown>)
      .filter(([, enabled]) => enabled === true)
      .map(([pluginId]) => pluginId)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function readPluginIdsFromManifestRaw(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') return [];

  const targets = (raw as Record<string, unknown>).targets;
  if (!targets || typeof targets !== 'object') return [];

  const pluginIds = new Set<string>();

  for (const rawEntries of Object.values(targets as Record<string, unknown>)) {
    if (!Array.isArray(rawEntries)) continue;

    for (const entry of rawEntries) {
      if (!entry || typeof entry !== 'object') continue;

      const sourceType = (entry as Record<string, unknown>).sourceType;
      const pluginId = (entry as Record<string, unknown>).pluginId;
      if (sourceType !== 'plugin' || typeof pluginId !== 'string') continue;

      pluginIds.add(pluginId);
    }
  }

  return [...pluginIds].sort((a, b) => a.localeCompare(b));
}

async function readPluginManifestLocations(
  projectRoot: string,
): Promise<LegacyPluginManifestLocation[]> {
  const manifestPaths = [
    path.join(projectRoot, CANONICAL_SKILLER_DIR, SKILLS_MANIFEST_FILENAME),
    path.join(projectRoot, LEGACY_SKILLER_DIR, SKILLS_MANIFEST_FILENAME),
  ];

  const locations: LegacyPluginManifestLocation[] = [];

  for (const manifestPath of manifestPaths) {
    try {
      const raw = JSON.parse(
        await fs.readFile(manifestPath, 'utf8'),
      ) as unknown;
      const pluginIds = readPluginIdsFromManifestRaw(raw);
      if (pluginIds.length === 0) continue;

      locations.push({
        manifestPath,
        pluginIds,
      });
    } catch {
      // Ignore missing or invalid manifests here. Validation lives elsewhere.
    }
  }

  return locations;
}

export async function assertNoLegacyClaudePluginState(
  projectRoot: string,
): Promise<void> {
  const enabledPluginIds = await readEnabledPluginIds(projectRoot);
  const manifestLocations = await readPluginManifestLocations(projectRoot);

  if (enabledPluginIds.length === 0 && manifestLocations.length === 0) {
    return;
  }

  const lines = [
    'Claude plugin sync is no longer supported.',
    '',
    'Found legacy Claude plugin state:',
  ];

  if (enabledPluginIds.length > 0) {
    lines.push(
      `- enabled plugins in .claude/settings.json: ${enabledPluginIds.join(', ')}`,
    );
  }

  for (const location of manifestLocations) {
    lines.push(
      `- plugin manifest entries in ${path.relative(projectRoot, location.manifestPath)}: ${location.pluginIds.join(', ')}`,
    );
  }

  lines.push(
    '',
    'Migrate manually:',
    '1. Run `skiller migrate claude-plugins` to preview the repo installs, then rerun it with `--execute`',
    '2. Remove the plugin from .claude/settings.json',
    '3. Rerun `skiller apply`',
  );

  throw new Error(lines.join('\n'));
}
