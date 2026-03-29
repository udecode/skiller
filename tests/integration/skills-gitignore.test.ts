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

  it('should gitignore generated .claude/skills but not canonical .agents/skills when skills are enabled', async () => {
    const { projectRoot } = testProject;

    const skillerDir = path.join(projectRoot, '.agents');
    await fs.mkdir(skillerDir, { recursive: true });

    const tomlContent = `
[skills]
enabled = true

[gitignore]
enabled = true
`;
    await fs.writeFile(path.join(skillerDir, 'skiller.toml'), tomlContent);

    // Create minimal AGENTS.md and one canonical skill
    await fs.writeFile(path.join(skillerDir, 'AGENTS.md'), '# Test');
    await fs.mkdir(path.join(projectRoot, '.agents', 'skills', 'local-skill'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(projectRoot, '.agents', 'skills', 'local-skill', 'SKILL.md'),
      `---
name: local-skill
description: Local skill
---

# Local skill`,
    );

    // Run apply
    await applyAllAgentConfigs(
      projectRoot,
      ['claude-code'],
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

    expect(gitignoreContent).toContain('/.claude/skills');
    expect(gitignoreContent).not.toContain('/.agents/skills');
  });

  it('should respect agent-level gitignore = false config for both output files and MCP files', async () => {
    const { projectRoot } = testProject;

    // Create .agents directory with skiller.toml that disables gitignore for claude-code agent
    const skillerDir = path.join(projectRoot, '.agents');
    await fs.mkdir(skillerDir, { recursive: true });

    const tomlContent = `
[gitignore]
enabled = true

[mcp]
enabled = true

[agents.claude-code]
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
      ['claude-code', 'codex'],
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
