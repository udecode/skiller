import * as fs from 'fs/promises';
import * as path from 'path';
import { applyAllAgentConfigs } from '../../src/lib';
import * as Constants from '../../src/constants';
import { setupTestProject, teardownTestProject } from '../harness';

describe('Nested Rules Integration', () => {
  let projectRoot: string;

  beforeEach(async () => {
    ({ projectRoot } = await setupTestProject());
  });

  afterEach(async () => {
    await teardownTestProject(projectRoot);
  });

  it('processes each .agents directory independently in nested mode', async () => {
    const moduleDir = path.join(projectRoot, 'module');
    const submoduleDir = path.join(moduleDir, 'submodule');

    for (const baseDir of [projectRoot, moduleDir, submoduleDir]) {
      await fs.mkdir(path.join(baseDir, '.agents'), { recursive: true });
      await fs.writeFile(
        path.join(baseDir, '.agents', 'skiller.toml'),
        'default_agents = ["cline"]\n',
      );
    }
    await fs.appendFile(
      path.join(projectRoot, '.agents', 'skiller.toml'),
      'nested = true\n',
    );
    await fs.appendFile(
      path.join(submoduleDir, '.agents', 'skiller.toml'),
      'nested = false\n',
    );

    await fs.writeFile(path.join(projectRoot, 'AGENTS.md'), '# Root Rules\n');
    await fs.writeFile(path.join(moduleDir, 'AGENTS.md'), '# Module Rules\n');
    await fs.writeFile(
      path.join(submoduleDir, 'AGENTS.md'),
      '# Submodule Rules\n',
    );

    const warnSpy = jest
      .spyOn(Constants, 'logWarn')
      .mockImplementation(() => {});
    try {
      await applyAllAgentConfigs(
        projectRoot,
        ['cline'],
        undefined,
        true,
        undefined,
        undefined,
        false,
        false,
        false,
        true,
      );

      expect(
        warnSpy.mock.calls.filter((call) =>
          String(call[0]).includes('Nested mode is experimental'),
        ),
      ).toHaveLength(1);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          path.join(submoduleDir, '.agents', 'skiller.toml'),
        ),
      );
    } finally {
      warnSpy.mockRestore();
    }

    const targets = [
      [path.join(projectRoot, '.clinerules'), 'Root Rules'],
      [path.join(moduleDir, '.clinerules'), 'Module Rules'],
      [path.join(submoduleDir, '.clinerules'), 'Submodule Rules'],
    ] as const;
    for (const [target, expected] of targets) {
      await expect(fs.readFile(target, 'utf8')).resolves.toContain(expected);
    }
  });

  it('falls back to single-directory behavior when nested=false', async () => {
    const moduleDir = path.join(projectRoot, 'module');
    await fs.mkdir(path.join(moduleDir, '.agents'), { recursive: true });
    await fs.writeFile(path.join(moduleDir, '.agents', 'skiller.toml'), '');
    await fs.writeFile(path.join(moduleDir, 'AGENTS.md'), '# Module Rules\n');

    const warnSpy = jest
      .spyOn(Constants, 'logWarn')
      .mockImplementation(() => {});
    try {
      await applyAllAgentConfigs(
        moduleDir,
        ['cline'],
        undefined,
        true,
        undefined,
        undefined,
        false,
        false,
        false,
        false,
      );
      expect(
        warnSpy.mock.calls.some((call) =>
          String(call[0]).includes('Nested mode is experimental'),
        ),
      ).toBe(false);
    } finally {
      warnSpy.mockRestore();
    }

    await expect(
      fs.readFile(path.join(moduleDir, '.clinerules'), 'utf8'),
    ).resolves.toContain('Module Rules');
  });
});
