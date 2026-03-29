import type { Argv } from 'yargs';
import {
  addHandler,
  applyHandler,
  checkHandler,
  findHandler,
  initHandler,
  listHandler,
  migrateClaudePluginsHandler,
  migrateRulesToSkillsHandler,
  removeHandler,
  revertHandler,
  skillsHandler,
  updateHandler,
} from './handlers';
import {
  ApplyArgs,
  InitArgs,
  MigrateClaudePluginsArgs,
  MigrateRulesToSkillsArgs,
  RevertArgs,
  SkillsPassthroughArgs,
  SkillsWrapperArgs,
} from './handlers';
import { getAgentIdentifiersForCliHelp } from '../agents/index';

function skillsArgsBuilder(y: Argv) {
  return y
    .option('project-root', {
      type: 'string',
      description: 'Project root directory',
      default: process.cwd(),
    })
    .positional('args', {
      type: 'string',
      array: true,
      description: 'Arguments passed through to the local skills CLI',
    });
}

function migrateClaudePluginsArgsBuilder(y: Argv) {
  return y
    .option('project-root', {
      type: 'string',
      description: 'Project root directory',
      default: process.cwd(),
    })
    .option('execute', {
      type: 'boolean',
      description:
        'Actually install the resolved repos through the local skills CLI',
      default: false,
    });
}

function migrateRulesToSkillsArgsBuilder(y: Argv) {
  return y
    .option('project-root', {
      type: 'string',
      description: 'Project root directory',
      default: process.cwd(),
    })
    .option('execute', {
      type: 'boolean',
      description:
        'Actually replace selected local rules after detection',
      default: false,
    })
    .option('yes', {
      type: 'boolean',
      description:
        'Auto-replace only unambiguous exact matches without prompting',
      default: false,
    })
    .positional('rules', {
      type: 'string',
      array: true,
      description:
        'Specific rule names or .mdc files to check (default: all .agents/rules/*.mdc)',
    });
}

/**
 * Sets up and parses CLI commands.
 */
