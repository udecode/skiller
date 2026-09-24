import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CodexCliAgent } from '../../../src/agents/CodexCliAgent';

describe('CodexCliAgent - MCP Config Path Tracking', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skiller-codex-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('should return both instructions and config paths from getDefaultOutputPath', () => {
    const agent = new CodexCliAgent();
    const result = agent.getDefaultOutputPath(tmpDir);

    expect(result).toEqual({
      instructions: path.join(tmpDir, 'AGENTS.md'),
      config: path.join(tmpDir, '.codex', 'config.toml'),
    });
  });

  it('creates only .codex/config.toml when MCP is enabled', async () => {
    const agent = new CodexCliAgent();
    const skillerMcpJson = {
      mcpServers: {
        filesystem: {
          command: 'npx',
          args: [
            '-y',
            '@modelcontextprotocol/server-filesystem',
            '/path/to/files',
          ],
        },
      },
    };

    await agent.applySkillerConfig(
      '# Test Rules\nThis is a test configuration.',
      tmpDir,
      skillerMcpJson,
    );

    // Root instructions are authored, not generated.
    const agentsPath = path.join(tmpDir, 'AGENTS.md');
    const configPath = path.join(tmpDir, '.codex', 'config.toml');

    expect(
      await fs
        .access(agentsPath)
        .then(() => true)
        .catch(() => false),
    ).toBe(false);
    expect(
      await fs
        .access(configPath)
        .then(() => true)
        .catch(() => false),
    ).toBe(true);

    // Verify content
    const configContent = await fs.readFile(configPath, 'utf8');
    expect(configContent).toContain('[mcp_servers.filesystem]');
    expect(configContent).toContain('command = "npx"');
  });

  it('should respect outputPathConfig override', async () => {
    const agent = new CodexCliAgent();
    const customConfigPath = path.join(tmpDir, 'custom', 'codex.toml');
    const skillerMcpJson = {
      mcpServers: {
        filesystem: {
          command: 'npx',
          args: [
            '-y',
            '@modelcontextprotocol/server-filesystem',
            '/path/to/files',
          ],
        },
      },
    };

    await agent.applySkillerConfig('# Test Rules', tmpDir, skillerMcpJson, {
      outputPathConfig: customConfigPath,
    });

    // Should create config at custom path
    expect(
      await fs
        .access(customConfigPath)
        .then(() => true)
        .catch(() => false),
    ).toBe(true);

    // Should not create AGENTS.md at default location
    const agentsPath = path.join(tmpDir, 'AGENTS.md');
    expect(
      await fs
        .access(agentsPath)
        .then(() => true)
        .catch(() => false),
    ).toBe(false);
  });
});
