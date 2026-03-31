import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parse as parseTOML } from '@iarna/toml';
import { z } from 'zod';
import {
  McpConfig,
  GlobalMcpConfig,
  GitignoreConfig,
  BackupConfig,
  SkillsConfig,
  RulesConfig,
  SyncConfig,
  SyncMode,
} from '../types';
import { createSkillerError } from '../constants';
import { CANONICAL_SKILLER_DIR, SKILLER_CONFIG_FILE } from './project-paths';

interface ErrnoException extends Error {
  code?: string;
}

const mcpConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    merge_strategy: z.enum(['merge', 'overwrite']).optional(),
  })
  .optional();

const agentConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    output_path: z.string().optional(),
    output_path_instructions: z.string().optional(),
    output_path_config: z.string().optional(),
    mcp: mcpConfigSchema,
  })
  .optional();

const syncConfigSchema = z
  .object({
    source: z.string(),
    mode: z.enum(['auto', 'preset', 'repo']).optional(),
    clean: z.boolean().optional(),
    include: z.array(z.string()).optional(),
    exclude: z.array(z.string()).optional(),
  })
  .optional();

const skillerConfigSchema = z.object({
  default_agents: z.array(z.string()).optional(),
  root_folder: z.string().optional(),
  agents: z.record(z.string(), agentConfigSchema).optional(),
  sync: syncConfigSchema,
  mcp: z
    .object({
      enabled: z.boolean().optional(),
      merge_strategy: z.enum(['merge', 'overwrite']).optional(),
    })
    .optional(),
  gitignore: z
    .object({
      enabled: z.boolean().optional(),
    })
    .optional(),
  backup: z
    .object({
      enabled: z.boolean().optional(),
    })
    .optional(),
  skills: z
    .object({
      enabled: z.boolean().optional(),
    })
    .optional(),
  rules: z
    .object({
      include: z.array(z.string()).optional(),
      exclude: z.array(z.string()).optional(),
      merge_strategy: z.enum(['all', 'cursor']).optional(),
    })
    .optional(),
  nested: z.boolean().optional(),
});

/**
 * Recursively creates a new object with only enumerable string keys,
 * effectively excluding Symbol properties.
 * The @iarna/toml parser adds Symbol properties (Symbol(type), Symbol(declared))
 * for metadata, which Zod v4+ validates and rejects as invalid record keys.
 * By rebuilding the object structure using Object.keys(), we create clean objects
 * that only contain the actual data without Symbol metadata.
 */
export function stripSymbols(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(stripSymbols);
  }
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    result[key] = stripSymbols((obj as Record<string, unknown>)[key]);
  }
  return result;
}

export function isPlainRecord(
  value: unknown,
): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function deepMergeConfig(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;

    if (Array.isArray(value) || !isPlainRecord(value)) {
      result[key] = value;
      continue;
    }

    const baseValue = result[key];
    if (isPlainRecord(baseValue)) {
      result[key] = deepMergeConfig(baseValue, value);
      continue;
    }

    result[key] = deepMergeConfig({}, value);
  }

  return result;
}

export function withoutSync(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...raw };
  delete next.sync;
  return next;
}

async function resolveConfigFile(
  projectRoot: string,
  configPath?: string,
): Promise<string> {
  if (configPath) {
    return path.resolve(configPath);
  }

  const localConfigFile = path.join(
    projectRoot,
    CANONICAL_SKILLER_DIR,
    SKILLER_CONFIG_FILE,
  );
  try {
    await fs.access(localConfigFile);
    return localConfigFile;
  } catch {
    const xdgConfigDir =
      process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    return path.join(xdgConfigDir, 'skiller', 'skiller.toml');
  }
}

async function readRawConfigFile(
  filePath: string,
  warningLabel?: string,
): Promise<Record<string, unknown>> {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    const parsed = text.trim() ? parseTOML(text) : {};
    return stripSymbols(parsed) as Record<string, unknown>;
  } catch (err) {
    if (err instanceof Error && (err as ErrnoException).code !== 'ENOENT') {
      const prefix = warningLabel
        ? `${warningLabel} at ${filePath}`
        : `config file at ${filePath}`;
      console.warn(
        `[skiller] Warning: could not read ${prefix}: ${err.message}`,
      );
    }
    return {};
  }
}

function validateRawConfig(
  raw: Record<string, unknown>,
  configFile: string,
): void {
  const validationResult = skillerConfigSchema.safeParse(raw);
  if (!validationResult.success) {
    throw createSkillerError(
      'Invalid configuration file format',
      `File: ${configFile}, Errors: ${validationResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')}`,
    );
  }
}

