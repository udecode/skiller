import {
  addHandler,
  applyHandler,
  initHandler,
  installHandler,
  migrateClaudePluginsHandler,
  revertHandler,
  skillsHandler,
  updateHandler,
  outdatedHandler,
  removeHandler,
  listHandler,
  findHandler,
  checkHandler,
} from '../../../src/cli/handlers';
import { applyAllAgentConfigs } from '../../../src/lib';
import { revertAllAgentConfigs } from '../../../src/revert';
import { runSkillsCli } from '../../../src/cli/skills-cli';
import {
  listClaudePluginAuxiliaryRuleNames,
  planClaudePluginSkillsMigration,
} from '../../../src/core/ClaudePluginMigration';
import {
  planRulesToSkillsMigration,
  removeLocalRuleReplacementState,
} from '../../../src/core/RulesToSkillsMigration';
import { resolveSkillOwnership } from '../../../src/core/SkillOwnership';
import {
  getOutdatedAgentSkills,
  inspectCompatibleSource,
  installAgentSkillsFromInspection,
  removeAgentManagedSkills,
  restoreAgentSkillsFromLock,
  updateAgentSkillsFromLock,
} from '../../../src/core/AgentSourceCompatibility';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { loadConfig } from '../../../src/core/ConfigLoader';

// Mock the external dependencies
jest.mock('../../../src/lib');
jest.mock('../../../src/revert');
jest.mock('../../../src/cli/skills-cli');
jest.mock('fs/promises');
jest.mock('../../../src/core/ConfigLoader');
jest.mock('../../../src/core/ClaudePluginMigration');
jest.mock('../../../src/core/RulesToSkillsMigration', () => ({
  ...jest.requireActual('../../../src/core/RulesToSkillsMigration'),
  planRulesToSkillsMigration: jest.fn(),
  removeLocalRuleReplacementState: jest.fn(),
}));
jest.mock('../../../src/core/SkillOwnership', () => ({
  ...jest.requireActual('../../../src/core/SkillOwnership'),
  resolveSkillOwnership: jest.fn(),
}));
jest.mock('../../../src/core/AgentSourceCompatibility', () => ({
  ...jest.requireActual('../../../src/core/AgentSourceCompatibility'),
  getOutdatedAgentSkills: jest.fn(),
  inspectCompatibleSource: jest.fn(),
  installAgentSkillsFromInspection: jest.fn(),
  removeAgentManagedSkills: jest.fn(),
  restoreAgentSkillsFromLock: jest.fn(),
  updateAgentSkillsFromLock: jest.fn(),
}));

