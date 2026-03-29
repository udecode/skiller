import { applyAllAgentConfigs } from '../lib';
import { revertAllAgentConfigs } from '../revert';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { ERROR_PREFIX, DEFAULT_RULES_FILENAME } from '../constants';
import { McpStrategy } from '../types';
import { loadConfig } from '../core/ConfigLoader';
import { planClaudePluginSkillsMigration } from '../core/ClaudePluginMigration';
import {
  buildRulesReplacementInstallArgs,
  planRulesToSkillsMigration,
  removeLocalRuleReplacementState,
  type RuleReplacementCandidate,
  type SkillsRegistryMatch,
} from '../core/RulesToSkillsMigration';
import { getAgentIdentifiersForCliHelp } from '../agents';
import { runSkillsCli } from './skills-cli';
import {
  CANONICAL_SKILLER_DIR,
  SKILLER_CONFIG_FILE,
} from '../core/project-paths';
import * as readline from 'readline/promises';

export interface ApplyArgs {
  'project-root': string;
  agents?: string;
  config?: string;
  mcp: boolean;
  'mcp-overwrite': boolean;
  gitignore?: boolean;
  verbose: boolean;
  'dry-run': boolean;
  'local-only': boolean;
  nested?: boolean;
  backup: boolean;
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

function buildClaudePluginMigrationArgs(source: string): string[] {
  return ['add', source, '--agent', 'universal', '--skill', '*', '-y'];
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

    if (plan.unresolved.length > 0) {
      throw new Error(
        `Cannot execute migration until all plugins resolve:\n${plan.unresolved.map((entry) => `- ${entry.pluginId}: ${entry.reason}`).join('\n')}`,
      );
    }

    for (const install of plan.installs) {
      await runSkillsCli(
        projectRoot,
        buildClaudePluginMigrationArgs(install.source),
      );
    }

    console.log(
      '[skiller] Claude plugin repo migration completed. Remove the plugin entries from .claude/settings.json, then rerun skiller apply.',
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
  await executeSkillsWrapper(argv['project-root'], [
    'add',
    ...(argv.args ?? []),
  ]);
}

export async function removeHandler(argv: SkillsWrapperArgs): Promise<void> {
  await executeSkillsWrapper(argv['project-root'], [
    'remove',
    ...(argv.args ?? []),
  ]);
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

export async function updateHandler(argv: SkillsWrapperArgs): Promise<void> {
  await executeSkillsWrapper(argv['project-root'], [
    'update',
    ...(argv.args ?? []),
  ]);
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
