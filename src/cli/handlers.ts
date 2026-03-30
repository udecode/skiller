import { applyAllAgentConfigs } from '../lib';
import { revertAllAgentConfigs } from '../revert';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { ERROR_PREFIX, DEFAULT_RULES_FILENAME } from '../constants';
import { McpStrategy } from '../types';
import { loadConfig } from '../core/ConfigLoader';
import {
  listClaudePluginAuxiliaryRuleNames,
  planClaudePluginSkillsMigration,
} from '../core/ClaudePluginMigration';
import {
  buildRulesReplacementInstallArgs,
  planRulesToSkillsMigration,
  removeLocalRuleReplacementState,
  type RuleReplacementCandidate,
  type SkillsRegistryMatch,
} from '../core/RulesToSkillsMigration';
import { getAgentIdentifiersForCliHelp } from '../agents';
import { allAgents } from '../agents';
import { runSkillsCli } from './skills-cli';
import {
  CANONICAL_SKILLER_DIR,
  SKILLER_CONFIG_FILE,
} from '../core/project-paths';
import {
  getCanonicalSkillsDir,
  resolveSkillOwnership,
} from '../core/SkillOwnership';
import {
  buildAdjustedSkillsAddArgs,
  extractAddSource,
  getOutdatedAgentSkills,
  hasGlobalFlag,
  hasListFlag,
  inspectCompatibleSource,
  installAgentSkillsFromInspection,
  pruneMissingAgentSkillsFromLock,
  pruneMissingNativeSkillsFromLock,
  removeAgentManagedSkills,
  restoreAgentSkillsFromLock,
  updateAgentSkillsFromLock,
} from '../core/AgentSourceCompatibility';
import * as readline from 'readline/promises';

export interface ApplyArgs {
  'project-root': string;
  agents?: string;
  config?: string;
  mcp?: boolean;
  'mcp-overwrite'?: boolean;
  gitignore?: boolean;
  verbose?: boolean;
  'dry-run'?: boolean;
  'local-only'?: boolean;
  nested?: boolean;
  backup?: boolean;
  skills?: boolean;
}

export interface InitArgs {
  'project-root': string;
  global: boolean;
}

export interface RevertArgs {
  'project-root': string;
  agents?: string;
  config?: string;
  'keep-backups': boolean;
  verbose: boolean;
  'dry-run': boolean;
  'local-only': boolean;
}

export interface SkillsWrapperArgs {
  'project-root': string;
  args?: string[];
  verbose?: boolean;
}

export interface InstallArgs extends SkillsWrapperArgs {
  verbose?: boolean;
}

export interface UpdateArgs extends SkillsWrapperArgs {
  verbose?: boolean;
}

export interface SkillsPassthroughArgs extends SkillsWrapperArgs {
  subcommand: string;
}

export interface MigrateClaudePluginsArgs {
  'project-root': string;
  execute: boolean;
}

export interface MigrateRulesToSkillsArgs {
  'project-root': string;
  execute: boolean;
  rules?: string[];
  yes: boolean;
}