describe('CLI Handlers', () => {
  const mockProjectRoot = '/mock/project/root';
  const mockError = new Error('Test error');

  beforeEach(() => {
    jest.clearAllMocks();
    (applyAllAgentConfigs as jest.Mock).mockResolvedValue(undefined);
    (revertAllAgentConfigs as jest.Mock).mockResolvedValue(undefined);
    (runSkillsCli as jest.Mock).mockResolvedValue(undefined);
    (planClaudePluginSkillsMigration as jest.Mock).mockResolvedValue({
      installs: [],
      unresolved: [],
    });
    (listClaudePluginAuxiliaryRuleNames as jest.Mock).mockResolvedValue([]);
    (planRulesToSkillsMigration as jest.Mock).mockResolvedValue({
      candidates: [],
      missingRequested: [],
      scannedRules: [],
      unmatched: [],
    });
    (removeLocalRuleReplacementState as jest.Mock).mockResolvedValue(undefined);
    (resolveSkillOwnership as jest.Mock).mockResolvedValue({
      upstreamOwned: new Set<string>(),
      localOwned: new Set<string>(),
      orphaned: new Set<string>(),
      conflicts: [],
      warnings: [],
    });
    (getOutdatedAgentSkills as jest.Mock).mockResolvedValue({
      outdated: [],
      warnings: [],
    });
    (inspectCompatibleSource as jest.Mock).mockResolvedValue({
      agentSkills: [],
      nativeSkillNames: [],
      workspace: {
        cleanup: jest.fn().mockResolvedValue(undefined),
        parsed: { source: 'owner/repo', type: 'github', url: 'https://github.com/owner/repo.git' },
      },
    });
    (installAgentSkillsFromInspection as jest.Mock).mockResolvedValue([]);
    (removeAgentManagedSkills as jest.Mock).mockResolvedValue([]);
    (restoreAgentSkillsFromLock as jest.Mock).mockResolvedValue({
      restored: [],
      warnings: [],
    });
    (updateAgentSkillsFromLock as jest.Mock).mockResolvedValue({
      updated: [],
      warnings: [],
    });
    // Mock loadConfig to return default config
    (loadConfig as jest.Mock).mockResolvedValue({
      defaultAgents: undefined,
      agentConfigs: {},
      cliAgents: undefined,
      mcp: {},
      gitignore: {},
      nested: false,
    });
  });

  describe('applyHandler', () => {
    it('should call applyAllAgentConfigs with correct parameters', async () => {
      const argv = {
        'project-root': mockProjectRoot,
        agents: 'github-copilot,claude-code',
        config: '/path/to/config.toml',
        mcp: true,
        'mcp-overwrite': false,
        gitignore: true,
        verbose: true,
        'dry-run': false,
        'local-only': false,
        nested: false,
        backup: true,
      };

      await applyHandler(argv);

      expect(applyAllAgentConfigs).toHaveBeenCalledWith(
        mockProjectRoot,
        ['github-copilot', 'claude-code'],
        '/path/to/config.toml',
        true,
        undefined,
        true,
        true,
        false,
        false,
        false,
        true,
        undefined,
      );
      expect(runSkillsCli).not.toHaveBeenCalled();
    });

    it('should handle mcp-overwrite correctly', async () => {
      const argv = {
        'project-root': mockProjectRoot,
        mcp: true,
        'mcp-overwrite': true,
        verbose: false,
        'dry-run': false,
        'local-only': false,
        nested: false,
        backup: true,
      };

      await applyHandler(argv);

      expect(applyAllAgentConfigs).toHaveBeenCalledWith(
        mockProjectRoot,
        undefined,
        undefined,
        true,
        'overwrite',
        undefined,
        false,
        false,
        false,
        false,
        true,
        undefined,
      );
    });

    it('should handle gitignore preference correctly', async () => {
      const argv = {
        'project-root': mockProjectRoot,
        mcp: true,
        'mcp-overwrite': false,
        gitignore: false,
        verbose: false,
        'dry-run': false,
        'local-only': false,
        nested: false,
        backup: true,
      };

      await applyHandler(argv);

      expect(applyAllAgentConfigs).toHaveBeenCalledWith(
        mockProjectRoot,
        undefined,
        undefined,
        true,
        undefined,
        false,
        false,
        false,
        false,
        false,
        true,
        undefined,
      );
    });

    it('should handle undefined gitignore correctly', async () => {
      const argv = {
        'project-root': mockProjectRoot,
        mcp: true,
        'mcp-overwrite': false,
        verbose: false,
        'dry-run': false,
        'local-only': false,
        nested: false,
        backup: true,
      };

      await applyHandler(argv);

      expect(applyAllAgentConfigs).toHaveBeenCalledWith(
        mockProjectRoot,
        undefined,
        undefined,
        true,
        undefined,
        undefined,
        false,
        false,
        false,
        false,
        true,
        undefined,
      );
    });

    it('should use CLI nested value when explicitly provided', async () => {
      const argv = {
        'project-root': mockProjectRoot,
        mcp: true,
        'mcp-overwrite': false,
        verbose: false,
        'dry-run': false,
        'local-only': false,
        nested: true,
        backup: true,
      };

      await applyHandler(argv);

      expect(applyAllAgentConfigs).toHaveBeenCalledWith(
        mockProjectRoot,
        undefined,
        undefined,
        true,
        undefined,
        undefined,
        false,
        false,
        false,
        true, // nested should be true from CLI
        true,
        undefined,
      );
      // loadConfig should not be called when CLI explicitly sets nested
      expect(loadConfig).not.toHaveBeenCalled();
    });

    it('should use TOML nested value when CLI does not provide it', async () => {
      (loadConfig as jest.Mock).mockResolvedValue({
        defaultAgents: undefined,
        agentConfigs: {},
        cliAgents: undefined,
        mcp: {},
        gitignore: {},
        nested: true, // nested = true in TOML
      });

      const argv = {
        'project-root': mockProjectRoot,
        mcp: true,
        'mcp-overwrite': false,
        verbose: false,
        'dry-run': false,
        'local-only': false,
        // nested is undefined (not provided by CLI)
        backup: true,
      };

      await applyHandler(argv);

      expect(loadConfig).toHaveBeenCalledWith({
        projectRoot: mockProjectRoot,
        configPath: undefined,
      });
      expect(applyAllAgentConfigs).toHaveBeenCalledWith(
        mockProjectRoot,
        undefined,
        undefined,
        true,
        undefined,
        undefined,
        false,
        false,
        false,
        true, // nested should be true from TOML
        true,
        undefined,
      );
    });

    it('should default to false when CLI and TOML do not provide nested', async () => {
      (loadConfig as jest.Mock).mockResolvedValue({
        defaultAgents: undefined,
        agentConfigs: {},
        cliAgents: undefined,
        mcp: {},
        gitignore: {},
        nested: undefined, // not in TOML either
      });

      const argv = {
        'project-root': mockProjectRoot,
        mcp: true,
        'mcp-overwrite': false,
        verbose: false,
        'dry-run': false,
        'local-only': false,
        // nested is undefined (not provided by CLI)
        backup: true,
      };

      await applyHandler(argv);

      expect(applyAllAgentConfigs).toHaveBeenCalledWith(
        mockProjectRoot,
        undefined,
        undefined,
        true,
        undefined,
        undefined,
        false,
        false,
        false,
        false, // nested should default to false
        true,
        undefined,
      );
    });

    it('should prefer CLI --nested over TOML nested = false', async () => {
      (loadConfig as jest.Mock).mockResolvedValue({
        defaultAgents: undefined,
        agentConfigs: {},
        cliAgents: undefined,
        mcp: {},
        gitignore: {},
        nested: false, // nested = false in TOML
      });

      const argv = {
        'project-root': mockProjectRoot,
        mcp: true,
        'mcp-overwrite': false,
        verbose: false,
        'dry-run': false,
        'local-only': false,
        nested: true, // CLI overrides TOML
        backup: true,
      };

      await applyHandler(argv);

      // loadConfig should not be called when CLI explicitly sets nested
      expect(loadConfig).not.toHaveBeenCalled();
      expect(applyAllAgentConfigs).toHaveBeenCalledWith(
        mockProjectRoot,
        undefined,
        undefined,
        true,
        undefined,
        undefined,
        false,
        false,
        false,
        true, // nested should be true from CLI, ignoring TOML
        true,
        undefined,
      );
    });

    it('should exit with error code 1 when applyAllAgentConfigs throws', async () => {
      (applyAllAgentConfigs as jest.Mock).mockRejectedValue(mockError);

      const exitSpy = jest
        .spyOn(process, 'exit')
        .mockImplementation((code?: string | number | null | undefined) => {
          throw new Error(`process.exit: ${code}`);
        });

      const errorSpy = jest.spyOn(console, 'error').mockImplementation();

      const argv = {
        'project-root': mockProjectRoot,
        mcp: true,
        'mcp-overwrite': false,
        verbose: false,
        'dry-run': false,
        'local-only': false,
        nested: false,
        backup: true,
      };

      await expect(applyHandler(argv)).rejects.toThrow('process.exit: 1');

      expect(errorSpy).toHaveBeenCalledWith('[skiller] Test error');
      expect(exitSpy).toHaveBeenCalledWith(1);

      exitSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });

  describe('skills wrapper handlers', () => {
    it('delegates add to the pinned local skills CLI', async () => {
      await addHandler({
        'project-root': mockProjectRoot,
        args: ['react', '--agent', 'codex'],
        verbose: false,
      });

      expect(runSkillsCli).toHaveBeenCalledWith(mockProjectRoot, [
        'add',
        'react',
        '--agent',
        'codex',
      ]);
      expect(applyAllAgentConfigs).toHaveBeenCalledWith(
        mockProjectRoot,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        false,
        undefined,
        undefined,
        false,
        undefined,
        undefined,
      );
    });

    it('installs compatible agent sources without calling skills add when no native skills match', async () => {
      (inspectCompatibleSource as jest.Mock).mockResolvedValue({
        agentSkills: [{ installName: 'learnings-researcher' }],
        nativeSkillNames: [],
        workspace: {
          cleanup: jest.fn().mockResolvedValue(undefined),
          parsed: {
            source: 'EveryInc/compound-engineering-plugin',
            type: 'github',
            url: 'https://github.com/EveryInc/compound-engineering-plugin.git',
          },
        },
      });
      (installAgentSkillsFromInspection as jest.Mock).mockResolvedValue([
        'learnings-researcher',
      ]);

      await addHandler({
        'project-root': mockProjectRoot,
        args: [
          'EveryInc/compound-engineering-plugin',
          '--skill',
          'learnings-researcher',
          '-y',
        ],
        verbose: false,
      });

      expect(runSkillsCli).not.toHaveBeenCalled();
      expect(installAgentSkillsFromInspection).toHaveBeenCalled();
      expect(applyAllAgentConfigs).toHaveBeenCalled();
    });

    it('delegates update to the pinned local skills CLI', async () => {
      await updateHandler({
        'project-root': mockProjectRoot,
        args: ['--all'],
        verbose: false,
      });

      expect(runSkillsCli).toHaveBeenCalledWith(mockProjectRoot, [
        'update',
        '--all',
      ]);
      expect(updateAgentSkillsFromLock).toHaveBeenCalledWith(mockProjectRoot);
      expect(applyAllAgentConfigs).toHaveBeenCalledWith(
        mockProjectRoot,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        false,
        undefined,
        undefined,
        false,
        undefined,
        undefined,
      );
    });

    it('delegates install to experimental_install and auto-applies', async () => {
      await installHandler({
        'project-root': mockProjectRoot,
        args: ['--frozen'],
        verbose: true,
      });

      expect(runSkillsCli).toHaveBeenCalledWith(mockProjectRoot, [
        'experimental_install',
        '--frozen',
      ]);
      expect(restoreAgentSkillsFromLock).toHaveBeenCalledWith(mockProjectRoot);
      expect(applyAllAgentConfigs).toHaveBeenCalledWith(
        mockProjectRoot,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        true,
        undefined,
        undefined,
        false,
        undefined,
        undefined,
      );
    });

    it('delegates outdated to the pinned local skills CLI without applying', async () => {
      await outdatedHandler({
        'project-root': mockProjectRoot,
        args: ['--json'],
      });

      expect(runSkillsCli).toHaveBeenCalledWith(mockProjectRoot, [
        'outdated',
        '--json',
      ]);
      expect(getOutdatedAgentSkills).toHaveBeenCalledWith(mockProjectRoot);
      expect(applyAllAgentConfigs).not.toHaveBeenCalled();
    });

    it('delegates remove/list/find/check wrappers to the pinned local skills CLI', async () => {
      (resolveSkillOwnership as jest.Mock).mockResolvedValue({
        upstreamOwned: new Set<string>(['react']),
        localOwned: new Set<string>(),
        orphaned: new Set<string>(),
        conflicts: [],
        warnings: [],
      });

      await removeHandler({
        'project-root': mockProjectRoot,
        args: ['react'],
        verbose: true,
      });
      await listHandler({
        'project-root': mockProjectRoot,
        args: ['--json'],
      });
      await findHandler({
        'project-root': mockProjectRoot,
        args: ['browser'],
      });
      await checkHandler({
        'project-root': mockProjectRoot,
        args: ['--strict'],
      });

      expect(runSkillsCli).toHaveBeenNthCalledWith(1, mockProjectRoot, [
        'remove',
        'react',
      ]);
      expect(runSkillsCli).toHaveBeenNthCalledWith(2, mockProjectRoot, [
        'list',
        '--json',
      ]);
      expect(runSkillsCli).toHaveBeenNthCalledWith(3, mockProjectRoot, [
        'find',
        'browser',
      ]);
      expect(runSkillsCli).toHaveBeenNthCalledWith(4, mockProjectRoot, [
        'check',
        '--strict',
      ]);
      expect(removeAgentManagedSkills).toHaveBeenCalledWith(mockProjectRoot, [
        'react',
      ]);
      expect(applyAllAgentConfigs).toHaveBeenCalledWith(
        mockProjectRoot,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        true,
        undefined,
        undefined,
        false,
        undefined,
        undefined,
      );
    });

    it('prunes requested orphan skill outputs during remove before apply', async () => {
      (resolveSkillOwnership as jest.Mock).mockResolvedValue({
        upstreamOwned: new Set<string>(),
        localOwned: new Set<string>(),
        orphaned: new Set<string>(['react']),
        conflicts: [],
        warnings: [],
      });

      await removeHandler({
        'project-root': mockProjectRoot,
        args: ['react', '-y'],
        verbose: true,
      });

      expect(runSkillsCli).not.toHaveBeenCalled();
      expect(fs.rm).toHaveBeenCalledWith(
        path.join(mockProjectRoot, '.agents', 'skills', 'react'),
        { force: true, recursive: true },
      );
      expect(fs.rm).toHaveBeenCalledWith(
        path.join(mockProjectRoot, '.claude', 'skills', 'react'),
        { force: true, recursive: true },
      );
      expect(applyAllAgentConfigs).toHaveBeenCalled();
    });

    it('does not prune outputs for still-owned skills during remove', async () => {
      (resolveSkillOwnership as jest.Mock).mockResolvedValue({
        upstreamOwned: new Set<string>(['react']),
        localOwned: new Set<string>(),
        orphaned: new Set<string>(),
        conflicts: [],
        warnings: [],
      });

      await removeHandler({
        'project-root': mockProjectRoot,
        args: ['react', '-y'],
        verbose: true,
      });

      expect(runSkillsCli).toHaveBeenCalledWith(mockProjectRoot, [
        'remove',
        'react',
        '-y',
      ]);
      expect(fs.rm).not.toHaveBeenCalledWith(
        path.join(mockProjectRoot, '.agents', 'skills', 'react'),
        { force: true, recursive: true },
      );
      expect(fs.rm).not.toHaveBeenCalledWith(
        path.join(mockProjectRoot, '.claude', 'skills', 'react'),
        { force: true, recursive: true },
      );
      expect(applyAllAgentConfigs).toHaveBeenCalled();
    });

    it('scrubs requested stale skills-lock entries during remove', async () => {
      (fs.readFile as jest.Mock).mockResolvedValueOnce(
        JSON.stringify({
          skills: {
            react: { source: 'foo/bar' },
            'ce:work-beta': { source: 'foo/bar' },
            keep: { source: 'foo/bar' },
          },
        }),
      );

      await removeHandler({
        'project-root': mockProjectRoot,
        args: ['react', 'ce-work-beta', '-y'],
        verbose: true,
      });

      expect(fs.writeFile).toHaveBeenCalledWith(
        path.join(mockProjectRoot, 'skills-lock.json'),
        JSON.stringify(
          {
            skills: {
              keep: { source: 'foo/bar' },
            },
          },
          null,
          2,
        ) + '\n',
      );
      expect(applyAllAgentConfigs).toHaveBeenCalled();
    });

    it('passes through arbitrary skills subcommands unchanged', async () => {
      await skillsHandler({
        'project-root': mockProjectRoot,
        subcommand: 'doctor',
        args: ['--verbose'],
      });

      expect(runSkillsCli).toHaveBeenCalledWith(mockProjectRoot, [
        'doctor',
        '--verbose',
      ]);
    });
  });

  describe('migrateClaudePluginsHandler', () => {
    it('prints a dry-run plan without executing skills installs', async () => {
      (planClaudePluginSkillsMigration as jest.Mock).mockResolvedValue({
        installs: [
          {
            source: 'EveryInc/compound-engineering-plugin',
            pluginIds: ['compound-engineering@every-marketplace'],
            strategy: 'marketplace-source',
          },
          {
            source: 'udecode/dotai',
            pluginIds: ['debug@dotai', 'test@dotai'],
            strategy: 'marketplace-source',
          },
        ],
        unresolved: [],
      });

      const logSpy = jest.spyOn(console, 'log').mockImplementation();

      await migrateClaudePluginsHandler({
        'project-root': mockProjectRoot,
        execute: false,
      });

      expect(runSkillsCli).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('EveryInc/compound-engineering-plugin'),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Run again with --execute'),
      );

      logSpy.mockRestore();
    });

    it('executes one skills add per resolved source when --execute is set', async () => {
      (planClaudePluginSkillsMigration as jest.Mock).mockResolvedValue({
        installs: [
          {
            source: 'EveryInc/compound-engineering-plugin',
            pluginIds: ['compound-engineering@every-marketplace'],
            strategy: 'marketplace-source',
          },
          {
            source: 'udecode/dotai',
            pluginIds: ['debug@dotai', 'test@dotai'],
            strategy: 'marketplace-source',
          },
        ],
        unresolved: [],
      });

      await migrateClaudePluginsHandler({
        'project-root': mockProjectRoot,
        execute: true,
      });

      expect(runSkillsCli).toHaveBeenNthCalledWith(1, mockProjectRoot, [
        'add',
        'EveryInc/compound-engineering-plugin',
        '--agent',
        'universal',
        '--skill',
        '*',
        '-y',
      ]);
      expect(runSkillsCli).toHaveBeenNthCalledWith(2, mockProjectRoot, [
        'add',
        'udecode/dotai',
        '--agent',
        'universal',
        '--skill',
        '*',
        '-y',
      ]);
    });

    it('removes stale plugin-derived auxiliary rules after install', async () => {
      (planClaudePluginSkillsMigration as jest.Mock).mockResolvedValue({
        installs: [
          {
            source: 'EveryInc/compound-engineering-plugin',
            pluginIds: ['compound-engineering@every-marketplace'],
            strategy: 'marketplace-source',
          },
        ],
        unresolved: [],
      });
      (listClaudePluginAuxiliaryRuleNames as jest.Mock).mockResolvedValue([
        'adversarial-document-reviewer',
        'agent-native-reviewer',
      ]);
      (planRulesToSkillsMigration as jest.Mock).mockResolvedValue({
        candidates: [
          {
            alreadyInstalled: false,
            matches: [
              {
                installs: 42,
                name: 'agent-native-reviewer',
                slug: 'udecode/plate/agent-native-reviewer',
                source: 'udecode/plate',
              },
            ],
            ruleName: 'agent-native-reviewer',
          },
        ],
        missingRequested: [],
        scannedRules: [
          'adversarial-document-reviewer',
          'agent-native-reviewer',
        ],
        unmatched: ['adversarial-document-reviewer'],
      });

      await migrateClaudePluginsHandler({
        'project-root': mockProjectRoot,
        execute: true,
      });

      expect(removeLocalRuleReplacementState).toHaveBeenCalledTimes(1);
      expect(removeLocalRuleReplacementState).toHaveBeenCalledWith(
        mockProjectRoot,
        'adversarial-document-reviewer',
        false,
      );
      expect(fs.rm).toHaveBeenCalledWith(
        path.join(
          mockProjectRoot,
          '.agents',
          'skills',
          'adversarial-document-reviewer',
        ),
        { force: true, recursive: true },
      );
      expect(fs.rm).toHaveBeenCalledWith(
        path.join(
          mockProjectRoot,
          '.claude',
          'skills',
          'adversarial-document-reviewer',
        ),
        { force: true, recursive: true },
      );
    });

    it('removes local legacy rules when they exact-match ratacat/claude-skills', async () => {
      (planClaudePluginSkillsMigration as jest.Mock).mockResolvedValue({
        installs: [
          {
            source: 'EveryInc/compound-engineering-plugin',
            pluginIds: ['compound-engineering@every-marketplace'],
            strategy: 'marketplace-source',
          },
        ],
        unresolved: [],
      });
      (listClaudePluginAuxiliaryRuleNames as jest.Mock).mockResolvedValue([]);
      (planRulesToSkillsMigration as jest.Mock).mockResolvedValue({
        candidates: [
          {
            alreadyInstalled: false,
            matches: [
              {
                installs: 42,
                name: 'ankane-readme-writer',
                slug: 'udecode/plate/ankane-readme-writer',
                source: 'udecode/plate',
              },
              {
                installs: 12,
                name: 'ankane-readme-writer',
                slug: 'ratacat/claude-skills/ankane-readme-writer',
                source: 'ratacat/claude-skills',
              },
            ],
            ruleName: 'ankane-readme-writer',
          },
          {
            alreadyInstalled: false,
            matches: [
              {
                installs: 10,
                name: 'changeset',
                slug: 'garden-co/jazz/changeset',
                source: 'garden-co/jazz',
              },
            ],
            ruleName: 'changeset',
          },
        ],
        missingRequested: [],
        scannedRules: ['ankane-readme-writer', 'changeset'],
        unmatched: [],
      });

      await migrateClaudePluginsHandler({
        'project-root': mockProjectRoot,
        execute: true,
      });

      expect(removeLocalRuleReplacementState).toHaveBeenCalledWith(
        mockProjectRoot,
        'ankane-readme-writer',
        false,
      );
      expect(removeLocalRuleReplacementState).not.toHaveBeenCalledWith(
        mockProjectRoot,
        'changeset',
        false,
      );
      expect(fs.rm).toHaveBeenCalledWith(
        path.join(mockProjectRoot, '.agents', 'skills', 'ankane-readme-writer'),
        { force: true, recursive: true },
      );
    });

    it('executes resolved installs and logs skipped unresolved plugins', async () => {
      (planClaudePluginSkillsMigration as jest.Mock).mockResolvedValue({
        installs: [
          {
            source: 'EveryInc/compound-engineering-plugin',
            pluginIds: ['compound-engineering@every-marketplace'],
            strategy: 'marketplace-source',
          },
        ],
        unresolved: [
          {
            pluginId: 'mystery@unknown-marketplace',
            reason: 'No repo source found',
          },
        ],
      });

      (fs.readFile as jest.Mock).mockImplementation(
        async (filePath: string) => {
          if (
            filePath === path.join(mockProjectRoot, '.claude', 'settings.json')
          ) {
            return JSON.stringify({
              enabledPlugins: {
                'compound-engineering@every-marketplace': true,
                'mystery@unknown-marketplace': true,
              },
              theme: 'dark',
            });
          }

          if (
            filePath === path.join(mockProjectRoot, '.claude', '.skiller.json')
          ) {
            return JSON.stringify({
              version: 1,
              targets: {
                '.claude/skills': [
                  {
                    sourceType: 'plugin',
                    pluginId: 'compound-engineering@every-marketplace',
                    sourceKind: 'skill',
                    sourceRelPath: 'skills/ce-work',
                    destRelPath: 'compound-engineering-ce-work',
                  },
                  {
                    sourceType: 'claude',
                    sourceKind: 'command',
                    sourceRelPath: 'commands/linear.md',
                    destRelPath: 'linear',
                  },
                ],
              },
            });
          }

          throw new Error('ENOENT');
        },
      );
      (fs.writeFile as jest.Mock).mockResolvedValue(undefined);
      (fs.rm as jest.Mock).mockResolvedValue(undefined);
      const logSpy = jest.spyOn(console, 'log').mockImplementation();

      await migrateClaudePluginsHandler({
        'project-root': mockProjectRoot,
        execute: true,
      });

      expect(runSkillsCli).toHaveBeenCalledWith(mockProjectRoot, [
        'add',
        'EveryInc/compound-engineering-plugin',
        '--agent',
        'universal',
        '--skill',
        '*',
        '-y',
      ]);
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('mystery@unknown-marketplace'),
      );
      expect(fs.writeFile).toHaveBeenCalledWith(
        path.join(mockProjectRoot, '.claude', 'settings.json'),
        expect.not.stringContaining('compound-engineering@every-marketplace'),
      );
      expect(fs.writeFile).toHaveBeenCalledWith(
        path.join(mockProjectRoot, '.claude', '.skiller.json'),
        expect.not.stringContaining('compound-engineering@every-marketplace'),
      );

      logSpy.mockRestore();
    });

    it('fails when every plugin is unresolved and nothing is installable', async () => {
      (planClaudePluginSkillsMigration as jest.Mock).mockResolvedValue({
        installs: [],
        unresolved: [
          {
            pluginId: 'mystery@unknown-marketplace',
            reason: 'No repo source found',
          },
        ],
      });

      const exitSpy = jest
        .spyOn(process, 'exit')
        .mockImplementation((code?: string | number | null | undefined) => {
          throw new Error(`process.exit: ${code}`);
        });
      const errorSpy = jest.spyOn(console, 'error').mockImplementation();

      await expect(
        migrateClaudePluginsHandler({
          'project-root': mockProjectRoot,
          execute: true,
        }),
      ).rejects.toThrow('process.exit: 1');

      expect(runSkillsCli).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('mystery@unknown-marketplace'),
      );

      exitSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });

  describe('initHandler', () => {
    const mockSkillerDir = path.join(mockProjectRoot, '.agents');
    const mockInstructionsPath = path.join(mockSkillerDir, 'AGENTS.md');
    const mockTomlPath = path.join(mockSkillerDir, 'skiller.toml');
    const mockLegacyPath = path.join(mockSkillerDir, 'instructions.md');

    beforeEach(() => {
      (fs.access as jest.Mock).mockRejectedValue(new Error('File not found'));
      (fs.mkdir as jest.Mock).mockResolvedValue(undefined);
      (fs.writeFile as jest.Mock).mockResolvedValue(undefined);
    });

    it('should create .agents directory and default files', async () => {
      const argv = {
        'project-root': mockProjectRoot,
        global: false,
      };

      await initHandler(argv);

      expect(fs.mkdir).toHaveBeenCalledWith(mockSkillerDir, {
        recursive: true,
      });
      expect(fs.writeFile).toHaveBeenCalledWith(
        mockInstructionsPath,
        expect.stringContaining('# AGENTS.md'),
      );
      expect(fs.writeFile).toHaveBeenCalledWith(
        mockTomlPath,
        expect.stringContaining('# Skiller Configuration File'),
      );
    });

    it('should NOT create mcp.json file', async () => {
      const argv = {
        'project-root': mockProjectRoot,
        global: false,
      };

      await initHandler(argv);

      // Verify mcp.json is never written
      expect(fs.writeFile).not.toHaveBeenCalledWith(
        expect.stringContaining('mcp.json'),
        expect.anything(),
      );
    });

    it('should include sample MCP server sections in skiller.toml', async () => {
      const argv = {
        'project-root': mockProjectRoot,
        global: false,
      };

      await initHandler(argv);

      // Find the call that writes to skiller.toml
      const tomlWriteCall = (fs.writeFile as jest.Mock).mock.calls.find(
        (call) => call[0] === mockTomlPath,
      );

      expect(tomlWriteCall).toBeDefined();
      const tomlContent = tomlWriteCall[1];

      // Verify MCP server sections are present
      expect(tomlContent).toContain('# --- MCP Servers ---');
      expect(tomlContent).toContain('[mcp_servers.example_stdio]');
      expect(tomlContent).toContain('[mcp_servers.example_remote]');
      expect(tomlContent).toContain('# command = "node"');
      expect(tomlContent).toContain('# url = "https://api.example.com/mcp"');
    });

    it('should handle global initialization', async () => {
      const mockGlobalDir = path.join(os.homedir(), '.config', 'skiller');
      const argv = {
        'project-root': mockProjectRoot,
        global: true,
      };

      // Mock the mkdir to resolve successfully
      (fs.mkdir as jest.Mock).mockResolvedValue(undefined);

      await initHandler(argv);

      expect(fs.mkdir).toHaveBeenCalledWith(mockGlobalDir, { recursive: true });
    });

    it('should handle custom XDG_CONFIG_HOME for global initialization', async () => {
      const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
      process.env.XDG_CONFIG_HOME = '/tmp/custom/config/path';

      const mockCustomDir = path.join('/tmp/custom/config/path', 'skiller');
      const argv = {
        'project-root': mockProjectRoot,
        global: true,
      };

      // Mock the mkdir to resolve successfully
      (fs.mkdir as jest.Mock).mockResolvedValue(undefined);

      await initHandler(argv);

      expect(fs.mkdir).toHaveBeenCalledWith(mockCustomDir, { recursive: true });

      process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
    });

    it('should skip creating files that already exist', async () => {
      (fs.access as jest.Mock)
        .mockResolvedValueOnce(undefined) // instructions.md exists
        .mockResolvedValueOnce(undefined); // skiller.toml exists

      const argv = {
        'project-root': mockProjectRoot,
        global: false,
      };

      await initHandler(argv);

      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('should create AGENTS.md when legacy instructions.md exists (legacy preserved silently)', async () => {
      // access sequence: AGENTS.md (fail), legacy instructions.md (exists), skiller.toml (fail)
      (fs.access as jest.Mock)
        .mockRejectedValueOnce(new Error('AGENTS missing'))
        .mockResolvedValueOnce(undefined) // legacy exists
        .mockRejectedValueOnce(new Error('toml missing'));
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const argv = { 'project-root': mockProjectRoot, global: false };
      // Simulate legacy existing by making read of legacy path succeed when probed later (we'll implement probe)
      // We'll adjust implementation to check legacy path existence separately.
      await initHandler(argv);
      expect(fs.writeFile).toHaveBeenCalledWith(
        mockInstructionsPath,
        expect.stringContaining('# AGENTS.md'),
      );
      // Expect a notice about legacy detection once implementation added
      // No legacy notice expected anymore
      expect(
        logSpy.mock.calls.some((c) =>
          /legacy instructions\.md detected/i.test(c[0]),
        ),
      ).toBe(false);
      logSpy.mockRestore();
    });
  });

  describe('revertHandler', () => {
    it('should call revertAllAgentConfigs with correct parameters', async () => {
      const argv = {
        'project-root': mockProjectRoot,
        agents: 'github-copilot,claude-code',
        config: '/path/to/config.toml',
        'keep-backups': true,
        verbose: true,
        'dry-run': false,
        'local-only': false,
      };

      await revertHandler(argv);

      expect(revertAllAgentConfigs).toHaveBeenCalledWith(
        mockProjectRoot,
        ['github-copilot', 'claude-code'],
        '/path/to/config.toml',
        true,
        true,
        false,
        false,
      );
    });

    it('should handle undefined agents correctly', async () => {
      const argv = {
        'project-root': mockProjectRoot,
        'keep-backups': false,
        verbose: false,
        'dry-run': false,
        'local-only': false,
      };

      await revertHandler(argv);

      expect(revertAllAgentConfigs).toHaveBeenCalledWith(
        mockProjectRoot,
        undefined,
        undefined,
        false,
        false,
        false,
        false,
      );
    });

    it('should exit with error code 1 when revertAllAgentConfigs throws', async () => {
      (revertAllAgentConfigs as jest.Mock).mockRejectedValue(mockError);

      const exitSpy = jest
        .spyOn(process, 'exit')
        .mockImplementation((code?: string | number | null | undefined) => {
          throw new Error(`process.exit: ${code}`);
        });

      const errorSpy = jest.spyOn(console, 'error').mockImplementation();

      const argv = {
        'project-root': mockProjectRoot,
        'keep-backups': false,
        verbose: false,
        'dry-run': false,
        'local-only': false,
      };

      await expect(revertHandler(argv)).rejects.toThrow('process.exit: 1');

      expect(errorSpy).toHaveBeenCalledWith('[skiller] Test error');
      expect(exitSpy).toHaveBeenCalledWith(1);

      exitSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });

  describe('migrateRulesToSkillsHandler', () => {
    it('prints a dry-run plan without executing replacements', async () => {
      const { migrateRulesToSkillsHandler } = await import(
        '../../../src/cli/handlers'
      );

      (planRulesToSkillsMigration as jest.Mock).mockResolvedValue({
        candidates: [
          {
            alreadyInstalled: false,
            matches: [
              {
                installs: 2500,
                name: 'linear',
                slug: 'schpet/linear-cli/linear',
                source: 'schpet/linear-cli',
              },
            ],
            ruleName: 'linear',
          },
        ],
        missingRequested: [],
        scannedRules: ['linear', 'custom'],
        unmatched: ['custom'],
      });

      const logSpy = jest.spyOn(console, 'log').mockImplementation();

      await migrateRulesToSkillsHandler({
        'project-root': mockProjectRoot,
        execute: false,
        yes: false,
      });

      expect(runSkillsCli).not.toHaveBeenCalled();
      expect(removeLocalRuleReplacementState).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Scanned 2 local rule(s)'),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Run again with --execute'),
      );

      logSpy.mockRestore();
    });

    it('auto-replaces unambiguous matches with --execute --yes', async () => {
      const { migrateRulesToSkillsHandler } = await import(
        '../../../src/cli/handlers'
      );

      (planRulesToSkillsMigration as jest.Mock).mockResolvedValue({
        candidates: [
          {
            alreadyInstalled: false,
            matches: [
              {
                installs: 2500,
                name: 'linear',
                slug: 'schpet/linear-cli/linear',
                source: 'schpet/linear-cli',
              },
            ],
            ruleName: 'linear',
          },
          {
            alreadyInstalled: false,
            matches: [
              {
                installs: 10,
                name: 'spec',
                slug: 'foo/bar/spec',
                source: 'foo/bar',
              },
              {
                installs: 9,
                name: 'spec',
                slug: 'zap/zorp/spec',
                source: 'zap/zorp',
              },
            ],
            ruleName: 'spec',
          },
          {
            alreadyInstalled: true,
            matches: [],
            ruleName: 'comment',
          },
        ],
        missingRequested: [],
        scannedRules: ['comment', 'linear', 'spec'],
        unmatched: [],
      });

      const logSpy = jest.spyOn(console, 'log').mockImplementation();

      await migrateRulesToSkillsHandler({
        'project-root': mockProjectRoot,
        execute: true,
        yes: true,
      });

      expect(runSkillsCli).toHaveBeenCalledTimes(1);
      expect(runSkillsCli).toHaveBeenCalledWith(mockProjectRoot, [
        'add',
        'schpet/linear-cli',
        '--agent',
        'universal',
        '--skill',
        'linear',
        '-y',
      ]);
      expect(removeLocalRuleReplacementState).toHaveBeenNthCalledWith(
        1,
        mockProjectRoot,
        'linear',
        false,
      );
      expect(removeLocalRuleReplacementState).toHaveBeenNthCalledWith(
        2,
        mockProjectRoot,
        'comment',
        false,
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "Skipping 'spec' because it has multiple exact matches.",
        ),
      );

      logSpy.mockRestore();
    });
  });
});
