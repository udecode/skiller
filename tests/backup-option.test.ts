import * as fs from 'fs/promises';
import * as path from 'path';
import { setupTestProject, teardownTestProject, runSkiller } from './harness';

describe('backup option', () => {
  let testProject: { projectRoot: string };

  beforeEach(async () => {
    testProject = await setupTestProject({
      'AGENTS.md': '# Authored project instructions\n',
      '.agents/skiller.toml': 'default_agents = ["cline"]\n',
      '.agents/rules.md': '# Generated rule input\n',
      '.clinerules': '# Existing generated target\n',
    });
  });

  afterEach(async () => {
    await teardownTestProject(testProject.projectRoot);
  });

  it('backs up generated agent targets by default', async () => {
    runSkiller('apply', testProject.projectRoot);

    await expect(
      fs.readFile(
        path.join(testProject.projectRoot, '.clinerules.bak'),
        'utf8',
      ),
    ).resolves.toBe('# Existing generated target\n');
    await expect(
      fs.readFile(path.join(testProject.projectRoot, 'AGENTS.md'), 'utf8'),
    ).resolves.toBe('# Authored project instructions\n');
    await expect(
      fs.access(path.join(testProject.projectRoot, 'AGENTS.md.bak')),
    ).rejects.toThrow();
  });

  it('backs up generated targets with --backup', async () => {
    runSkiller('apply --backup', testProject.projectRoot);

    await expect(
      fs.readFile(
        path.join(testProject.projectRoot, '.clinerules.bak'),
        'utf8',
      ),
    ).resolves.toBe('# Existing generated target\n');
  });

  it('does not create backups with --no-backup', async () => {
    runSkiller('apply --no-backup', testProject.projectRoot);

    await expect(
      fs.access(path.join(testProject.projectRoot, '.clinerules.bak')),
    ).rejects.toThrow();
    await expect(
      fs.readFile(path.join(testProject.projectRoot, '.clinerules'), 'utf8'),
    ).resolves.toContain('# Generated rule input');

    const gitignore = await fs.readFile(
      path.join(testProject.projectRoot, '.gitignore'),
      'utf8',
    );
    expect(gitignore).toContain('/.clinerules');
    expect(gitignore).not.toContain('.clinerules.bak');
    expect(gitignore).not.toContain('/AGENTS.md');
  });
});
