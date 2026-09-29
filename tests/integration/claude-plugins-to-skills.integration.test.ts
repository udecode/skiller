import * as fs from 'fs/promises';
import * as path from 'path';
import { applyAllAgentConfigs } from '../../src/lib';
import { setupTestProject, teardownTestProject } from '../harness';

describe('Claude plugin state (Integration)', () => {
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

  it('keeps Claude plugins the project enables natively', async () => {
    const settings = {
      enabledPlugins: {
        'compound-engineering@every-marketplace': true,
      },
      extraKnownMarketplaces: {
        'every-marketplace': {
          source: { source: 'github', repo: 'every/marketplace', ref: 'v1' },
        },
      },
    };
    const settingsPath = path.join(
      testProject.projectRoot,
      '.claude',
      'settings.json',
    );
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));

    await applyAllAgentConfigs(
      testProject.projectRoot,
      ['codex', 'claude-code'],
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

    const written = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
    expect(written.enabledPlugins).toEqual(settings.enabledPlugins);
    expect(written.extraKnownMarketplaces).toEqual(
      settings.extraKnownMarketplaces,
    );
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
