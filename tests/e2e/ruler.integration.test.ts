import * as fs from 'fs/promises';
import * as path from 'path';
import {
  setupTestProject,
  teardownTestProject,
  runSkillerWithInheritedStdio,
} from '../harness';

describe('Comprehensive integration: init → configure → apply', () => {
  let testProject: { projectRoot: string };

  beforeAll(async () => {
    testProject = await setupTestProject();
  });

  afterAll(async () => {
    await teardownTestProject(testProject.projectRoot);
  });

  it('uses root AGENTS.md as the shared authored instructions', async () => {
    const { projectRoot } = testProject;
    runSkillerWithInheritedStdio('init', projectRoot);

    const agentsDir = path.join(projectRoot, '.agents');
    await expect(
      fs.access(path.join(agentsDir, 'skiller.toml')),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(projectRoot, 'AGENTS.md')),
    ).resolves.toBeUndefined();

    const authoredInstructions = `# Project instructions

## Integration Test Marker

Root AGENTS.md remains authored.
`;
    await fs.writeFile(
      path.join(projectRoot, 'AGENTS.md'),
      authoredInstructions,
    );
    await fs.writeFile(
      path.join(agentsDir, 'extra-rules.md'),
      '# Extra rules\n\nSupplemental integration content.\n',
    );
    await fs.writeFile(
      path.join(agentsDir, 'skiller.toml'),
      `default_agents = ["claude-code", "codex", "cline", "crush", "augment", "kilo", "openhands", "qwen-code", "warp", "trae"]

[mcp]
enabled = true

[mcp_servers.filesystem]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem", "${projectRoot}"]
`,
    );

    runSkillerWithInheritedStdio('apply', projectRoot);

    await expect(
      fs.readFile(path.join(projectRoot, 'AGENTS.md'), 'utf8'),
    ).resolves.toBe(authoredInstructions);
    await expect(
      fs.access(path.join(projectRoot, 'CLAUDE.md')),
    ).rejects.toThrow();

    const generatedRuleFiles = [
      '.clinerules',
      'CRUSH.md',
      'WARP.md',
      '.augment/rules/skiller_augment_instructions.md',
      '.kilocode/rules/skiller_kilocode_instructions.md',
      '.openhands/microagents/repo.md',
      '.trae/rules/project_rules.md',
    ];
    for (const relativePath of generatedRuleFiles) {
      await expect(
        fs.readFile(path.join(projectRoot, relativePath), 'utf8'),
      ).resolves.toContain('Supplemental integration content');
    }

    const generatedMcpFiles = [
      '.mcp.json',
      '.codex/config.toml',
      '.crush.json',
      '.qwen/settings.json',
      '.kilocode/mcp.json',
    ];
    for (const relativePath of generatedMcpFiles) {
      await expect(
        fs.access(path.join(projectRoot, relativePath)),
      ).resolves.toBeUndefined();
    }

    const gitignore = await fs.readFile(
      path.join(projectRoot, '.gitignore'),
      'utf8',
    );
    expect(gitignore).not.toContain('/AGENTS.md');
    expect(gitignore).not.toContain('/CLAUDE.md');
    expect(gitignore).toContain('/.clinerules');
  });
});