export async function run(): Promise<void> {
  const dynamicImport = new Function(
    'modulePath',
    'return import(modulePath);',
  ) as <T>(modulePath: string) => Promise<T>;
  const [{ default: yargs }, { hideBin }] = await Promise.all([
    dynamicImport<typeof import('yargs')>('yargs'),
    dynamicImport<typeof import('yargs/helpers')>('yargs/helpers'),
  ]);

  yargs(hideBin(process.argv))
    .scriptName('skiller')
    .usage('$0 <command> [options]')
    .command<ApplyArgs>(
      'apply',
      'Apply skiller configurations to supported AI agents',
      (y: Argv) => {
        return y
          .option('project-root', {
            type: 'string',
            description: 'Project root directory',
            default: process.cwd(),
          })
          .option('agents', {
            type: 'string',
            description: `Comma-separated list of agent identifiers: ${getAgentIdentifiersForCliHelp()}`,
          })
          .option('config', {
            type: 'string',
            description: 'Path to TOML configuration file',
          })
          .option('mcp', {
            type: 'boolean',
            description: 'Enable or disable applying MCP server config',
            default: true,
          })
          .alias('mcp', 'with-mcp')
          .option('mcp-overwrite', {
            type: 'boolean',
            description: 'Replace (not merge) the native MCP config(s)',
            default: false,
          })
          .option('gitignore', {
            type: 'boolean',
            description:
              'Enable/disable automatic .gitignore updates (default: enabled)',
          })
          .option('verbose', {
            type: 'boolean',
            description: 'Enable verbose logging',
            default: false,
          })
          .alias('verbose', 'v')
          .option('dry-run', {
            type: 'boolean',
            description: 'Preview changes without writing files',
            default: false,
          })
          .option('local-only', {
            type: 'boolean',
            description:
              'Only search for local .claude directories, ignore global config',
            default: false,
          })
          .option('nested', {
            type: 'boolean',
            description:
              'Enable nested rule loading from nested .claude directories (default: from config or disabled)',
          })
          .option('backup', {
            type: 'boolean',
            description:
              'Enable/disable creation of .bak backup files (default: enabled)',
          })
          .option('skills', {
            type: 'boolean',
            description:
              'Enable/disable skills support (experimental, default: enabled)',
          });
      },
      applyHandler,
    )
    .command<SkillsWrapperArgs>(
      'add [args..]',
      'Run the local skills CLI add command',
      skillsArgsBuilder,
      addHandler,
    )
    .command<SkillsWrapperArgs>(
      'remove [args..]',
      'Run the local skills CLI remove command',
      skillsArgsBuilder,
      removeHandler,
    )
    .command<SkillsWrapperArgs>(
      'list [args..]',
      'Run the local skills CLI list command',
      skillsArgsBuilder,
      listHandler,
    )
    .command<SkillsWrapperArgs>(
      'find [args..]',
      'Run the local skills CLI find command',
      skillsArgsBuilder,
      findHandler,
    )
    .command<SkillsWrapperArgs>(
      'check [args..]',
      'Run the local skills CLI check command',
      skillsArgsBuilder,
      checkHandler,
    )
    .command<SkillsWrapperArgs>(
      'update [args..]',
      'Run the local skills CLI update command',
      skillsArgsBuilder,
      updateHandler,
    )
    .command<SkillsPassthroughArgs>(
      'skills <subcommand> [args..]',
      'Pass through an arbitrary command to the local skills CLI',
      (y: Argv) =>
        skillsArgsBuilder(y).positional('subcommand', {
          type: 'string',
          description: 'The local skills CLI subcommand to run',
        }),
      skillsHandler,
    )
    .command<InitArgs>(
      'init',
      'Scaffold a .claude directory with default files',
      (y: Argv) => {
        return y
          .option('project-root', {
            type: 'string',
            description: 'Project root directory',
            default: process.cwd(),
          })
          .option('global', {
            type: 'boolean',
            description:
              'Initialize in global config directory (XDG_CONFIG_HOME/skiller)',
            default: false,
          });
      },
      initHandler,
    )
    .command(
      'migrate',
      'Migration utilities',
      (y: Argv) => {
        return y
          .command<MigrateClaudePluginsArgs>(
            'claude-plugins',
            'Plan or execute a one-shot migration from legacy Claude plugins to skills installs',
            migrateClaudePluginsArgsBuilder,
            migrateClaudePluginsHandler,
          )
          .command<MigrateRulesToSkillsArgs>(
            'rules-to-skills [rules..]',
            'Detect local .agents/rules .mdc files that already exist on skills.sh and optionally replace them',
            migrateRulesToSkillsArgsBuilder,
            migrateRulesToSkillsHandler,
          )
          .demandCommand(1, 'You need to specify a migrate subcommand')
          .strict();
      },
      () => undefined,
    )
    .command<RevertArgs>(
      'revert',
      'Revert skiller configurations from supported AI agents',
      (y: Argv) => {
        return y
          .option('project-root', {
            type: 'string',
            description: 'Project root directory',
            default: process.cwd(),
          })
          .option('agents', {
            type: 'string',
            description: `Comma-separated list of agent identifiers: ${getAgentIdentifiersForCliHelp()}`,
          })
          .option('config', {
            type: 'string',
            description: 'Path to TOML configuration file',
          })
          .option('keep-backups', {
            type: 'boolean',
            description: 'Keep backup files after revert',
            default: false,
          })
          .option('verbose', {
            type: 'boolean',
            description: 'Enable verbose logging',
            default: false,
          })
          .alias('verbose', 'v')
          .option('dry-run', {
            type: 'boolean',
            description: 'Preview changes without writing files',
            default: false,
          })
          .option('local-only', {
            type: 'boolean',
            description:
              'Only search for local .agents directories, ignore global config',
            default: false,
          });
      },
      revertHandler,
    )
    .demandCommand(1, 'You need to specify a command')
    .help()
    .strict()
    .parse();
}