async function executeSkillsWrapper(
  projectRoot: string,
  args: string[],
): Promise<void> {
  try {
    await runSkillsCli(projectRoot, args);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${ERROR_PREFIX} ${message}`);
    process.exit(1);
  }
}

async function applyAfterSkillsLifecycleStep(
  projectRoot: string,
  verbose: boolean,
): Promise<void> {
  await applyHandler({
    'project-root': projectRoot,
    verbose,
  });
}

async function pruneSkillOutputs(
  projectRoot: string,
  skillNames: string[],
): Promise<void> {
  const normalizedNames = [...new Set(skillNames.filter(Boolean))];
  if (normalizedNames.length === 0) return;

  const skillDirs = new Set<string>([getCanonicalSkillsDir(projectRoot)]);

  for (const agent of allAgents) {
    if (!agent.supportsNativeSkills?.() || !agent.getSkillsPath) continue;
    const skillsPath = agent.getSkillsPath(projectRoot);
    if (skillsPath) {
      skillDirs.add(skillsPath);
    }
  }

  for (const skillName of normalizedNames) {
    for (const skillsDir of skillDirs) {
      await fs.rm(path.join(skillsDir, skillName), {
        force: true,
        recursive: true,
      });
    }
  }
}

async function pruneStaleLockBackedSkills(projectRoot: string): Promise<void> {
  const [nativePrune, agentPrune] = await Promise.all([
    pruneMissingNativeSkillsFromLock(projectRoot),
    pruneMissingAgentSkillsFromLock(projectRoot),
  ]);

  if (nativePrune.prunedOutputNames.length > 0) {
    await pruneSkillOutputs(projectRoot, nativePrune.prunedOutputNames);
    console.log(
      `[skiller] Pruned ${nativePrune.prunedKeys.length} stale upstream skill(s): ${nativePrune.prunedKeys.join(', ')}`,
    );
  }

  if (agentPrune.prunedOutputNames.length > 0) {
    await pruneSkillOutputs(projectRoot, agentPrune.prunedOutputNames);
    console.log(
      `[skiller] Pruned ${agentPrune.prunedKeys.length} stale agent-derived skill(s): ${agentPrune.prunedKeys.join(', ')}`,
    );
  }

  const warnings = [...nativePrune.warnings, ...agentPrune.warnings];
  if (warnings.length > 0) {
    console.log(warnings.map((warning) => `[skiller] ${warning}`).join('\n'));
  }
}

function normalizeRequestedSkillNames(args: string[] | undefined): string[] {
  if (!args || args.length === 0) return [];

  const names = new Set<string>();

  for (const arg of args) {
    if (!arg || arg.startsWith('-') || arg.includes('/')) continue;

    const normalized = path.basename(arg, '.mdc').trim().replace(/:/g, '-');

    if (normalized.length > 0) {
      names.add(normalized);
    }
  }

  return [...names].sort((a, b) => a.localeCompare(b));
}

async function scrubRequestedSkillsLockEntries(
  projectRoot: string,
  args: string[] | undefined,
): Promise<string[]> {
  const requestedNames = new Set(normalizeRequestedSkillNames(args));
  if (requestedNames.size === 0) return [];

  const skillsLockPath = path.join(projectRoot, 'skills-lock.json');
  const raw = await readJsonObject(skillsLockPath);
  if (!raw) return [];

  const skills = raw.skills;
  if (!skills || typeof skills !== 'object') return [];

  const nextSkills: Record<string, unknown> = {};
  const removedKeys: string[] = [];

  for (const [key, value] of Object.entries(
    skills as Record<string, unknown>,
  )) {
    if (requestedNames.has(key.replace(/:/g, '-'))) {
      removedKeys.push(key);
      continue;
    }
    nextSkills[key] = value;
  }

  if (removedKeys.length === 0) return [];

  raw.skills = nextSkills;
  await fs.writeFile(skillsLockPath, JSON.stringify(raw, null, 2) + '\n');

  return removedKeys.sort((a, b) => a.localeCompare(b));
}

async function pruneRequestedUnmanagedSkillOutputs(
  projectRoot: string,
  args: string[] | undefined,
): Promise<string[]> {
  const requestedNames = normalizeRequestedSkillNames(args);
  if (requestedNames.length === 0) return [];

  const ownership = await resolveSkillOwnership(projectRoot);
  const removableNames = requestedNames.filter(
    (name) =>
      !ownership.upstreamOwned.has(name) && !ownership.localOwned.has(name),
  );

  if (removableNames.length === 0) return [];

  const skillDirs = new Set<string>([getCanonicalSkillsDir(projectRoot)]);

  for (const agent of allAgents) {
    if (!agent.supportsNativeSkills?.() || !agent.getSkillsPath) continue;
    const skillsPath = agent.getSkillsPath(projectRoot);
    if (skillsPath) {
      skillDirs.add(skillsPath);
    }
  }

  for (const skillName of removableNames) {
    for (const skillsDir of skillDirs) {
      await fs.rm(path.join(skillsDir, skillName), {
        force: true,
        recursive: true,
      });
    }
  }

  return removableNames;
}

function buildClaudePluginMigrationArgs(source: string): string[] {
  return ['add', source, '--agent', 'universal', '--skill', '*', '-y'];
}

const LEGACY_EXTERNAL_RULE_REPLACEMENT_SOURCES = new Set([
  'ratacat/claude-skills',
]);

function resolveRegistryMatchSource(match: SkillsRegistryMatch): string {
  if (match.source) return match.source;

  const parts = match.slug.split('/').filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]}/${parts[1]}`;
  }

  return match.slug;
}