function parseSyncConfig(
  raw: Record<string, unknown>,
  projectRoot: string,
): SyncConfig | undefined {
  const syncSection = raw.sync;
  if (!isPlainRecord(syncSection) || typeof syncSection.source !== 'string') {
    return undefined;
  }

  const mode =
    syncSection.mode === 'preset' ||
    syncSection.mode === 'repo' ||
    syncSection.mode === 'auto'
      ? (syncSection.mode as SyncMode)
      : 'auto';

  return {
    source: path.resolve(projectRoot, syncSection.source),
    mode,
    clean: typeof syncSection.clean === 'boolean' ? syncSection.clean : true,
    include: Array.isArray(syncSection.include)
      ? syncSection.include.map((entry) => String(entry))
      : undefined,
    exclude: Array.isArray(syncSection.exclude)
      ? syncSection.exclude.map((entry) => String(entry))
      : undefined,
  };
}

export interface RawConfigLoadResult {
  raw: Record<string, unknown>;
  localRaw: Record<string, unknown>;
  baseRaw: Record<string, unknown>;
  configFile: string;
  baseConfigFile?: string;
  sync?: SyncConfig;
}

export async function loadRawConfig(
  options: ConfigOptions,
): Promise<RawConfigLoadResult> {
  const configFile = await resolveConfigFile(
    options.projectRoot,
    options.configPath,
  );
  const localRaw = await readRawConfigFile(configFile);
  validateRawConfig(localRaw, configFile);

  const sync = parseSyncConfig(localRaw, options.projectRoot);
  let baseRaw: Record<string, unknown> = {};
  let baseConfigFile: string | undefined;

  if (sync) {
    baseConfigFile = path.join(
      sync.source,
      CANONICAL_SKILLER_DIR,
      SKILLER_CONFIG_FILE,
    );
    baseRaw = withoutSync(
      await readRawConfigFile(baseConfigFile, 'base sync config'),
    );
    validateRawConfig(baseRaw, baseConfigFile);
  }

  const raw = deepMergeConfig(baseRaw, localRaw);
  validateRawConfig(raw, configFile);

  return {
    raw,
    localRaw,
    baseRaw,
    configFile,
    baseConfigFile,
    sync,
  };
}

/**
 * Configuration for a specific agent as defined in skiller.toml.
 */
export interface IAgentConfig {
  enabled?: boolean;
  outputPath?: string;
  outputPathInstructions?: string;
  outputPathConfig?: string;
  /** MCP propagation config for this agent. */
  mcp?: McpConfig;
  /** Control whether to add agent output files to .gitignore. Defaults to true. */
  gitignore?: boolean;
}

/**
 * Parsed skiller configuration values.
 */
export interface LoadedConfig {
  /** Agents to run by default, as specified by default_agents. */
  defaultAgents?: string[];
  /** Root folder name (e.g., ".agents"). */
  rootFolder?: string;
  /** Per-agent configuration overrides. */
  agentConfigs: Record<string, IAgentConfig>;
  /** Command-line agent filters (--agents), if provided. */
  cliAgents?: string[];
  /** Global MCP servers configuration section. */
  mcp?: GlobalMcpConfig;
  /** Gitignore configuration section. */
  gitignore?: GitignoreConfig;
  /** Backup configuration section. */
  backup?: BackupConfig;
  /** Skills configuration section. */
  skills?: SkillsConfig;
  /** Rules configuration section for filtering markdown files. */
  rules?: RulesConfig;
  /** Optional preset/repo sync configuration. */
  sync?: SyncConfig;
  /** Whether to enable nested rule loading from nested .agents directories. */
  nested?: boolean;
  /** Whether the nested option was explicitly provided in the config. */
  nestedDefined?: boolean;
}

/**
 * Options for loading the skiller configuration.
 */
export interface ConfigOptions {
  projectRoot: string;
  /** Path to a custom TOML config file. */
  configPath?: string;
  /** CLI filters from --agents option. */
  cliAgents?: string[];
}

/**
 * Loads and parses the skiller TOML configuration file, applying defaults.
 * If the file is missing or invalid, returns empty/default config.
 */
