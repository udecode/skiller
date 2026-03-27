import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { applyAllAgentConfigs } from '../../src/lib';
import { setupTestProject, teardownTestProject } from '../harness';

describe('Claude Plugins → Agent Skills (Integration)', () => {
  let testProject: { projectRoot: string };
  let tmpHome: string;
  const originalHome = process.env.HOME;

  beforeEach(async () => {
    testProject = await setupTestProject({
      '.claude/AGENTS.md': '# Test',
      '.claude/skiller.toml': `
default_agents = ["codex"]

[skills]
enabled = true
`,
    });

    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'skiller-home-'));
    process.env.HOME = tmpHome;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await teardownTestProject(testProject.projectRoot);
    await fs.rm(tmpHome, { recursive: true, force: true });
  });

  it('syncs plugin commands as skills into .agents/skills even when .claude/skills is missing', async () => {
    const { projectRoot } = testProject;

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

    // Plugin command
    await fs.mkdir(path.join(pluginSourcePath, 'commands'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(pluginSourcePath, 'commands', 'do-thing.md'),
      `---
description: Do the thing
---

Do something.
`,
    );

    // Plugin agent
    await fs.mkdir(path.join(pluginSourcePath, 'agents', 'research'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(
        pluginSourcePath,
        'agents',
        'research',
        'framework-docs-researcher.md',
      ),
      `---
name: framework-docs-researcher
description: Research framework docs
model: inherit
---

Find docs and summarize.
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
                projectPath: projectRoot,
                installPath: pluginCacheInstallPath,
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
    await fs.writeFile(
      path.join(projectRoot, '.claude', 'settings.json'),
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

    // Ensure .claude/skills does NOT exist
    await fs.rm(path.join(projectRoot, '.claude', 'skills'), {
      recursive: true,
      force: true,
    });

    await applyAllAgentConfigs(
      projectRoot,
      ['codex'],
      undefined,
      false, // mcp disabled
      undefined,
      false, // gitignore disabled (avoid noise)
      false,
      false,
      true, // localOnly
      false,
      false,
      true, // skills enabled
    );

    const expectedSkillDir = path.join(
      projectRoot,
      '.agents',
      'skills',
      'do-thing',
    );

    await expect(
      fs.access(path.join(expectedSkillDir, 'SKILL.md')),
    ).resolves.toBeUndefined();

    const expectedAgentDir = path.join(
      projectRoot,
      '.agents',
      'skills',
      'framework-docs-researcher',
    );
    await expect(
      fs.access(path.join(expectedAgentDir, 'SKILL.md')),
    ).resolves.toBeUndefined();
  });

  it('syncs plugin skills from the installed plugin root when marketplace discovery has no syncable content', async () => {
    const { projectRoot } = testProject;

    const pluginId = 'planning-with-files@testmarket';
    const emptyMarketplacePluginPath = path.join(
      tmpHome,
      '.claude',
      'plugins',
      'marketplaces',
      'testmarket',
      'plugins',
      'planning-with-files',
    );
    const pluginInstallPath = path.join(
      tmpHome,
      '.claude',
      'plugins',
      'cache',
      'testmarket',
      'planning-with-files',
      '2.21.0',
    );

    await fs.mkdir(emptyMarketplacePluginPath, { recursive: true });
    const pluginSkillDir = path.join(pluginInstallPath, 'skills', 'plan');
    await fs.mkdir(pluginSkillDir, { recursive: true });
    await fs.writeFile(
      path.join(pluginInstallPath, 'package.json'),
      JSON.stringify(
        {
          name: 'planning-with-files',
          owner: {
            name: 'Ahmad Othman Ammar Adi',
            url: 'https://github.com/OthmanAdi',
          },
          plugins: [
            {
              name: 'planning-with-files',
              source: './',
              description:
                'Manus-style persistent markdown files for planning, progress tracking, and knowledge storage. Now with hooks integration.',
              version: '2.21.0',
            },
          ],
        },
        null,
        2,
      ),
    );
    await fs.writeFile(
      path.join(pluginSkillDir, 'SKILL.md'),
      `---
name: plan
description: Persistent planning
---

Write plans to files.
`,
    );

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
                projectPath: projectRoot,
                installPath: pluginInstallPath,
                version: '2.21.0',
                installedAt: '2026-03-01T00:00:00.000Z',
                lastUpdated: '2026-03-02T00:00:00.000Z',
              },
            ],
          },
        },
        null,
        2,
      ),
    );

    await fs.writeFile(
      path.join(projectRoot, '.claude', 'settings.json'),
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

    await applyAllAgentConfigs(
      projectRoot,
      ['codex'],
      undefined,
      false,
      undefined,
      false,
      false,
      false,
      true,
      false,
      false,
      true,
    );

    await expect(
      fs.access(
        path.join(projectRoot, '.agents', 'skills', 'plan', 'SKILL.md'),
      ),
    ).resolves.toBeUndefined();
  });
});
