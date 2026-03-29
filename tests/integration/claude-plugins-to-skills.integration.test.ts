import * as fs from 'fs/promises';
import * as path from 'path';
import { applyAllAgentConfigs } from '../../src/lib';
import { setupTestProject, teardownTestProject } from '../harness';

describe('Legacy Claude plugin rejection (Integration)', () => {
  let testProject: { projectRoot: string };

  beforeEach(async () => {
    testProject = await setupTestProject({
      '.agents/AGENTS.md': '# Test',
      '.agents/skiller.toml': `
default_agents = ["codex"]

[skills]
enabled = true
`,
    });
  });

  afterEach(async () => {
    await teardownTestProject(testProject.projectRoot);
  });

  async function expectApplyToRejectWithMigrationGuidance(): Promise<void> {
    await expect(
      applyAllAgentConfigs(
        testProject.projectRoot,
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
      ),
    ).rejects.toThrow('Claude plugin sync is no longer supported');

    await expect(
      applyAllAgentConfigs(
        testProject.projectRoot,
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
      ),
    ).rejects.toThrow('skiller migrate claude-plugins');
  }

  it('rejects enabled Claude plugins in .claude/settings.json', async () => {
    await fs.mkdir(path.join(testProject.projectRoot, '.claude'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(testProject.projectRoot, '.claude', 'settings.json'),
      JSON.stringify(
        {
          enabledPlugins: {
            'compound-engineering@every-marketplace': true,
          },
        },
        null,
        2,
      ),
    );

    await expectApplyToRejectWithMigrationGuidance();
  });

  it('rejects canonical plugin manifest entries in .agents/.skiller.json', async () => {
    await fs.writeFile(
      path.join(testProject.projectRoot, '.agents', '.skiller.json'),
      JSON.stringify(
        {
          version: 1,
          targets: {
            '.agents/skills': [
              {
                sourceType: 'plugin',
                pluginId: 'compound-engineering@every-marketplace',
                sourceKind: 'skill',
                sourceRelPath: 'skills/ce-work',
                destRelPath: 'compound-engineering-ce-work',
              },
            ],
          },
          localSkills: [],
        },
        null,
        2,
      ),
    );

    await expectApplyToRejectWithMigrationGuidance();
  });

  it('rejects legacy plugin manifest entries in .claude/.skiller.json', async () => {
    await fs.mkdir(path.join(testProject.projectRoot, '.claude'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(testProject.projectRoot, '.claude', '.skiller.json'),
      JSON.stringify(
        {
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
            ],
          },
        },
        null,
        2,
      ),
    );

    await expectApplyToRejectWithMigrationGuidance();
  });
});
