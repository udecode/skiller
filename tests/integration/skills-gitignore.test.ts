import * as fs from 'fs/promises';
import * as path from 'path';
import { setupTestProject, teardownTestProject } from '../harness';
import { applyAllAgentConfigs } from '../../src/lib';

describe('Skills Gitignore Integration', () => {
  let testProject: { projectRoot: string };

  beforeEach(async () => {
    testProject = await setupTestProject();
  });

  afterEach(async () => {
    await teardownTestProject(testProject.projectRoot);
  });

  it('should NOT add .claude/skills to gitignore when skills are enabled', async () => {
    const { projectRoot } = testProject;

    // Create .claude directory with skiller.toml
    const skillerDir = path.join(projectRoot, '.claude');
    await fs.mkdir(skillerDir, { recursive: true });

    const tomlContent = `
[skills]
enabled = true

[gitignore]
enabled = true
`;
    await fs.writeFile(path.join(skillerDir, 'skiller.toml'), tomlContent);

    // Create minimal AGENTS.md
    await fs.writeFile(path.join(skillerDir, 'AGENTS.md'), '# Test');

    // Run apply
    await applyAllAgentConfigs(
      projectRoot,
      ['claude'], // Only run claude agent
      undefined, // configPath
      false, // cliMcpEnabled
      undefined, // cliMcpStrategy
      true, // cliGitignoreEnabled
      true, // verbose - enable to see what's happening
      false, // dryRun
      true, // localOnly
      false, // nested
      false, // cliBackupEnabled
      true, // skillsEnabled
    );

    // Check gitignore content
    const gitignorePath = path.join(projectRoot, '.gitignore');
    const gitignoreContent = await fs.readFile(gitignorePath, 'utf8');

    // In the new architecture, .claude/skills is the source of truth
    // and should NEVER be gitignored
    expect(gitignoreContent).not.toContain('.claude/skills');
  });

  it('should respect agent-level gitignore = false config for both output files and MCP files', async () => {
    const { projectRoot } = testProject;

    // Create .claude directory with skiller.toml that disables gitignore for claude agent
    const skillerDir = path.join(projectRoot, '.claude');
    await fs.mkdir(skillerDir, { recursive: true });

    const tomlContent = `
[gitignore]
enabled = true

[mcp]
enabled = true

[agents.claude]
enabled = true
gitignore = false

[agents.codex]
enabled = true
`;
    await fs.writeFile(path.join(skillerDir, 'skiller.toml'), tomlContent);

    // Create minimal AGENTS.md
    await fs.writeFile(path.join(skillerDir, 'AGENTS.md'), '# Test');

    // Create a minimal MCP config to trigger MCP file generation
    const mcpConfig = {
      mcpServers: {
        test: {
          command: 'node',
          args: ['test.js'],
        },
      },
    };
    await fs.writeFile(
      path.join(skillerDir, 'mcp.json'),
      JSON.stringify(mcpConfig, null, 2),
    );

    // Run apply with both agents and MCP enabled
    await applyAllAgentConfigs(
      projectRoot,
      ['claude', 'codex'],
      undefined, // configPath
      true, // cliMcpEnabled
      undefined, // cliMcpStrategy
      true, // cliGitignoreEnabled
      false, // verbose
      false, // dryRun
      true, // localOnly
      false, // nested
      false, // cliBackupEnabled
      false, // skillsEnabled
    );

    // Check gitignore content
    const gitignorePath = path.join(projectRoot, '.gitignore');
    const gitignoreContent = await fs.readFile(gitignorePath, 'utf8');

    // CLAUDE.md should NOT be in gitignore (gitignore = false)
    expect(gitignoreContent).not.toContain('CLAUDE.md');
    // Claude's MCP file (.mcp.json) should also NOT be in gitignore (gitignore = false)
    expect(gitignoreContent).not.toContain('.mcp.json');
    // But AGENTS.md should be in gitignore (default gitignore = true for codex)
    expect(gitignoreContent).toContain('AGENTS.md');
    // And .codex/config.toml should be in gitignore
    expect(gitignoreContent).toContain('.codex/config.toml');
  });
});
