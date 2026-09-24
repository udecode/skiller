import * as fs from 'fs/promises';
import * as path from 'path';
import {
  setupTestProject,
  teardownTestProject,
  runSkillerWithInheritedStdio,
} from '../harness';

describe('End-to-End Skiller CLI', () => {
  let testProject: { projectRoot: string };

  beforeEach(async () => {
    testProject = await setupTestProject({
      'AGENTS.md': '# Authored project instructions\n\nRule A\n',
      '.agents/extra.md': '# Supplemental rules\n\nRule B\n',
      '.agents/skiller.toml': '',
      '.agents/mcp.json': JSON.stringify({
        mcpServers: { example: { command: 'uvx', args: ['mcp-example'] } },
      }),
    });
  });

  afterEach(async () => {
    await teardownTestProject(testProject.projectRoot);
  });

  it('applies current agents without rewriting root instructions', async () => {
    const { projectRoot } = testProject;

    runSkillerWithInheritedStdio('apply', projectRoot);

    await expect(
      fs.readFile(path.join(projectRoot, 'AGENTS.md'), 'utf8'),
    ).resolves.toBe('# Authored project instructions\n\nRule A\n');
    await expect(
      fs.access(path.join(projectRoot, 'CLAUDE.md')),
    ).rejects.toThrow();
    await expect(
      fs.readFile(path.join(projectRoot, '.clinerules'), 'utf8'),
    ).resolves.toContain('Rule B');
    await expect(
      fs.readFile(path.join(projectRoot, 'CRUSH.md'), 'utf8'),
    ).resolves.toContain('Rule A');
    await expect(
      fs.readFile(
        path.join(projectRoot, '.openhands', 'microagents', 'repo.md'),
        'utf8',
      ),
    ).resolves.toContain('Rule B');
    await expect(
      fs.readFile(
        path.join(
          projectRoot,
          '.kilocode',
          'rules',
          'skiller_kilocode_instructions.md',
        ),
        'utf8',
      ),
    ).resolves.toContain('Rule A');
  });

  it('respects identifier-only default_agents', async () => {
    await fs.writeFile(
      path.join(testProject.projectRoot, '.agents', 'skiller.toml'),
      'default_agents = ["cline", "crush"]\n',
    );

    runSkillerWithInheritedStdio('apply', testProject.projectRoot);

    await expect(
      fs.readFile(path.join(testProject.projectRoot, '.clinerules'), 'utf8'),
    ).resolves.toContain('Rule B');
    await expect(
      fs.readFile(path.join(testProject.projectRoot, 'CRUSH.md'), 'utf8'),
    ).resolves.toContain('Rule B');
    await expect(
      fs.access(path.join(testProject.projectRoot, '.junie')),
    ).rejects.toThrow();
  });

  it('lets --agents override default_agents', async () => {
    await fs.writeFile(
      path.join(testProject.projectRoot, '.agents', 'skiller.toml'),
      'default_agents = ["cline"]\n',
    );

    runSkillerWithInheritedStdio(
      'apply --agents crush',
      testProject.projectRoot,
    );

    await expect(
      fs.access(path.join(testProject.projectRoot, '.clinerules')),
    ).rejects.toThrow();
    await expect(
      fs.readFile(path.join(testProject.projectRoot, 'CRUSH.md'), 'utf8'),
    ).resolves.toContain('Rule A');
  });

  it('honors a custom output path for generated targets', async () => {
    await fs.writeFile(
      path.join(testProject.projectRoot, '.agents', 'skiller.toml'),
      `default_agents = ["cline"]

[agents.cline]
output_path = "custom-cline.md"
`,
    );

    runSkillerWithInheritedStdio('apply', testProject.projectRoot);

    await expect(
      fs.readFile(
        path.join(testProject.projectRoot, 'custom-cline.md'),
        'utf8',
      ),
    ).resolves.toContain('Rule B');
  });

  it('gitignores generated outputs but not authored AGENTS.md', async () => {
    runSkillerWithInheritedStdio('apply', testProject.projectRoot);

    const gitignore = await fs.readFile(
      path.join(testProject.projectRoot, '.gitignore'),
      'utf8',
    );
    expect(gitignore).toContain('# START Skiller Generated Files');
    expect(gitignore).toContain('/.clinerules');
    expect(gitignore).toContain('/CRUSH.md');
    expect(gitignore).not.toContain('/AGENTS.md');
    expect(gitignore).not.toContain('/CLAUDE.md');
  });

  it('preserves existing .gitignore content and honors --no-gitignore', async () => {
    const gitignorePath = path.join(testProject.projectRoot, '.gitignore');
    await fs.writeFile(gitignorePath, 'node_modules/\n*.log\n');

    runSkillerWithInheritedStdio('apply', testProject.projectRoot);

    const updated = await fs.readFile(gitignorePath, 'utf8');
    expect(updated).toContain('node_modules/');
    expect(updated).toContain('*.log');
    expect(updated).toContain('/.clinerules');

    await fs.rm(gitignorePath);
    runSkillerWithInheritedStdio(
      'apply --no-gitignore',
      testProject.projectRoot,
    );
    await expect(fs.access(gitignorePath)).rejects.toThrow();
  });
});
