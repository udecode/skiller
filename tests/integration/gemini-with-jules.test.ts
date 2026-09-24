import * as fs from 'fs/promises';
import * as path from 'path';
import {
  setupTestProject,
  teardownTestProject,
  runSkillerWithInheritedStdio,
} from '../harness';

describe('Gemini MCP merge even if AGENTS.md already written by Amp', () => {
  let projectRoot: string;

  beforeAll(async () => {
    const tmp = await setupTestProject({
      'AGENTS.md': 'Rule A',
      '.agents/mcp.json': JSON.stringify({
        mcpServers: {
          ex: { command: 'uvx', args: ['mcp-ex'] },
        },
      }),
    });
    projectRoot = tmp.projectRoot;
  });

  afterAll(async () => {
    await teardownTestProject(projectRoot);
  });

  it('keeps mcpServers in .gemini/settings.json when running amp,gemini-cli', async () => {
    runSkillerWithInheritedStdio('apply --agents amp,gemini-cli', projectRoot);
    const settingsPath = path.join(projectRoot, '.gemini', 'settings.json');
    const raw = await fs.readFile(settingsPath, 'utf8');
    const json = JSON.parse(raw);
    expect(json.mcpServers).toBeDefined();
    expect(Object.keys(json.mcpServers)).toContain('ex');
  });
});
