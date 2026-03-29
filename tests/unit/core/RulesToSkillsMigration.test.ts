import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  buildRulesReplacementInstallArgs,
  planRulesToSkillsMigration,
  removeLocalRuleReplacementState,
} from '../../../src/core/RulesToSkillsMigration';

describe('RulesToSkillsMigration', () => {
  let tmpDir: string;
  const originalFetch = global.fetch;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skiller-rules-migrate-'));
    await fs.mkdir(path.join(tmpDir, '.agents', 'rules'), { recursive: true });
    global.fetch = jest.fn();
  });

  afterEach(async () => {
    global.fetch = originalFetch;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('scans all local rules by default and returns exact registry matches sorted by installs', async () => {
    await fs.writeFile(path.join(tmpDir, '.agents', 'rules', 'linear.mdc'), '');
    await fs.writeFile(
      path.join(tmpDir, '.agents', 'rules', 'google-forms.mdc'),
      '',
    );
    await fs.writeFile(path.join(tmpDir, '.agents', 'rules', 'custom.mdc'), '');
    await fs.writeFile(
      path.join(tmpDir, 'skills-lock.json'),
      JSON.stringify(
        {
          skills: {
            'google-forms': { source: 'skills' },
          },
        },
        null,
        2,
      ),
    );

    (global.fetch as jest.Mock).mockImplementation(async (input: string) => {
      const url = new URL(input);
      const query = url.searchParams.get('q');

      if (query === 'linear') {
        return {
          ok: true,
          json: async () => ({
            skills: [
              {
                name: 'linear',
                id: 'foo/bar/linear',
                source: 'foo/bar',
                installs: 12,
              },
              {
                name: 'linear',
                id: 'zap/zorp/linear',
                source: 'zap/zorp',
                installs: 420,
              },
              {
                name: 'linear-helper',
                id: 'zap/zorp/linear-helper',
                source: 'zap/zorp',
                installs: 999,
              },
            ],
          }),
        };
      }

      if (query === 'google-forms') {
        return {
          ok: true,
          json: async () => ({
            skills: [
              {
                name: 'google-forms',
                id: 'acme/forms/google-forms',
                source: 'acme/forms',
                installs: 50,
              },
            ],
          }),
        };
      }

      return {
        ok: true,
        json: async () => ({ skills: [] }),
      };
    });

    const plan = await planRulesToSkillsMigration(tmpDir);

    expect(plan.scannedRules).toEqual(['custom', 'google-forms', 'linear']);
    expect(plan.unmatched).toEqual(['custom']);
    expect(plan.missingRequested).toEqual([]);
    expect(plan.candidates).toEqual([
      {
        alreadyInstalled: true,
        matches: [
          {
            installs: 50,
            name: 'google-forms',
            slug: 'acme/forms/google-forms',
            source: 'acme/forms',
          },
        ],
        ruleName: 'google-forms',
      },
      {
        alreadyInstalled: false,
        matches: [
          {
            installs: 420,
            name: 'linear',
            slug: 'zap/zorp/linear',
            source: 'zap/zorp',
          },
          {
            installs: 12,
            name: 'linear',
            slug: 'foo/bar/linear',
            source: 'foo/bar',
          },
        ],
        ruleName: 'linear',
      },
    ]);
  });

  it('filters to requested rule names and reports missing entries', async () => {
    await fs.writeFile(path.join(tmpDir, '.agents', 'rules', 'linear.mdc'), '');

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        skills: [
          {
            name: 'linear',
            id: 'foo/bar/linear',
            source: 'foo/bar',
            installs: 10,
          },
        ],
      }),
    });

    const plan = await planRulesToSkillsMigration(tmpDir, [
      'linear.mdc',
      'missing',
    ]);

    expect(plan.scannedRules).toEqual(['linear']);
    expect(plan.missingRequested).toEqual(['missing']);
    expect(plan.candidates).toHaveLength(1);
    expect(plan.candidates[0].ruleName).toBe('linear');
  });

  it('removes local rule state and builds install args', async () => {
    await fs.writeFile(path.join(tmpDir, '.agents', 'rules', 'linear.mdc'), '');
    await fs.writeFile(
      path.join(tmpDir, '.agents', '.skiller.json'),
      JSON.stringify(
        {
          version: 1,
          targets: {},
          localSkills: ['linear', 'other'],
        },
        null,
        2,
      ),
    );

    await removeLocalRuleReplacementState(tmpDir, 'linear', false);

    await expect(
      fs.access(path.join(tmpDir, '.agents', 'rules', 'linear.mdc')),
    ).rejects.toThrow();

    await expect(
      fs.access(path.join(tmpDir, '.agents', '.skiller.json')),
    ).rejects.toThrow();

    expect(
      buildRulesReplacementInstallArgs({
        installs: 12,
        name: 'linear',
        slug: 'foo/bar/linear',
        source: 'foo/bar',
      }),
    ).toEqual([
      'add',
      'foo/bar',
      '--agent',
      'universal',
      '--skill',
      'linear',
      '-y',
    ]);
  });
});
