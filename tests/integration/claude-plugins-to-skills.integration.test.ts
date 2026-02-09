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

  it('syncs plugin commands as skills into .codex/skills even when .claude/skills is missing', async () => {
    const { projectRoot } = testProject;

    const pluginId = 'testplugin@testmarket';
    const pluginInstallPath = path.join(tmpHome, 'plugin-cache', 'testplugin');

    // Plugin command
    await fs.mkdir(path.join(pluginInstallPath, 'commands'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(pluginInstallPath, 'commands', 'do-thing.md'),
      `---
description: Do the thing
---

Do something.
`,
    );

    // Plugin agent
    await fs.mkdir(path.join(pluginInstallPath, 'agents', 'research'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(
        pluginInstallPath,
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
      '.codex',
      'skills',
      'do-thing',
    );

    await expect(
      fs.access(path.join(expectedSkillDir, 'SKILL.md')),
    ).resolves.toBeUndefined();

    const expectedAgentDir = path.join(
      projectRoot,
      '.codex',
      'skills',
      'framework-docs-researcher',
    );
    await expect(
      fs.access(path.join(expectedAgentDir, 'SKILL.md')),
    ).resolves.toBeUndefined();
  });
});
