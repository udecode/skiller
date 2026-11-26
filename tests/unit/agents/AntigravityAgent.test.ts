import * as os from 'os';
import * as path from 'path';
import { promises as fs } from 'fs';
import { AntigravityAgent } from '../../../src/agents/AntigravityAgent';
import * as FileSystemUtils from '../../../src/core/FileSystemUtils';
import { applyAllAgentConfigs } from '../../../src/lib';

describe('AntigravityAgent', () => {
  let agent: AntigravityAgent;

  beforeEach(() => {
    agent = new AntigravityAgent();
    jest.restoreAllMocks();
  });

  it('should return the correct identifier', () => {
    expect(agent.getIdentifier()).toBe('antigravity');
  });

  it('should return the correct name', () => {
    expect(agent.getName()).toBe('Antigravity');
  });

  it('should return the correct default output path', () => {
    expect(agent.getDefaultOutputPath('/root')).toBe('/root/AGENTS.md');
  });

  it('does not generate the default instruction path', async () => {
    const writeGeneratedFile = jest.spyOn(
      FileSystemUtils,
      'writeGeneratedFile',
    );
    await agent.applySkillerConfig('rules', '/root', null);
    expect(writeGeneratedFile).not.toHaveBeenCalled();
  });

  it('should support stdio and remote MCP servers', () => {
    expect(agent.getMcpServerKey()).toBe('mcpServers');
    expect(agent.supportsMcpStdio()).toBe(true);
    expect(agent.supportsMcpRemote()).toBe(true);
  });

  it('should support native skills under .agents/skills', () => {
    expect(agent.supportsNativeSkills()).toBe(true);
    expect(agent.getSkillsPath('/test/project')).toBe(
      '/test/project/.agents/skills',
    );
  });

  it('propagates stdio and remote MCP servers to .agents/mcp_config.json using serverUrl without type', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'skiller-antigravity-'),
    );
    try {
      await fs.writeFile(path.join(tmpDir, 'AGENTS.md'), '# Shared Rules\n');
      const agentsDir = path.join(tmpDir, '.agents');
      await fs.mkdir(agentsDir, { recursive: true });
      await fs.writeFile(
        path.join(agentsDir, 'skiller.toml'),
        `default_agents = ["antigravity"]

[backup]
enabled = false

[gitignore]
enabled = false

[mcp]
enabled = true
merge_strategy = "merge"

[mcp_servers.cloudflare]
url = "https://mcp.cloudflare.com/mcp"

[mcp_servers.local_tool]
command = "node"
args = ["server.js"]
`,
      );

      await applyAllAgentConfigs(
        tmpDir,
        ['antigravity'],
        undefined,
        true,
        undefined,
        false,
        false,
        false,
        false,
        false,
        false,
      );

      const mcpConfigPath = path.join(tmpDir, '.agents', 'mcp_config.json');
      const written = JSON.parse(await fs.readFile(mcpConfigPath, 'utf8'));
      expect(written).toEqual({
        mcpServers: {
          cloudflare: {
            serverUrl: 'https://mcp.cloudflare.com/mcp',
          },
          local_tool: {
            command: 'node',
            args: ['server.js'],
          },
        },
      });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
