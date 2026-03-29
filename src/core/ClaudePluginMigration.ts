import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { CANONICAL_SKILLER_DIR, LEGACY_SKILLER_DIR } from './project-paths';
import { SKILLS_MANIFEST_FILENAME } from './SkillsManifest';

export interface ClaudePluginMigrationInstall {
  source: string;
  pluginIds: string[];
  strategy: 'plugin-source' | 'marketplace-source';
}

export interface ClaudePluginMigrationUnresolved {
  pluginId: string;
  reason: string;
}

export interface ClaudePluginMigrationPlan {
  installs: ClaudePluginMigrationInstall[];
  unresolved: ClaudePluginMigrationUnresolved[];
}

interface MarketplaceRecord {
  installLocation?: string;
  source?: unknown;
}

interface PluginDescriptor {
  source?: unknown;
}

interface PluginIdParts {
  pluginName: string;
  marketplaceId: string;
}

function getClaudeHomeDir(): string {
  return process.env.HOME || os.homedir();
}

async function readJsonFile(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

function parsePluginId(pluginId: string): PluginIdParts | null {
  const atIndex = pluginId.lastIndexOf('@');
  if (atIndex <= 0 || atIndex === pluginId.length - 1) return null;

  return {
    pluginName: pluginId.slice(0, atIndex),
    marketplaceId: pluginId.slice(atIndex + 1),
  };
}

function normalizeInstallSource(source: unknown): string | null {
  if (!source || typeof source !== 'object') return null;

  const raw = source as Record<string, unknown>;
  if (raw.source === 'github' && typeof raw.repo === 'string') {
    return raw.repo;
  }
  if (
    (raw.source === 'git' || raw.source === 'url') &&
    typeof raw.url === 'string'
  ) {
    return raw.url;
  }

  return null;
}

async function readEnabledPluginIds(projectRoot: string): Promise<string[]> {
  const settingsPath = path.join(
    projectRoot,
    LEGACY_SKILLER_DIR,
    'settings.json',
  );
  const raw = await readJsonFile(settingsPath);
  if (!raw || typeof raw !== 'object') return [];

  const enabledPlugins = (raw as Record<string, unknown>).enabledPlugins;
  if (!enabledPlugins || typeof enabledPlugins !== 'object') return [];

  return Object.entries(enabledPlugins as Record<string, unknown>)
    .filter(([, enabled]) => enabled === true)
    .map(([pluginId]) => pluginId)
    .sort((a, b) => a.localeCompare(b));
}

async function readManifestPluginIds(projectRoot: string): Promise<string[]> {
  const manifestPaths = [
    path.join(projectRoot, CANONICAL_SKILLER_DIR, SKILLS_MANIFEST_FILENAME),
    path.join(projectRoot, LEGACY_SKILLER_DIR, SKILLS_MANIFEST_FILENAME),
  ];

  const pluginIds = new Set<string>();

  for (const manifestPath of manifestPaths) {
    const raw = await readJsonFile(manifestPath);
    if (!raw || typeof raw !== 'object') continue;

    const targets = (raw as Record<string, unknown>).targets;
    if (!targets || typeof targets !== 'object') continue;

    for (const entries of Object.values(targets as Record<string, unknown>)) {
      if (!Array.isArray(entries)) continue;

      for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue;
        const sourceType = (entry as Record<string, unknown>).sourceType;
        const pluginId = (entry as Record<string, unknown>).pluginId;
        if (sourceType === 'plugin' && typeof pluginId === 'string') {
          pluginIds.add(pluginId);
        }
      }
    }
  }

  return [...pluginIds].sort((a, b) => a.localeCompare(b));
}

async function readProjectMarketplaceRecords(
  projectRoot: string,
): Promise<Record<string, MarketplaceRecord>> {
  const settingsPath = path.join(
    projectRoot,
    LEGACY_SKILLER_DIR,
    'settings.json',
  );
  const raw = await readJsonFile(settingsPath);
  if (!raw || typeof raw !== 'object') return {};

  const marketplaces = (raw as Record<string, unknown>).extraKnownMarketplaces;
  if (!marketplaces || typeof marketplaces !== 'object') return {};

  return Object.fromEntries(
    Object.entries(marketplaces as Record<string, unknown>).filter(
      ([, value]) => value && typeof value === 'object',
    ),
  ) as Record<string, MarketplaceRecord>;
}

async function readHomeMarketplaceRecords(): Promise<
  Record<string, MarketplaceRecord>
> {
  const knownPath = path.join(
    getClaudeHomeDir(),
    '.claude',
    'plugins',
    'known_marketplaces.json',
  );
  const raw = await readJsonFile(knownPath);
  if (!raw || typeof raw !== 'object') return {};
  return raw as Record<string, MarketplaceRecord>;
}

