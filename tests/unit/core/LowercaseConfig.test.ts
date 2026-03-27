import * as fs from 'fs/promises';
import * as path from 'path';
import os from 'os';
import { loadConfig } from '../../../src/core/ConfigLoader';
import { applyAllAgentConfigs } from '../../../src/lib';

describe('Lowercase Configuration Support', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'skiller-lowercase-config-'),
    );

    // Create .claude directory
    const skillerDir = path.join(tmpDir, '.claude');
    await fs.mkdir(skillerDir, { recursive: true });

    // Create a basic instructions file
    await fs.writeFile(
      path.join(skillerDir, 'instructions.md'),
      '# Test instructions',
    );
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('supports lowercase agent identifiers in default_agents', async () => {
    const configContent = `
default_agents = ["github-copilot", "claude-code", "codex"]

[agents.github-copilot]
enabled = true

[agents.claude-code]
enabled = false
`;

    const configPath = path.join(tmpDir, '.claude', 'skiller.toml');
    await fs.writeFile(configPath, configContent);

    const config = await loadConfig({
      projectRoot: tmpDir,
      configPath,
    });

    expect(config.defaultAgents).toEqual([
      'github-copilot',
      'claude-code',
      'codex',
    ]);
    expect(config.agentConfigs['github-copilot']?.enabled).toBe(true);
    expect(config.agentConfigs['claude-code']?.enabled).toBe(false);
  });

  it('preserves CLI agent identifiers exactly as provided', async () => {
    const config = await loadConfig({
      projectRoot: tmpDir,
      cliAgents: ['github-copilot', 'CLAUDE-CODE', 'cursor'],
    });

    expect(config.cliAgents).toEqual([
      'github-copilot',
      'CLAUDE-CODE',
      'cursor',
    ]);
  });

  it('normalizes agent config keys to lowercase', async () => {
    const configContent = `
[agents.GITHUB-COPILOT]
enabled = true

[agents.Claude-Code]
enabled = false

[agents.codex]
enabled = true
`;

    const configPath = path.join(tmpDir, '.claude', 'skiller.toml');
    await fs.writeFile(configPath, configContent);

    const config = await loadConfig({
      projectRoot: tmpDir,
      configPath,
    });

    // ConfigLoader preserves the original casing, normalization happens in lib.ts
    expect(config.agentConfigs['GITHUB-COPILOT']?.enabled).toBe(true);
    expect(config.agentConfigs['Claude-Code']?.enabled).toBe(false);
    expect(config.agentConfigs.codex?.enabled).toBe(true);
  });

  it('provides correct output paths for all agents', async () => {
    const configContent = `
[agents.github-copilot]
output_path = "custom/copilot.md"

[agents.claude-code]
output_path = "CUSTOM_CLAUDE.md"

[agents.codex]
output_path_instructions = "custom_codex.md"
output_path_config = "custom_codex.toml"
`;

    const configPath = path.join(tmpDir, '.claude', 'skiller.toml');
    await fs.writeFile(configPath, configContent);

    const config = await loadConfig({
      projectRoot: tmpDir,
      configPath,
    });

    // ConfigLoader resolves paths to absolute paths
    expect(config.agentConfigs['github-copilot']?.outputPath).toBe(
      path.join(tmpDir, 'custom/copilot.md'),
    );
    expect(config.agentConfigs['claude-code']?.outputPath).toBe(
      path.join(tmpDir, 'CUSTOM_CLAUDE.md'),
    );
    expect(config.agentConfigs.codex?.outputPathInstructions).toBe(
      path.join(tmpDir, 'custom_codex.md'),
    );
    expect(config.agentConfigs.codex?.outputPathConfig).toBe(
      path.join(tmpDir, 'custom_codex.toml'),
    );
  });
});
