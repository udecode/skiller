import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { parseFrontmatter } from '../../../src/core/FrontmatterParser';

describe('Claude Project Commands/Agents → Skills Sync', () => {
  let tmpDir: string;
  let tmpHome: string;
  const originalHome = process.env.HOME;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skiller-claude-sync-'));
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'skiller-home-'));
    process.env.HOME = tmpHome;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.rm(tmpHome, { recursive: true, force: true });
  });

  it('syncs project .claude/commands + .claude/agents as skills into target skills dirs and cleans up when removed', async () => {
    const projectClaudeDir = path.join(tmpDir, '.claude');
    await fs.mkdir(path.join(projectClaudeDir, 'commands'), {
      recursive: true,
    });
    await fs.mkdir(path.join(projectClaudeDir, 'agents'), { recursive: true });

    await fs.writeFile(
      path.join(projectClaudeDir, 'commands', 'do-thing.md'),
      `---
description: Do the thing
argument-hint: [FOO=bar]
---

Do something with $FOO.
`,
    );

    await fs.writeFile(
      path.join(projectClaudeDir, 'agents', 'framework-docs-researcher.md'),
      `---
name: framework-docs-researcher
description: Research framework docs
model: inherit
---

Find docs and summarize.
`,
    );

    const targetSkillsDir = path.join(tmpDir, '.codex', 'skills');

    const { syncClaudeProjectCommandsAndAgentsToSkillsDirs } = await import(
      '../../../src/core/ClaudeProjectSync'
    );

    await syncClaudeProjectCommandsAndAgentsToSkillsDirs({
      projectRoot: tmpDir,
      targetSkillsDirs: [targetSkillsDir],
      verbose: false,
      dryRun: false,
    });

    const cmdSkillMd = await fs.readFile(
      path.join(targetSkillsDir, 'do-thing', 'SKILL.md'),
      'utf8',
    );
    const parsedCmd = parseFrontmatter(cmdSkillMd);
    expect(parsedCmd.rawFrontmatter?.name).toBe('do-thing');
    expect(parsedCmd.rawFrontmatter?.description).toBe('Do the thing');
    expect(parsedCmd.rawFrontmatter?.['argument-hint']).toEqual(['FOO=bar']);
    expect(parsedCmd.body).toContain('Do something with $FOO.');

    const agentSkillMd = await fs.readFile(
      path.join(targetSkillsDir, 'framework-docs-researcher', 'SKILL.md'),
      'utf8',
    );
    const parsedAgent = parseFrontmatter(agentSkillMd);
    expect(parsedAgent.rawFrontmatter?.name).toBe('framework-docs-researcher');
    expect(parsedAgent.rawFrontmatter?.description).toBe(
      'Research framework docs',
    );
    expect(parsedAgent.rawFrontmatter?.model).toBe('inherit');
    expect(parsedAgent.body).toContain('Find docs and summarize.');

    await expect(
      fs.access(path.join(targetSkillsDir, '.skiller.json')),
    ).resolves.toBeUndefined();

    // Remove command and re-sync: should cleanup managed folder
    await fs.rm(path.join(projectClaudeDir, 'commands', 'do-thing.md'));

    await syncClaudeProjectCommandsAndAgentsToSkillsDirs({
      projectRoot: tmpDir,
      targetSkillsDirs: [targetSkillsDir],
      verbose: false,
      dryRun: false,
    });

    await expect(
      fs.access(path.join(targetSkillsDir, 'do-thing')),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(targetSkillsDir, 'framework-docs-researcher')),
    ).resolves.toBeUndefined();
  });

  it('namespaces project items only when they conflict with an existing (manual) skill', async () => {
    const projectClaudeDir = path.join(tmpDir, '.claude');
    await fs.mkdir(path.join(projectClaudeDir, 'commands'), {
      recursive: true,
    });

    await fs.writeFile(
      path.join(projectClaudeDir, 'commands', 'do-thing.md'),
      `---
description: Do the thing
---

Do something.
`,
    );

    const targetSkillsDir = path.join(tmpDir, '.codex', 'skills');

    // Simulate an existing manual skill already occupying the name.
    const manualDir = path.join(targetSkillsDir, 'do-thing');
    await fs.mkdir(manualDir, { recursive: true });
    await fs.writeFile(
      path.join(manualDir, 'SKILL.md'),
      `---
name: do-thing
description: Manual skill wins
---

Manual content.
`,
    );

    const { syncClaudeProjectCommandsAndAgentsToSkillsDirs } = await import(
      '../../../src/core/ClaudeProjectSync'
    );

    await syncClaudeProjectCommandsAndAgentsToSkillsDirs({
      projectRoot: tmpDir,
      targetSkillsDirs: [targetSkillsDir],
      verbose: false,
      dryRun: false,
    });

    // Manual skill remains unchanged
    const manualSkillMd = await fs.readFile(
      path.join(manualDir, 'SKILL.md'),
      'utf8',
    );
    expect(parseFrontmatter(manualSkillMd).body).toContain('Manual content.');

    // Project command is installed under a namespaced folder instead
    const projectDir = path.join(targetSkillsDir, 'claude-do-thing');
    await expect(
      fs.access(path.join(projectDir, 'SKILL.md')),
    ).resolves.toBeUndefined();
    const projectSkillMd = await fs.readFile(
      path.join(projectDir, 'SKILL.md'),
      'utf8',
    );
    expect(parseFrontmatter(projectSkillMd).rawFrontmatter?.name).toBe(
      'claude-do-thing',
    );
  });

  it('project commands can take over a previously plugin-managed name (plugin moves to namespaced on next sync)', async () => {
    const pluginId = 'testplugin@testmarket';
    const pluginInstallPath = path.join(tmpHome, 'plugin-cache', 'testplugin');
    await fs.mkdir(pluginInstallPath, { recursive: true });

    // Plugin command (converted to skill)
    await fs.mkdir(path.join(pluginInstallPath, 'commands'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(pluginInstallPath, 'commands', 'do-thing.md'),
      `---
description: Plugin wins first
---

From plugin.
`,
    );

    // Write installed_plugins.json for this project
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
                installPath: pluginInstallPath,
                version: '1.0.0',
                installedAt: '2026-02-01T00:00:00.000Z',
                lastUpdated: '2026-02-02T00:00:00.000Z',
              },
            ],
          },
        },
        null,
        2,
      ),
    );

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

    const targetSkillsDir = path.join(tmpDir, '.codex', 'skills');

    const { syncClaudeProjectCommandsAndAgentsToSkillsDirs } = await import(
      '../../../src/core/ClaudeProjectSync'
    );
    const { syncClaudePluginsToSkillsDirs } = await import(
      '../../../src/core/ClaudePluginSync'
    );

    // First run: plugin installs do-thing
    await syncClaudeProjectCommandsAndAgentsToSkillsDirs({
      projectRoot: tmpDir,
      targetSkillsDirs: [targetSkillsDir],
      verbose: false,
      dryRun: false,
    });
    await syncClaudePluginsToSkillsDirs({
      projectRoot: tmpDir,
      targetSkillsDirs: [targetSkillsDir],
      verbose: false,
      dryRun: false,
    });

    const firstInstalled = await fs.readFile(
      path.join(targetSkillsDir, 'do-thing', 'SKILL.md'),
      'utf8',
    );
    expect(parseFrontmatter(firstInstalled).body).toContain('From plugin.');

    // Add project command with same name; should take over do-thing
    await fs.mkdir(path.join(projectClaudeDir, 'commands'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(projectClaudeDir, 'commands', 'do-thing.md'),
      `---
description: Project takes over
---

From project.
`,
    );

    // Second run: project takes do-thing, plugin is moved to namespaced
    await syncClaudeProjectCommandsAndAgentsToSkillsDirs({
      projectRoot: tmpDir,
      targetSkillsDirs: [targetSkillsDir],
      verbose: false,
      dryRun: false,
    });
    await syncClaudePluginsToSkillsDirs({
      projectRoot: tmpDir,
      targetSkillsDirs: [targetSkillsDir],
      verbose: false,
      dryRun: false,
    });

    const projectInstalled = await fs.readFile(
      path.join(targetSkillsDir, 'do-thing', 'SKILL.md'),
      'utf8',
    );
    expect(parseFrontmatter(projectInstalled).body).toContain('From project.');

    await expect(
      fs.access(
        path.join(
          targetSkillsDir,
          'testplugin_testmarket-do-thing',
          'SKILL.md',
        ),
      ),
    ).resolves.toBeUndefined();
  });
});