function mergeMarketplaceRecords(
  homeRecords: Record<string, MarketplaceRecord>,
  projectRecords: Record<string, MarketplaceRecord>,
): Record<string, MarketplaceRecord> {
  return {
    ...homeRecords,
    ...projectRecords,
  };
}

async function readMarketplacePlugins(
  marketplaceId: string,
  marketplace: MarketplaceRecord | undefined,
): Promise<Record<string, PluginDescriptor>> {
  const candidates: string[] = [];

  if (typeof marketplace?.installLocation === 'string') {
    candidates.push(
      path.join(
        marketplace.installLocation,
        '.claude-plugin',
        'marketplace.json',
      ),
    );
  }

  candidates.push(
    path.join(
      getClaudeHomeDir(),
      '.claude',
      'plugins',
      'marketplaces',
      marketplaceId,
      '.claude-plugin',
      'marketplace.json',
    ),
  );

  for (const candidate of candidates) {
    const raw = await readJsonFile(candidate);
    if (!raw || typeof raw !== 'object') continue;

    const plugins = (raw as Record<string, unknown>).plugins;
    if (!Array.isArray(plugins)) continue;

    const next: Record<string, PluginDescriptor> = {};
    for (const plugin of plugins) {
      if (!plugin || typeof plugin !== 'object') continue;
      const pluginName = (plugin as Record<string, unknown>).name;
      if (typeof pluginName !== 'string') continue;
      next[pluginName] = {
        source: (plugin as Record<string, unknown>).source,
      };
    }
    return next;
  }

  return {};
}

function sortPlan(
  installsBySource: Map<
    string,
    {
      pluginIds: Set<string>;
      strategy: ClaudePluginMigrationInstall['strategy'];
    }
  >,
  unresolved: ClaudePluginMigrationUnresolved[],
): ClaudePluginMigrationPlan {
  const installs = [...installsBySource.entries()]
    .map(([source, info]) => ({
      source,
      pluginIds: [...info.pluginIds].sort((a, b) => a.localeCompare(b)),
      strategy: info.strategy,
    }))
    .sort((a, b) => a.source.localeCompare(b.source));

  return {
    installs,
    unresolved: [...unresolved].sort((a, b) =>
      a.pluginId.localeCompare(b.pluginId),
    ),
  };
}

export async function planClaudePluginSkillsMigration(
  projectRoot: string,
): Promise<ClaudePluginMigrationPlan> {
  const pluginIds = new Set<string>([
    ...(await readEnabledPluginIds(projectRoot)),
    ...(await readManifestPluginIds(projectRoot)),
  ]);

  const homeMarketplaces = await readHomeMarketplaceRecords();
  const projectMarketplaces = await readProjectMarketplaceRecords(projectRoot);
  const marketplaces = mergeMarketplaceRecords(
    homeMarketplaces,
    projectMarketplaces,
  );
  const installsBySource = new Map<
    string,
    {
      pluginIds: Set<string>;
      strategy: ClaudePluginMigrationInstall['strategy'];
    }
  >();
  const unresolved: ClaudePluginMigrationUnresolved[] = [];
  const pluginCatalogCache = new Map<
    string,
    Record<string, PluginDescriptor>
  >();

  for (const pluginId of [...pluginIds].sort((a, b) => a.localeCompare(b))) {
    const parts = parsePluginId(pluginId);
    if (!parts) {
      unresolved.push({
        pluginId,
        reason: 'Plugin id is not in <plugin>@<marketplace> format',
      });
      continue;
    }

    const marketplace = marketplaces[parts.marketplaceId];
    let pluginDescriptors = pluginCatalogCache.get(parts.marketplaceId);
    if (!pluginDescriptors) {
      pluginDescriptors = await readMarketplacePlugins(
        parts.marketplaceId,
        marketplace,
      );
      pluginCatalogCache.set(parts.marketplaceId, pluginDescriptors);
    }

    const pluginDescriptor = pluginDescriptors[parts.pluginName];
    const pluginSource = normalizeInstallSource(pluginDescriptor?.source);
    const marketplaceSource = normalizeInstallSource(marketplace?.source);

    const resolvedSource = pluginSource ?? marketplaceSource;
    if (!resolvedSource) {
      unresolved.push({
        pluginId,
        reason: `No repo or URL source could be inferred for marketplace ${parts.marketplaceId}`,
      });
      continue;
    }

    const existing = installsBySource.get(resolvedSource);
    if (existing) {
      existing.pluginIds.add(pluginId);
      continue;
    }

    installsBySource.set(resolvedSource, {
      pluginIds: new Set([pluginId]),
      strategy: pluginSource ? 'plugin-source' : 'marketplace-source',
    });
  }

  return sortPlan(installsBySource, unresolved);
}