export async function loadConfig(
  options: ConfigOptions,
): Promise<LoadedConfig> {
  const { projectRoot, cliAgents } = options;
  const { raw, sync } = await loadRawConfig(options);

  const defaultAgents = Array.isArray(raw.default_agents)
    ? raw.default_agents.map((a) => String(a))
    : undefined;
  const rootFolder =
    typeof raw.root_folder === 'string' ? raw.root_folder : undefined;

  const agentsSection =
    raw.agents && typeof raw.agents === 'object' && !Array.isArray(raw.agents)
      ? (raw.agents as Record<string, unknown>)
      : {};
  const agentConfigs: Record<string, IAgentConfig> = {};
  for (const [name, section] of Object.entries(agentsSection)) {
    if (section && typeof section === 'object') {
      const sectionObj = section as Record<string, unknown>;
      const cfg: IAgentConfig = {};
      if (typeof sectionObj.enabled === 'boolean') {
        cfg.enabled = sectionObj.enabled;
      }
      if (typeof sectionObj.output_path === 'string') {
        cfg.outputPath = path.resolve(projectRoot, sectionObj.output_path);
      }
      if (typeof sectionObj.output_path_instructions === 'string') {
        cfg.outputPathInstructions = path.resolve(
          projectRoot,
          sectionObj.output_path_instructions,
        );
      }
      if (typeof sectionObj.output_path_config === 'string') {
        cfg.outputPathConfig = path.resolve(
          projectRoot,
          sectionObj.output_path_config,
        );
      }
      if (sectionObj.mcp && typeof sectionObj.mcp === 'object') {
        const m = sectionObj.mcp as Record<string, unknown>;
        const mcpCfg: McpConfig = {};
        if (typeof m.enabled === 'boolean') {
          mcpCfg.enabled = m.enabled;
        }
        if (typeof m.merge_strategy === 'string') {
          const ms = m.merge_strategy;
          if (ms === 'merge' || ms === 'overwrite') {
            mcpCfg.strategy = ms;
          }
        }
        cfg.mcp = mcpCfg;
      }
      if (typeof sectionObj.gitignore === 'boolean') {
        cfg.gitignore = sectionObj.gitignore;
      }
      agentConfigs[name] = cfg;
    }
  }

  const rawMcpSection =
    raw.mcp && typeof raw.mcp === 'object' && !Array.isArray(raw.mcp)
      ? (raw.mcp as Record<string, unknown>)
      : {};
  const globalMcpConfig: GlobalMcpConfig = {};
  if (typeof rawMcpSection.enabled === 'boolean') {
    globalMcpConfig.enabled = rawMcpSection.enabled;
  }
  if (typeof rawMcpSection.merge_strategy === 'string') {
    const strat = rawMcpSection.merge_strategy;
    if (strat === 'merge' || strat === 'overwrite') {
      globalMcpConfig.strategy = strat;
    }
  }

  const rawGitignoreSection =
    raw.gitignore &&
    typeof raw.gitignore === 'object' &&
    !Array.isArray(raw.gitignore)
      ? (raw.gitignore as Record<string, unknown>)
      : {};
  const gitignoreConfig: GitignoreConfig = {};
  if (typeof rawGitignoreSection.enabled === 'boolean') {
    gitignoreConfig.enabled = rawGitignoreSection.enabled;
  }

  const rawBackupSection =
    raw.backup && typeof raw.backup === 'object' && !Array.isArray(raw.backup)
      ? (raw.backup as Record<string, unknown>)
      : {};
  const backupConfig: BackupConfig = {};
  if (typeof rawBackupSection.enabled === 'boolean') {
    backupConfig.enabled = rawBackupSection.enabled;
  }

  const rawSkillsSection =
    raw.skills && typeof raw.skills === 'object' && !Array.isArray(raw.skills)
      ? (raw.skills as Record<string, unknown>)
      : {};
  const skillsConfig: SkillsConfig = {};
  if (typeof rawSkillsSection.enabled === 'boolean') {
    skillsConfig.enabled = rawSkillsSection.enabled;
  }

  // Deprecation warnings for removed config options
  if ('generate_from_rules' in rawSkillsSection) {
    console.warn(
      `[skiller] Warning: skills.generate_from_rules is deprecated and has no effect. Local rule sources in .agents/rules/ compile automatically into .agents/skills/.`,
    );
  }
  if ('prune' in rawSkillsSection) {
    console.warn(
      `[skiller] Warning: skills.prune is deprecated and has no effect. Skills in .agents/skills/ are never auto-deleted.`,
    );
  }

  const rawRulesSection =
    raw.rules && typeof raw.rules === 'object' && !Array.isArray(raw.rules)
      ? (raw.rules as Record<string, unknown>)
      : {};
  const rulesConfig: RulesConfig = {};
  if (Array.isArray(rawRulesSection.include)) {
    rulesConfig.include = rawRulesSection.include.map((p) => String(p));
  }
  if (Array.isArray(rawRulesSection.exclude)) {
    rulesConfig.exclude = rawRulesSection.exclude.map((p) => String(p));
  }
  if (
    rawRulesSection.merge_strategy === 'all' ||
    rawRulesSection.merge_strategy === 'cursor'
  ) {
    rulesConfig.merge_strategy = rawRulesSection.merge_strategy;
  }

  const nestedDefined = typeof raw.nested === 'boolean';
  const nested = nestedDefined ? (raw.nested as boolean) : false;

  return {
    defaultAgents,
    rootFolder,
    agentConfigs,
    cliAgents,
    mcp: globalMcpConfig,
    gitignore: gitignoreConfig,
    backup: backupConfig,
    skills: skillsConfig,
    rules: rulesConfig,
    sync,
    nested,
    nestedDefined,
  };
}