function formatInstalls(count: number): string {
  if (!count || count <= 0) return '0 installs';
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M installs`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1).replace(/\.0$/, '')}K installs`;
  }
  return `${count} install${count === 1 ? '' : 's'}`;
}

function formatMatch(match: SkillsRegistryMatch): string {
  const source = match.source || match.slug;
  return `${source}@${match.name} (${formatInstalls(match.installs)})`;
}

async function readJsonObject(
  filePath: string,
): Promise<Record<string, unknown> | null> {
  try {
    const raw = JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown;
    return raw && typeof raw === 'object'
      ? (raw as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function cleanupLegacyClaudePluginState(
  projectRoot: string,
  pluginIds: string[],
): Promise<void> {
  const pluginIdSet = new Set(pluginIds);
  if (pluginIdSet.size === 0) return;

  const settingsPath = path.join(projectRoot, '.claude', 'settings.json');
  const settings = await readJsonObject(settingsPath);
  if (settings) {
    const enabledPlugins = settings.enabledPlugins;
    if (enabledPlugins && typeof enabledPlugins === 'object') {
      const nextEnabledPlugins = Object.fromEntries(
        Object.entries(enabledPlugins as Record<string, unknown>).filter(
          ([pluginId]) => !pluginIdSet.has(pluginId),
        ),
      );

      if (
        Object.keys(nextEnabledPlugins).length !==
        Object.keys(enabledPlugins as Record<string, unknown>).length
      ) {
        if (Object.keys(nextEnabledPlugins).length === 0) {
          delete settings.enabledPlugins;
        } else {
          settings.enabledPlugins = nextEnabledPlugins;
        }

        await fs.writeFile(
          settingsPath,
          JSON.stringify(settings, null, 2) + '\n',
        );
      }
    }
  }

  for (const manifestPath of [
    path.join(projectRoot, '.agents', '.skiller.json'),
    path.join(projectRoot, '.claude', '.skiller.json'),
  ]) {
    const manifest = await readJsonObject(manifestPath);
    if (!manifest) continue;

    const targets = manifest.targets;
    if (!targets || typeof targets !== 'object') continue;

    let changed = false;
    const nextTargets: Record<string, unknown> = {};

    for (const [targetKey, rawEntries] of Object.entries(
      targets as Record<string, unknown>,
    )) {
      if (!Array.isArray(rawEntries)) {
        nextTargets[targetKey] = rawEntries;
        continue;
      }

      const filteredEntries = rawEntries.filter((entry) => {
        if (!entry || typeof entry !== 'object') return true;

        const sourceType = (entry as Record<string, unknown>).sourceType;
        const pluginId = (entry as Record<string, unknown>).pluginId;
        if (sourceType !== 'plugin' || typeof pluginId !== 'string') {
          return true;
        }

        return !pluginIdSet.has(pluginId);
      });

      if (filteredEntries.length !== rawEntries.length) {
        changed = true;
      }

      if (filteredEntries.length > 0) {
        nextTargets[targetKey] = filteredEntries;
      } else {
        changed = true;
      }
    }

    if (!changed) continue;

    manifest.targets = nextTargets;
    delete manifest.localSkills;
    if (Object.keys(nextTargets).length === 0) {
      await fs.rm(manifestPath, { force: true });
      continue;
    }

    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  }
}

async function cleanupMigratedPluginAuxiliaryRules(
  projectRoot: string,
  sources: string[],
): Promise<string[]> {
  const candidateRuleNames = await listClaudePluginAuxiliaryRuleNames(sources);
  if (candidateRuleNames.length === 0) return [];

  const sourceSet = new Set(sources);
  const plan = await planRulesToSkillsMigration(
    projectRoot,
    candidateRuleNames,
  );
  const removable = new Set<string>(plan.unmatched);

  for (const candidate of plan.candidates) {
    const exactMatchSources = candidate.matches.map(resolveRegistryMatchSource);
    if (
      exactMatchSources.length === 0 ||
      exactMatchSources.every((source) => sourceSet.has(source))
    ) {
      removable.add(candidate.ruleName);
    }
  }

  const removed = [...removable].sort((a, b) => a.localeCompare(b));
  for (const ruleName of removed) {
    await removeLocalRuleReplacementState(projectRoot, ruleName, false);
    await fs.rm(path.join(projectRoot, '.agents', 'skills', ruleName), {
      force: true,
      recursive: true,
    });
    await fs.rm(path.join(projectRoot, '.claude', 'skills', ruleName), {
      force: true,
      recursive: true,
    });
  }

  return removed;
}

async function cleanupLegacyExternalRuleMatches(
  projectRoot: string,
): Promise<string[]> {
  const plan = await planRulesToSkillsMigration(projectRoot);
  const removals = new Map<string, { alreadyInstalled: boolean }>();

  for (const candidate of plan.candidates) {
    if (
      !candidate.matches.some((match) =>
        LEGACY_EXTERNAL_RULE_REPLACEMENT_SOURCES.has(
          resolveRegistryMatchSource(match),
        ),
      )
    ) {
      continue;
    }

    removals.set(candidate.ruleName, {
      alreadyInstalled: candidate.alreadyInstalled,
    });
  }

  const removed = [...removals.keys()].sort((a, b) => a.localeCompare(b));
  for (const ruleName of removed) {
    const removal = removals.get(ruleName);
    await removeLocalRuleReplacementState(projectRoot, ruleName, false);

    if (!removal?.alreadyInstalled) {
      await fs.rm(path.join(projectRoot, '.agents', 'skills', ruleName), {
        force: true,
        recursive: true,
      });
    }

    await fs.rm(path.join(projectRoot, '.claude', 'skills', ruleName), {
      force: true,
      recursive: true,
    });
  }

  return removed;
}

async function promptLine(message: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    return (await rl.question(message)).trim();
  } finally {
    rl.close();
  }
}

async function promptForReplacement(
  candidate: RuleReplacementCandidate,
): Promise<SkillsRegistryMatch | 'cleanup' | null> {
  if (candidate.alreadyInstalled) {
    const answer = await promptLine(
      `[skiller] '${candidate.ruleName}' is already installed upstream. Remove the local rule copy? [y/N] `,
    );
    return /^y(es)?$/i.test(answer) ? 'cleanup' : null;
  }

  if (candidate.matches.length === 1) {
    const match = candidate.matches[0];
    const answer = await promptLine(
      `[skiller] Replace '${candidate.ruleName}' with ${formatMatch(match)}? [y/N] `,
    );
    return /^y(es)?$/i.test(answer) ? match : null;
  }

  console.log(`[skiller] Multiple exact matches for '${candidate.ruleName}':`);
  for (const [index, match] of candidate.matches.entries()) {
    console.log(`  ${index + 1}. ${formatMatch(match)}`);
  }
  const answer = await promptLine(
    `[skiller] Choose 1-${candidate.matches.length} or press Enter to skip: `,
  );
  if (answer.length === 0) return null;

  const selectedIndex = Number.parseInt(answer, 10);
  if (
    Number.isNaN(selectedIndex) ||
    selectedIndex < 1 ||
    selectedIndex > candidate.matches.length
  ) {
    console.log(`[skiller] Skipping '${candidate.ruleName}' (invalid choice).`);
    return null;
  }

  return candidate.matches[selectedIndex - 1];
}

function printRulesToSkillsPlan(
  plan: Awaited<ReturnType<typeof planRulesToSkillsMigration>>,
): void {
  console.log(
    `[skiller] Scanned ${plan.scannedRules.length} local rule(s) from .agents/rules.`,
  );

  if (plan.candidates.length > 0) {
    console.log('[skiller] Exact skills.sh matches:');
    for (const candidate of plan.candidates) {
      if (candidate.alreadyInstalled) {
        console.log(
          `- ${candidate.ruleName}: already installed upstream; local rule can be removed`,
        );
        continue;
      }

      if (candidate.matches.length === 1) {
        console.log(
          `- ${candidate.ruleName}: ${formatMatch(candidate.matches[0])}`,
        );
        continue;
      }

      console.log(
        `- ${candidate.ruleName}: ${candidate.matches.length} exact matches`,
      );
      for (const match of candidate.matches) {
        console.log(`  - ${formatMatch(match)}`);
      }
    }
  } else {
    console.log('[skiller] No exact skills.sh matches found.');
  }

  if (plan.unmatched.length > 0) {
    console.log(`[skiller] No exact match for: ${plan.unmatched.join(', ')}`);
  }

  if (plan.missingRequested.length > 0) {
    console.log(
      `[skiller] Requested rules not found: ${plan.missingRequested.join(', ')}`,
    );
  }
}

/**
 * Handler for the 'apply' command.
 */
export async function applyHandler(argv: ApplyArgs): Promise<void> {
  const projectRoot = argv['project-root'];
  const agents = argv.agents
    ? argv.agents.split(',').map((a) => a.trim())
    : undefined;
  const configPath = argv.config;
  const mcpEnabled = argv.mcp;
  const mcpStrategy: McpStrategy | undefined = argv['mcp-overwrite']
    ? 'overwrite'
    : undefined;
  const verbose = argv.verbose;
  const dryRun = argv['dry-run'];
  const localOnly = argv['local-only'];

  // Determine backup preference: CLI > TOML > Default (enabled)
  // yargs handles --no-backup by setting backup to false
  let backupPreference: boolean | undefined;
  if (argv.backup !== undefined) {
    backupPreference = argv.backup;
  } else {
    backupPreference = undefined; // Let TOML/default decide
  }

  // Determine gitignore preference: CLI > TOML > Default (enabled)
  // yargs handles --no-gitignore by setting gitignore to false
  let gitignorePreference: boolean | undefined;
  if (argv.gitignore !== undefined) {
    gitignorePreference = argv.gitignore;
  } else {
    gitignorePreference = undefined; // Let TOML/default decide
  }

  // Determine nested preference: CLI > TOML > Default (false)
  let nested: boolean;

  if (argv.nested !== undefined) {
    // CLI explicitly set nested (either --nested or --no-nested)
    nested = argv.nested;
  } else {
    // CLI didn't set nested, check TOML configuration
    try {
      const config = await loadConfig({
        projectRoot,
        configPath,
      });
      // Use TOML setting if available, otherwise default to false
      nested = config.nested ?? false;
    } catch {
      // If config loading fails, use default (false)
      nested = false;
    }
  }

  // Determine skills preference: CLI > TOML > Default (enabled)
  let skillsEnabled: boolean | undefined;
  if (argv.skills !== undefined) {
    skillsEnabled = argv.skills;
  } else {
    skillsEnabled = undefined; // Let config/default decide
  }

  try {
    await applyAllAgentConfigs(
      projectRoot,
      agents,
      configPath,
      mcpEnabled,
      mcpStrategy,
      gitignorePreference,
      verbose,
      dryRun,
      localOnly,
      nested,
      backupPreference,
      skillsEnabled,
    );
    console.log('[skiller] Apply completed successfully.');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${ERROR_PREFIX} ${message}`);
    process.exit(1);
  }
}

/**
 * Handler for the 'init' command.
 */
export async function initHandler(argv: InitArgs): Promise<void> {
  const projectRoot = argv['project-root'];
  const isGlobal = argv['global'];

  const skillerDir = isGlobal
    ? path.join(
        process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
        'skiller',
      )
    : path.join(projectRoot, CANONICAL_SKILLER_DIR);
  await fs.mkdir(skillerDir, { recursive: true });
  const instructionsPath = path.join(skillerDir, DEFAULT_RULES_FILENAME);
  const tomlPath = path.join(skillerDir, SKILLER_CONFIG_FILE);
  const exists = async (p: string) => {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  };
  const DEFAULT_INSTRUCTIONS = `# AGENTS.md\n\nCentralised AI agent instructions. Add coding guidelines, style guides, and project context here.\n\nSkiller concatenates all .md files in this directory (and subdirectories), starting with AGENTS.md (if present), then remaining files in sorted order.\n`;
  const DEFAULT_TOML = `# Skiller Configuration File
# See https://github.com/udecode/skiller for documentation.

# To specify which agents are active by default when --agents is not used,
# uncomment and populate the following line. If omitted, all agents are active.
# default_agents = ["github-copilot", "claude-code"]

# Enable nested rule loading from nested .agents directories
# When enabled, skiller will search for and process .agents directories throughout the project hierarchy
# nested = false

# --- Agent Specific Configurations ---
# You can enable/disable agents and override their default output paths here.
# Use canonical agent identifiers only: ${getAgentIdentifiersForCliHelp()}

# [agents.github-copilot]
# enabled = true
# output_path = ".github/copilot-instructions.md"

# [agents.claude-code]
# enabled = true
# output_path = "CLAUDE.md"

# [agents.gemini-cli]
# enabled = true

# --- MCP Servers ---
# Define Model Context Protocol servers here. Two examples:
# 1. A stdio server (local executable)
# 2. A remote server (HTTP-based)

# [mcp_servers.example_stdio]
# command = "node"
# args = ["scripts/your-mcp-server.js"]
# env = { API_KEY = "replace_me" }

# [mcp_servers.example_remote]
# url = "https://api.example.com/mcp"
# headers = { Authorization = "Bearer REPLACE_ME" }
`;
  if (!(await exists(instructionsPath))) {
    // Create new AGENTS.md regardless of legacy presence.
    await fs.writeFile(instructionsPath, DEFAULT_INSTRUCTIONS);
    console.log(`[skiller] Created ${instructionsPath}`);
  } else {
    console.log(`[skiller] ${DEFAULT_RULES_FILENAME} already exists, skipping`);
  }
  if (!(await exists(tomlPath))) {
    await fs.writeFile(tomlPath, DEFAULT_TOML);
    console.log(`[skiller] Created ${tomlPath}`);
  } else {
    console.log(`[skiller] skiller.toml already exists, skipping`);
  }
}

export async function migrateClaudePluginsHandler(
  argv: MigrateClaudePluginsArgs,
): Promise<void> {
  const projectRoot = argv['project-root'];

  try {
    const plan = await planClaudePluginSkillsMigration(projectRoot);

    if (plan.installs.length === 0 && plan.unresolved.length === 0) {
      console.log('[skiller] No Claude plugin repos found to migrate.');
      return;
    }

    console.log('[skiller] Claude plugin migration plan:');
    for (const install of plan.installs) {
      console.log(
        `- ${install.source} <- ${install.pluginIds.join(', ')} (${install.strategy})`,
      );
    }
    for (const unresolved of plan.unresolved) {
      console.log(`- unresolved ${unresolved.pluginId}: ${unresolved.reason}`);
    }

    if (!argv.execute) {
      console.log(
        '[skiller] Run again with --execute to install the resolved repos through skills.',
      );
      return;
    }

    if (plan.installs.length === 0 && plan.unresolved.length > 0) {
      throw new Error(
        `Cannot execute migration because no installable plugin repos were found:\n${plan.unresolved.map((entry) => `- ${entry.pluginId}: ${entry.reason}`).join('\n')}`,
      );
    }

    for (const install of plan.installs) {
      await runSkillsCli(
        projectRoot,
        buildClaudePluginMigrationArgs(install.source),
      );
    }

    await cleanupLegacyClaudePluginState(projectRoot, [
      ...plan.installs.flatMap((install) => install.pluginIds),
      ...plan.unresolved.map((entry) => entry.pluginId),
    ]);

    const removedAuxiliaryRules = await cleanupMigratedPluginAuxiliaryRules(
      projectRoot,
      plan.installs.map((install) => install.source),
    );
    if (removedAuxiliaryRules.length > 0) {
      console.log(
        `[skiller] Removed stale plugin-derived local rules:\n${removedAuxiliaryRules.map((name) => `- ${name}`).join('\n')}`,
      );
    }

    const removedLegacyExternalRules =
      await cleanupLegacyExternalRuleMatches(projectRoot);
    if (removedLegacyExternalRules.length > 0) {
      console.log(
        `[skiller] Removed legacy external rule matches:\n${removedLegacyExternalRules.map((name) => `- ${name}`).join('\n')}`,
      );
    }

    if (plan.unresolved.length > 0) {
      console.log(
        `[skiller] Skipped unresolved plugins:\n${plan.unresolved.map((entry) => `- ${entry.pluginId}: ${entry.reason}`).join('\n')}`,
      );
    }

    console.log(
      '[skiller] Claude plugin repo migration completed. Legacy Claude plugin entries were removed from settings/manifests; rerun skiller apply.',
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${ERROR_PREFIX} ${message}`);
    process.exit(1);
  }
}

export async function migrateRulesToSkillsHandler(
  argv: MigrateRulesToSkillsArgs,
): Promise<void> {
  const projectRoot = argv['project-root'];

  try {
    const plan = await planRulesToSkillsMigration(projectRoot, argv.rules);
    printRulesToSkillsPlan(plan);

    if (!argv.execute) {
      console.log(
        '[skiller] Run again with --execute to replace interactively, or --execute --yes to auto-replace unambiguous matches.',
      );
      return;
    }

    if (!argv.yes && !process.stdin.isTTY) {
      throw new Error(
        'Interactive replacement requires a TTY. Re-run with --yes to auto-replace only unambiguous matches.',
      );
    }

    let replacedCount = 0;

    for (const candidate of plan.candidates) {
      let selection: SkillsRegistryMatch | 'cleanup' | null = null;

      if (argv.yes) {
        if (candidate.alreadyInstalled) {
          selection = 'cleanup';
        } else if (candidate.matches.length === 1) {
          selection = candidate.matches[0];
        } else {
          console.log(
            `[skiller] Skipping '${candidate.ruleName}' because it has multiple exact matches.`,
          );
          continue;
        }
      } else {
        selection = await promptForReplacement(candidate);
      }

      if (!selection) continue;

      if (selection !== 'cleanup') {
        await runSkillsCli(
          projectRoot,
          buildRulesReplacementInstallArgs(selection),
        );
      }

      await removeLocalRuleReplacementState(
        projectRoot,
        candidate.ruleName,
        false,
      );
      replacedCount += 1;
      console.log(`[skiller] Replaced local rule '${candidate.ruleName}'.`);
    }

    if (replacedCount === 0) {
      console.log('[skiller] No local rules were replaced.');
      return;
    }

    console.log(
      '[skiller] Replacement pass completed. Run skiller apply to refresh derived agent outputs.',
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${ERROR_PREFIX} ${message}`);
    process.exit(1);
  }
}

export async function addHandler(argv: SkillsWrapperArgs): Promise<void> {
  const projectRoot = argv['project-root'];
  const args = argv.args ?? [];

  if (hasGlobalFlag(args)) {
    throw new Error(
      'Agent-compatible installs are project-scoped only. Drop --global and retry.',
    );
  }

  const source = extractAddSource(args);
  let inspection:
    | Awaited<ReturnType<typeof inspectCompatibleSource>>
    | undefined;
  let installedAgentSkills = false;

  try {
    if (source) {
      inspection = await inspectCompatibleSource(source, args);
    }

    if (inspection && hasListFlag(args)) {
      if (inspection.nativeSkillNames.length > 0) {
        await executeSkillsWrapper(projectRoot, [
          'add',
          ...buildAdjustedSkillsAddArgs(args, inspection.nativeSkillNames),
        ]);
      }

      if (inspection.agentSkills.length > 0) {
        console.log('[skiller] Compatible agent-derived skills:');
        for (const agentSkill of inspection.agentSkills) {
          console.log(`- ${agentSkill.installName}`);
        }
      }

      return;
    }

    if (inspection && inspection.nativeSkillNames.length > 0) {
      await executeSkillsWrapper(projectRoot, [
        'add',
        ...buildAdjustedSkillsAddArgs(args, inspection.nativeSkillNames),
      ]);
    } else if (!inspection || inspection.agentSkills.length === 0) {
      await executeSkillsWrapper(projectRoot, ['add', ...args]);
    }

    if (inspection && inspection.agentSkills.length > 0) {
      const installed = await installAgentSkillsFromInspection(
        projectRoot,
        inspection,
      );
      installedAgentSkills = true;
      console.log(
        `[skiller] Installed ${installed.length} agent-derived skill(s): ${installed.join(', ')}`,
      );
    }
  } finally {
    if (inspection && !installedAgentSkills) {
      await inspection.workspace.cleanup();
    }
  }

  await applyAfterSkillsLifecycleStep(projectRoot, argv.verbose ?? false);
}

export async function installHandler(argv: InstallArgs): Promise<void> {
  await pruneStaleLockBackedSkills(argv['project-root']);
  await executeSkillsWrapper(argv['project-root'], [
    'experimental_install',
    ...(argv.args ?? []),
  ]);
  const restored = await restoreAgentSkillsFromLock(argv['project-root']);
  if (restored.restored.length > 0) {
    console.log(
      `[skiller] Restored ${restored.restored.length} agent-derived skill(s): ${restored.restored.join(', ')}`,
    );
  }
  if (restored.warnings.length > 0) {
    console.log(
      restored.warnings.map((warning) => `[skiller] ${warning}`).join('\n'),
    );
  }
  await applyAfterSkillsLifecycleStep(
    argv['project-root'],
    argv.verbose ?? false,
  );
}

export async function removeHandler(argv: SkillsWrapperArgs): Promise<void> {
  const projectRoot = argv['project-root'];
  const args = argv.args ?? [];
  const requestedNames = normalizeRequestedSkillNames(args);
  const ownership = await resolveSkillOwnership(projectRoot);
  const shouldRunSkillsRemove =
    requestedNames.length === 0 ||
    args.some(
      (arg) =>
        arg === '--all' ||
        arg === '--agent' ||
        arg === '-a' ||
        arg === '--skill' ||
        arg === '-s',
    ) ||
    requestedNames.some((name) => ownership.upstreamOwned.has(name));

  if (shouldRunSkillsRemove) {
    await executeSkillsWrapper(projectRoot, ['remove', ...args]);
  }
  await scrubRequestedSkillsLockEntries(argv['project-root'], argv.args ?? []);
  await pruneRequestedUnmanagedSkillOutputs(projectRoot, args);
  await removeAgentManagedSkills(projectRoot, requestedNames);
  await applyAfterSkillsLifecycleStep(projectRoot, argv.verbose ?? false);
}

export async function listHandler(argv: SkillsWrapperArgs): Promise<void> {
  await executeSkillsWrapper(argv['project-root'], [
    'list',
    ...(argv.args ?? []),
  ]);
}

export async function findHandler(argv: SkillsWrapperArgs): Promise<void> {
  await executeSkillsWrapper(argv['project-root'], [
    'find',
    ...(argv.args ?? []),
  ]);
}

export async function checkHandler(argv: SkillsWrapperArgs): Promise<void> {
  await executeSkillsWrapper(argv['project-root'], [
    'check',
    ...(argv.args ?? []),
  ]);
}

export async function updateHandler(argv: UpdateArgs): Promise<void> {
  await pruneStaleLockBackedSkills(argv['project-root']);
  await executeSkillsWrapper(argv['project-root'], [
    'update',
    ...(argv.args ?? []),
  ]);
  const updated = await updateAgentSkillsFromLock(argv['project-root']);
  if (updated.updated.length > 0) {
    console.log(
      `[skiller] Updated ${updated.updated.length} agent-derived skill(s): ${updated.updated.join(', ')}`,
    );
  }
  if (updated.warnings.length > 0) {
    console.log(
      updated.warnings.map((warning) => `[skiller] ${warning}`).join('\n'),
    );
  }
  await applyAfterSkillsLifecycleStep(
    argv['project-root'],
    argv.verbose ?? false,
  );
}

export async function outdatedHandler(argv: SkillsWrapperArgs): Promise<void> {
  await executeSkillsWrapper(argv['project-root'], [
    'outdated',
    ...(argv.args ?? []),
  ]);
  const outdated = await getOutdatedAgentSkills(argv['project-root']);
  if (outdated.outdated.length > 0) {
    console.log(
      `[skiller] Agent-derived updates available:\n${outdated.outdated.map((name) => `- ${name}`).join('\n')}`,
    );
  }
  if (outdated.warnings.length > 0) {
    console.log(
      outdated.warnings.map((warning) => `[skiller] ${warning}`).join('\n'),
    );
  }
}

export async function skillsHandler(
  argv: SkillsPassthroughArgs,
): Promise<void> {
  await executeSkillsWrapper(argv['project-root'], [
    argv.subcommand,
    ...(argv.args ?? []),
  ]);
}

/**
 * Handler for the 'revert' command.
 */
export async function revertHandler(argv: RevertArgs): Promise<void> {
  const projectRoot = argv['project-root'];
  const agents = argv.agents
    ? argv.agents.split(',').map((a) => a.trim())
    : undefined;
  const configPath = argv.config;
  const keepBackups = argv['keep-backups'];
  const verbose = argv.verbose;
  const dryRun = argv['dry-run'];
  const localOnly = argv['local-only'];

  try {
    await revertAllAgentConfigs(
      projectRoot,
      agents,
      configPath,
      keepBackups,
      verbose,
      dryRun,
      localOnly,
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${ERROR_PREFIX} ${message}`);
    process.exit(1);
  }
}
