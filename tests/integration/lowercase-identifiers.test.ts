import * as fs from 'fs/promises';
import * as path from 'path';
import os from 'os';
import { applyAllAgentConfigs } from '../../src/lib';

describe('Canonical Identifiers Integration', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'skiller-lowercase-integration-'),
    );

    // Create .claude directory with basic files
    const skillerDir = path.join(tmpDir, '.claude');
    await fs.mkdir(skillerDir, { recursive: true });
    await fs.writeFile(
      path.join(skillerDir, 'instructions.md'),
      '# Test instructions',
    );
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('accepts canonical identifiers in CLI --agents option', async () => {
    const configContent = `
[agents.github-copilot]
enabled = true

[agents.claude-code]
enabled = true
`;
    await fs.writeFile(
      path.join(tmpDir, '.claude', 'skiller.toml'),
      configContent,
    );

    await expect(
      applyAllAgentConfigs(
        tmpDir,
        ['github-copilot', 'claude-code'],
        undefined,
        false, // no MCP
        undefined,
        false, // no gitignore
        false, // not verbose
        true, // dry run
      ),
    ).resolves.not.toThrow();
  });

  it('accepts canonical identifiers in default_agents config', async () => {
    const configContent = `
default_agents = ["github-copilot", "claude-code"]

[agents.github-copilot]
enabled = true

[agents.claude-code]
enabled = true
`;
    await fs.writeFile(
      path.join(tmpDir, '.claude', 'skiller.toml'),
      configContent,
    );

    await expect(
      applyAllAgentConfigs(
        tmpDir,
        undefined, // no CLI agents
        undefined,
        false, // no MCP
        undefined,
        false, // no gitignore
        false, // not verbose
        true, // dry run
      ),
    ).resolves.not.toThrow();
  });

  it('rejects legacy and non-canonical identifiers', async () => {
    const configContent = `
[agents.github-copilot]
enabled = true
output_path = "CUSTOM_COPILOT.md"

[agents.claude-code]
enabled = false

[agents.codex]
enabled = true
`;
    await fs.writeFile(
      path.join(tmpDir, '.claude', 'skiller.toml'),
      configContent,
    );

    await expect(
      applyAllAgentConfigs(
        tmpDir,
        ['copilot', 'claude'],
        undefined,
        false, // no MCP
        undefined,
        false, // no gitignore
        false, // not verbose
        true, // dry run
      ),
    ).rejects.toThrow('Invalid agent specified: copilot, claude');
  });
});
