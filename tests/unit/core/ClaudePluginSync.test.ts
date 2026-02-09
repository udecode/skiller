import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { parseFrontmatter } from '../../../src/core/FrontmatterParser';

describe('Claude Plugin Skill Sync', () => {
  let tmpDir: string;
  let tmpHome: string;
  const originalHome = process.env.HOME;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skiller-plugin-sync-'));
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'skiller-home-'));
    process.env.HOME = tmpHome;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.rm(tmpHome, { recursive: true, force: true });
  });

  async function writeInstalledPluginsIndex(
    pluginId: string,
    installPath: string,
  ) {
    const indexPath = path.join(
      tmpHome,
      '.claude',
      'plugins',
      'installed_plugins.json',
    );
    await fs.mkdir(path.dirname(indexPath), { recursive: true });
    await fs.writeFile(
      indexPath,
      JSON.stringify(
        {
          version: 2,
          plugins: {
            [pluginId]: [
              {
                scope: 'project',
                projectPath: tmpDir,
                installPath,
                version: '1.0.0',
                installedAt: '2026-02-01T00:00:00.000Z',
                lastUpdated: '2026-02-02T00:00:00.000Z',
                gitCommitSha: 'deadbeef',
              },
            ],
          },
        },
        null,
        2,
      ),
    );
  }

  it('syncs enabled plugin skills + commands (as skills) into target skills dirs and cleans up when disabled', async () => {
    const pluginId = 'testplugin@testmarket';
    const pluginSourcePath = path.join(
      tmpHome,
      '.claude',
      'plugins',
      'marketplaces',
      'testmarket',
      'plugins',
      'testplugin',
    );
    const pluginCacheInstallPath = path.join(
      tmpHome,
      '.claude',
      'plugins',
      'cache',
      'testmarket',
      'testplugin',
      '1.0.0',
    );
    await fs.mkdir(pluginSourcePath, { recursive: true });

    // Plugin skill
    const pluginSkillDir = path.join(pluginSourcePath, 'skills', 'a-skill');
    await fs.mkdir(pluginSkillDir, { recursive: true });
    await fs.writeFile(
      path.join(pluginSkillDir, 'SKILL.md'),
      `---
name: a-skill
description: A plugin skill
license: MIT
---

# Plugin Skill

Hello from plugin skill.
`,
    );
    await fs.writeFile(path.join(pluginSkillDir, 'helper.txt'), 'helper');

    // Plugin command (converted to skill)
    const pluginCommandsDir = path.join(pluginSourcePath, 'commands');
    await fs.mkdir(pluginCommandsDir, { recursive: true });
    await fs.writeFile(
      path.join(pluginCommandsDir, 'do-thing.md'),
      `---
allowed-tools: Bash(echo:*)
description: Do the thing
argument-hint: [FOO=bar]
---

Do something with $FOO.
`,
    );

    // Plugin agent (converted to skill)
    const pluginAgentsDir = path.join(pluginSourcePath, 'agents', 'research');
    await fs.mkdir(pluginAgentsDir, { recursive: true });
    await fs.writeFile(
      path.join(pluginAgentsDir, 'framework-docs-researcher.md'),
      `---
name: framework-docs-researcher
description: Research framework docs
model: inherit
---

Find docs and summarize.
`,
    );

    await writeInstalledPluginsIndex(pluginId, pluginCacheInstallPath);

    // Project settings enable plugin
    const projectClaudeDir = path.join(tmpDir, '.claude');
    await fs.mkdir(projectClaudeDir, { recursive: true });
    await fs.writeFile(
      path.join(projectClaudeDir, 'settings.json'),
      JSON.stringify(
        {
          enabledPlugins: {
            [pluginId]: true,
          },
        },
        null,
        2,
      ),
    );

    const targetSkillsDir = path.join(tmpDir, '.codex', 'skills');

    const { syncClaudePluginsToSkillsDirs } = await import(
      '../../../src/core/ClaudePluginSync'
    );

    await syncClaudePluginsToSkillsDirs({
      projectRoot: tmpDir,
      targetSkillsDirs: [targetSkillsDir],
      verbose: false,
      dryRun: false,
    });

    const skillName = `a-skill`;
    const cmdName = `do-thing`;
    const agentName = `framework-docs-researcher`;
    const manifestPath = path.join(tmpDir, '.claude', '.skiller.json');

    // Skill copied + name set
    const installedSkillMd = await fs.readFile(
      path.join(targetSkillsDir, skillName, 'SKILL.md'),
      'utf8',
    );
    const parsedSkill = parseFrontmatter(installedSkillMd);
    expect(parsedSkill.rawFrontmatter?.name).toBe(skillName);
    expect(parsedSkill.rawFrontmatter?.description).toBe('A plugin skill');
    expect(
      await fs.readFile(
        path.join(targetSkillsDir, skillName, 'helper.txt'),
        'utf8',
      ),
    ).toBe('helper');

    // Command converted to skill + name set + body copied
    const installedCmdMd = await fs.readFile(
      path.join(targetSkillsDir, cmdName, 'SKILL.md'),
      'utf8',
    );
    const parsedCmd = parseFrontmatter(installedCmdMd);
    expect(parsedCmd.rawFrontmatter?.name).toBe(cmdName);
    expect(parsedCmd.rawFrontmatter?.description).toBe('Do the thing');
    expect(parsedCmd.rawFrontmatter?.['allowed-tools']).toBe('Bash(echo:*)');
    expect(parsedCmd.rawFrontmatter?.['argument-hint']).toEqual(['FOO=bar']);
    expect(parsedCmd.body).toContain('Do something with $FOO.');

    // Agent converted to skill + name set + body copied
    const installedAgentMd = await fs.readFile(
      path.join(targetSkillsDir, agentName, 'SKILL.md'),
      'utf8',
    );
    const parsedAgent = parseFrontmatter(installedAgentMd);
    expect(parsedAgent.rawFrontmatter?.name).toBe(agentName);
    expect(parsedAgent.rawFrontmatter?.description).toBe(
      'Research framework docs',
    );
    expect(parsedAgent.rawFrontmatter?.model).toBe('inherit');
    expect(parsedAgent.body).toContain('Find docs and summarize.');

    // Single project-level manifest used (no per-skill marker files)
    await expect(fs.access(manifestPath)).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(targetSkillsDir, '.skiller.json')),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(targetSkillsDir, skillName, '.skiller-plugin.json')),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(targetSkillsDir, cmdName, '.skiller-plugin.json')),
    ).rejects.toThrow();

    // Disable plugin and re-sync: should cleanup managed folders
    await fs.writeFile(
      path.join(projectClaudeDir, 'settings.json'),
      JSON.stringify(
        {
          enabledPlugins: {
            [pluginId]: false,
          },
        },
        null,
        2,
      ),
    );

    await syncClaudePluginsToSkillsDirs({
      projectRoot: tmpDir,
      targetSkillsDirs: [targetSkillsDir],
      verbose: false,
      dryRun: false,
    });

    await expect(
      fs.access(path.join(targetSkillsDir, skillName)),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(targetSkillsDir, cmdName)),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(targetSkillsDir, agentName)),
    ).rejects.toThrow();
  });

  it('discovers nested plugin skills recursively and flattens them to dash-separated names', async () => {
    const pluginId = 'testplugin@testmarket';
    const pluginSourcePath = path.join(
      tmpHome,
      '.claude',
      'plugins',
      'marketplaces',
      'testmarket',
      'plugins',
      'testplugin',
    );
    const pluginCacheInstallPath = path.join(
      tmpHome,
      '.claude',
      'plugins',
      'cache',
      'testmarket',
      'testplugin',
      '1.0.0',
    );
    await fs.mkdir(pluginSourcePath, { recursive: true });

    // Nested plugin skill: skills/workflows/lfg
    const nestedSkillDir = path.join(
      pluginSourcePath,
      'skills',
      'workflows',
      'lfg',
    );
    await fs.mkdir(nestedSkillDir, { recursive: true });
    await fs.writeFile(
      path.join(nestedSkillDir, 'SKILL.md'),
      `---
name: lfg
description: Nested plugin skill
---

Hello from nested plugin skill.
`,
    );
    await fs.writeFile(path.join(nestedSkillDir, 'helper.txt'), 'helper');

    await writeInstalledPluginsIndex(pluginId, pluginCacheInstallPath);

    // Project settings enable plugin
    const projectClaudeDir = path.join(tmpDir, '.claude');
    await fs.mkdir(projectClaudeDir, { recursive: true });
    await fs.writeFile(
      path.join(projectClaudeDir, 'settings.json'),
      JSON.stringify(
        {
          enabledPlugins: {
            [pluginId]: true,
          },
        },
        null,
        2,
      ),
    );

    const targetSkillsDir = path.join(tmpDir, '.codex', 'skills');
    const { syncClaudePluginsToSkillsDirs } = await import(
      '../../../src/core/ClaudePluginSync'
    );

    await syncClaudePluginsToSkillsDirs({
      projectRoot: tmpDir,
      targetSkillsDirs: [targetSkillsDir],
      verbose: false,
      dryRun: false,
    });

    const expectedDir = path.join(targetSkillsDir, 'workflows-lfg');
    const installedSkillMd = await fs.readFile(
      path.join(expectedDir, 'SKILL.md'),
      'utf8',
    );
    expect(parseFrontmatter(installedSkillMd).rawFrontmatter?.name).toBe(
      'workflows-lfg',
    );
    expect(
      await fs.readFile(path.join(expectedDir, 'helper.txt'), 'utf8'),
    ).toBe('helper');

    await expect(
      fs.access(path.join(targetSkillsDir, 'workflows__lfg')),
    ).rejects.toThrow();
  });

  it('discovers nested plugin commands recursively and flattens them to dash-separated names', async () => {
    const pluginId = 'testplugin@testmarket';
    const pluginSourcePath = path.join(
      tmpHome,
      '.claude',
      'plugins',
      'marketplaces',
      'testmarket',
      'plugins',
      'testplugin',
    );
    const pluginCacheInstallPath = path.join(
      tmpHome,
      '.claude',
      'plugins',
      'cache',
      'testmarket',
      'testplugin',
      '1.0.0',
    );
    await fs.mkdir(pluginSourcePath, { recursive: true });

    // Nested plugin command: commands/workflows/brainstorm.md
    const nestedCommandDir = path.join(
      pluginSourcePath,
      'commands',
      'workflows',
    );
    await fs.mkdir(nestedCommandDir, { recursive: true });
    await fs.writeFile(
      path.join(nestedCommandDir, 'brainstorm.md'),
      `---
description: Brainstorm
---

From nested plugin command.
`,
    );

    await writeInstalledPluginsIndex(pluginId, pluginCacheInstallPath);

    // Project settings enable plugin
    const projectClaudeDir = path.join(tmpDir, '.claude');
    await fs.mkdir(projectClaudeDir, { recursive: true });
    await fs.writeFile(
      path.join(projectClaudeDir, 'settings.json'),
      JSON.stringify(
        {
          enabledPlugins: {
            [pluginId]: true,
          },
        },
        null,
        2,
      ),
    );

    const targetSkillsDir = path.join(tmpDir, '.codex', 'skills');
    const { syncClaudePluginsToSkillsDirs } = await import(
      '../../../src/core/ClaudePluginSync'
    );

    await syncClaudePluginsToSkillsDirs({
      projectRoot: tmpDir,
      targetSkillsDirs: [targetSkillsDir],
      verbose: false,
      dryRun: false,
    });

    const expectedDir = path.join(targetSkillsDir, 'workflows-brainstorm');
    const installedMd = await fs.readFile(
      path.join(expectedDir, 'SKILL.md'),
      'utf8',
    );
    expect(parseFrontmatter(installedMd).rawFrontmatter?.name).toBe(
      'workflows-brainstorm',
    );
    expect(parseFrontmatter(installedMd).body).toContain(
      'From nested plugin command.',
    );

    await expect(
      fs.access(path.join(targetSkillsDir, 'brainstorm')),
    ).rejects.toThrow();
  });

  it('namespaces plugin items only when they conflict with an existing (local) skill', async () => {
    const pluginId = 'testplugin@testmarket';
    const pluginSourcePath = path.join(
      tmpHome,
      '.claude',
      'plugins',
      'marketplaces',
      'testmarket',
      'plugins',
      'testplugin',
    );
    const pluginCacheInstallPath = path.join(
      tmpHome,
      '.claude',
      'plugins',
      'cache',
      'testmarket',
      'testplugin',
      '1.0.0',
    );
    await fs.mkdir(pluginSourcePath, { recursive: true });

    // Plugin command (converted to skill)
    const pluginCommandsDir = path.join(pluginSourcePath, 'commands');
    await fs.mkdir(pluginCommandsDir, { recursive: true });
    await fs.writeFile(
      path.join(pluginCommandsDir, 'do-thing.md'),
      `---
description: Do the thing
---

Do something.
`,
    );

    await writeInstalledPluginsIndex(pluginId, pluginCacheInstallPath);

    // Project settings enable plugin
    const projectClaudeDir = path.join(tmpDir, '.claude');
    await fs.mkdir(projectClaudeDir, { recursive: true });
    await fs.writeFile(
      path.join(projectClaudeDir, 'settings.json'),
      JSON.stringify(
        {
          enabledPlugins: {
            [pluginId]: true,
          },
        },
        null,
        2,
      ),
    );

    const targetSkillsDir = path.join(tmpDir, '.codex', 'skills');

    // Simulate an existing local skill already occupying the name.
    const localSkillDir = path.join(targetSkillsDir, 'do-thing');
    await fs.mkdir(localSkillDir, { recursive: true });
    await fs.writeFile(
      path.join(localSkillDir, 'SKILL.md'),
      `---
name: do-thing
description: Local skill wins
---

Local content.
`,
    );

    const { syncClaudePluginsToSkillsDirs } = await import(
      '../../../src/core/ClaudePluginSync'
    );

    await syncClaudePluginsToSkillsDirs({
      projectRoot: tmpDir,
      targetSkillsDirs: [targetSkillsDir],
      verbose: false,
      dryRun: false,
    });

    // Local skill remains unchanged
    const localSkillMd = await fs.readFile(
      path.join(localSkillDir, 'SKILL.md'),
      'utf8',
    );
    expect(parseFrontmatter(localSkillMd).body).toContain('Local content.');

    // Plugin command is installed under a namespaced folder instead
    const pluginDir = path.join(
      targetSkillsDir,
      'testplugin-do-thing',
    );
    await expect(
      fs.access(path.join(pluginDir, 'SKILL.md')),
    ).resolves.toBeUndefined();
    const pluginSkillMd = await fs.readFile(
      path.join(pluginDir, 'SKILL.md'),
      'utf8',
    );
    expect(parseFrontmatter(pluginSkillMd).rawFrontmatter?.name).toBe(
      'testplugin-do-thing',
    );
  });

  it('treats nested local .claude/skills as flattened names when reserving against plugin items', async () => {
    const pluginId = 'testplugin@testmarket';
    const pluginSourcePath = path.join(
      tmpHome,
      '.claude',
      'plugins',
      'marketplaces',
      'testmarket',
      'plugins',
      'testplugin',
    );
    const pluginCacheInstallPath = path.join(
      tmpHome,
      '.claude',
      'plugins',
      'cache',
      'testmarket',
      'testplugin',
      '1.0.0',
    );
    await fs.mkdir(pluginSourcePath, { recursive: true });

    // Plugin commands (converted to skills)
    await fs.mkdir(path.join(pluginSourcePath, 'commands'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(pluginSourcePath, 'commands', 'lfg.md'),
      `---
description: LFG
---

From plugin lfg.
`,
    );
    await fs.writeFile(
      path.join(pluginSourcePath, 'commands', 'workflows-lfg.md'),
      `---
description: Workflows LFG
---

From plugin workflows-lfg.
`,
    );

    await writeInstalledPluginsIndex(pluginId, pluginCacheInstallPath);

    // Enable plugin in project .claude/settings.json
    const projectClaudeDir = path.join(tmpDir, '.claude');
    await fs.mkdir(projectClaudeDir, { recursive: true });
    await fs.writeFile(
      path.join(projectClaudeDir, 'settings.json'),
      JSON.stringify(
        {
          enabledPlugins: {
            [pluginId]: true,
          },
        },
        null,
        2,
      ),
    );

    // Nested local skill: .claude/skills/workflows/lfg (copies to workflows-lfg)
    const localSkillDir = path.join(
      tmpDir,
      '.claude',
      'skills',
      'workflows',
      'lfg',
    );
    await fs.mkdir(localSkillDir, { recursive: true });
    await fs.writeFile(
      path.join(localSkillDir, 'SKILL.md'),
      `---
name: lfg
description: Local nested skill
---

Local nested content.
`,
    );

    const targetSkillsDir = path.join(tmpDir, '.codex', 'skills');
    const { syncClaudePluginsToSkillsDirs } = await import(
      '../../../src/core/ClaudePluginSync'
    );

    await syncClaudePluginsToSkillsDirs({
      projectRoot: tmpDir,
      targetSkillsDirs: [targetSkillsDir],
      verbose: false,
      dryRun: false,
    });

    // Plugin 'lfg' can use its base name (no conflict with workflows-lfg)
    await expect(
      fs.access(path.join(targetSkillsDir, 'lfg', 'SKILL.md')),
    ).resolves.toBeUndefined();

    // Plugin 'workflows-lfg' conflicts with local nested (flattened) name, so it must be namespaced
    await expect(
      fs.access(
        path.join(targetSkillsDir, 'testplugin-workflows-lfg', 'SKILL.md'),
      ),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(targetSkillsDir, 'workflows-lfg')),
    ).rejects.toThrow();
  });

  it('does not include marketplace id in namespaced plugin folder names (uses numeric suffix on plugin name conflicts)', async () => {
    const pluginId1 = 'compound-engineering@every-marketplace';
    const pluginId2 = 'compound-engineering@other-marketplace';

    const pluginSourcePath1 = path.join(
      tmpHome,
      '.claude',
      'plugins',
      'marketplaces',
      'every-marketplace',
      'plugins',
      'compound-engineering',
    );
    const pluginSourcePath2 = path.join(
      tmpHome,
      '.claude',
      'plugins',
      'marketplaces',
      'other-marketplace',
      'plugins',
      'compound-engineering',
    );

    await fs.mkdir(path.join(pluginSourcePath1, 'commands'), { recursive: true });
    await fs.mkdir(path.join(pluginSourcePath2, 'commands'), { recursive: true });

    await fs.writeFile(
      path.join(pluginSourcePath1, 'commands', 'lfg.md'),
      `---
description: LFG
---

From plugin 1.
`,
    );
    await fs.writeFile(
      path.join(pluginSourcePath2, 'commands', 'lfg.md'),
      `---
description: LFG
---

From plugin 2.
`,
    );

    // Enable both plugins in project .claude/settings.json
    const projectClaudeDir = path.join(tmpDir, '.claude');
    await fs.mkdir(projectClaudeDir, { recursive: true });
    await fs.writeFile(
      path.join(projectClaudeDir, 'settings.json'),
      JSON.stringify(
        {
          enabledPlugins: {
            [pluginId1]: true,
            [pluginId2]: true,
          },
        },
        null,
        2,
      ),
    );

    const targetSkillsDir = path.join(tmpDir, '.codex', 'skills');

    // Reserve base name so both plugins must use a namespaced folder.
    await fs.mkdir(path.join(targetSkillsDir, 'lfg'), { recursive: true });
    await fs.writeFile(
      path.join(targetSkillsDir, 'lfg', 'SKILL.md'),
      `---
name: lfg
description: Manual wins
---

Manual content.
`,
    );

    const { syncClaudePluginsToSkillsDirs } = await import(
      '../../../src/core/ClaudePluginSync'
    );

    await syncClaudePluginsToSkillsDirs({
      projectRoot: tmpDir,
      targetSkillsDirs: [targetSkillsDir],
      verbose: false,
      dryRun: false,
    });

    await expect(
      fs.access(path.join(targetSkillsDir, 'compound-engineering-lfg', 'SKILL.md')),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(
        path.join(targetSkillsDir, 'compound-engineering-2-lfg', 'SKILL.md'),
      ),
    ).resolves.toBeUndefined();

    await expect(
      fs.access(
        path.join(
          targetSkillsDir,
          'compound-engineering_every-marketplace-lfg',
          'SKILL.md',
        ),
      ),
    ).rejects.toThrow();
  });

  it('falls back to any installed plugin entry when no entry matches the current project root', async () => {
    const pluginId = 'lsp-servers@claude-lsp-servers';
    const otherProjectRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'skiller-other-project-'),
    );

    try {
      const index = {
        version: 2,
        plugins: {
          [pluginId]: [
            {
              scope: 'project',
              projectPath: otherProjectRoot,
              installPath: path.join(
                tmpHome,
                '.claude',
                'plugins',
                'cache',
                'claude-lsp-servers',
                'lsp-servers',
                '1.0.0',
              ),
              version: '1.0.0',
              installedAt: '2026-02-01T00:00:00.000Z',
              lastUpdated: '2026-02-02T00:00:00.000Z',
            },
          ],
        },
      } as any;

      const { resolvePluginInstall } = await import(
        '../../../src/core/ClaudePluginSync'
      );

      const resolved = resolvePluginInstall(pluginId, tmpDir, index);
      expect(resolved).not.toBeNull();
    } finally {
      await fs.rm(otherProjectRoot, { recursive: true, force: true });
    }
  });
});
