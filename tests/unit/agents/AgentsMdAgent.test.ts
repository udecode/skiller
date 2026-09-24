import { AgentsMdAgent } from '../../../src/agents/AgentsMdAgent';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

/**
 * Tests for agents that consume the authored root AGENTS.md.
 */
describe('AgentsMdAgent', () => {
  let agent: AgentsMdAgent;
  let tmpDir: string;
  let targetFile: string;

  beforeEach(async () => {
    agent = new AgentsMdAgent();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentsmd-agent-test-'));
    targetFile = path.join(tmpDir, 'AGENTS.md');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('has correct identifier and name', () => {
    expect(agent.getIdentifier()).toBe('agentsmd');
    expect(agent.getName()).toBe('AgentsMd');
  });

  it('returns correct default output path', () => {
    const expected = path.join(tmpDir, 'AGENTS.md');
    expect(agent.getDefaultOutputPath(tmpDir)).toBe(expected);
  });

  it('does not generate a missing root AGENTS.md', async () => {
    await agent.applySkillerConfig('Generated rules', tmpDir, null);
    await expect(fs.access(targetFile)).rejects.toThrow();
    await expect(fs.access(`${targetFile}.bak`)).rejects.toThrow();
  });

  it('preserves authored content when rules change', async () => {
    await fs.writeFile(targetFile, 'Authored rules');
    await agent.applySkillerConfig('Generated rules', tmpDir, null);
    const written = await fs.readFile(targetFile, 'utf8');
    expect(written).toBe('Authored rules');
    await expect(fs.access(`${targetFile}.bak`)).rejects.toThrow();
  });

  it('does not touch the file timestamp', async () => {
    await fs.writeFile(targetFile, 'Authored rules');
    const statBefore = await fs.stat(targetFile);
    await new Promise((r) => setTimeout(r, 10)); // ensure mtime would differ if rewritten
    await agent.applySkillerConfig('Generated rules', tmpDir, null);
    const statAfter = await fs.stat(targetFile);
    expect(statAfter.mtimeMs).toBe(statBefore.mtimeMs);
    await expect(fs.access(`${targetFile}.bak`)).rejects.toThrow();
  });

  it('returns empty MCP server key (no MCP propagation)', () => {
    expect(agent.getMcpServerKey()).toBe('');
  });
});
