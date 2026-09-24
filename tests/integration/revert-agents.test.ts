import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { revertAllAgentConfigs } from '../../src/revert';

describe('Revert Agent Integration', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'skiller-agent-integration-'),
    );
    await fs.mkdir(path.join(tmpDir, '.agents'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, '.agents', 'skiller.toml'), '');
    await fs.writeFile(
      path.join(tmpDir, 'AGENTS.md'),
      '# Authored instructions\n',
    );
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('reverts only the selected generated target', async () => {
    await fs.writeFile(path.join(tmpDir, '.clinerules'), 'Cline content');
    await fs.writeFile(path.join(tmpDir, 'CRUSH.md'), 'Crush content');

    await revertAllAgentConfigs(tmpDir, ['cline'], undefined, false, false);

    await expect(fs.access(path.join(tmpDir, '.clinerules'))).rejects.toThrow();
    await expect(
      fs.access(path.join(tmpDir, 'CRUSH.md')),
    ).resolves.toBeUndefined();
    await expect(
      fs.readFile(path.join(tmpDir, 'AGENTS.md'), 'utf8'),
    ).resolves.toBe('# Authored instructions\n');
  });

  it('reverts multiple generated targets', async () => {
    await fs.writeFile(path.join(tmpDir, '.clinerules'), 'Cline content');
    await fs.writeFile(path.join(tmpDir, 'CRUSH.md'), 'Crush content');

    await revertAllAgentConfigs(
      tmpDir,
      ['cline', 'crush'],
      undefined,
      false,
      false,
    );

    await expect(fs.access(path.join(tmpDir, '.clinerules'))).rejects.toThrow();
    await expect(fs.access(path.join(tmpDir, 'CRUSH.md'))).rejects.toThrow();
    await expect(
      fs.access(path.join(tmpDir, 'AGENTS.md')),
    ).resolves.toBeUndefined();
  });

  it('removes Kilo Code files and their empty directories', async () => {
    const rulesDir = path.join(tmpDir, '.kilocode', 'rules');
    await fs.mkdir(rulesDir, { recursive: true });
    await fs.writeFile(
      path.join(rulesDir, 'skiller_kilocode_instructions.md'),
      'Kilo content',
    );
    await fs.writeFile(path.join(tmpDir, '.kilocode', 'mcp.json'), '{}');

    await revertAllAgentConfigs(tmpDir, ['kilo'], undefined, false, false);

    await expect(fs.access(path.join(tmpDir, '.kilocode'))).rejects.toThrow();
  });

  it('restores generated targets from backups', async () => {
    const target = path.join(tmpDir, '.clinerules');
    await fs.writeFile(`${target}.bak`, 'Original Cline');
    await fs.writeFile(target, 'Modified Cline');

    await revertAllAgentConfigs(tmpDir, ['cline'], undefined, false, false);

    await expect(fs.readFile(target, 'utf8')).resolves.toBe('Original Cline');
    await expect(fs.access(`${target}.bak`)).rejects.toThrow();
    await expect(
      fs.access(path.join(tmpDir, 'AGENTS.md')),
    ).resolves.toBeUndefined();
  });

  it('cleans generated MCP files without touching root instructions', async () => {
    await fs.writeFile(path.join(tmpDir, '.mcp.json'), '{}');
    await fs.mkdir(path.join(tmpDir, '.vscode'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, '.vscode', 'mcp.json'), '{}');

    await revertAllAgentConfigs(tmpDir, undefined, undefined, false, false);

    await expect(fs.access(path.join(tmpDir, '.mcp.json'))).rejects.toThrow();
    await expect(
      fs.access(path.join(tmpDir, '.vscode', 'mcp.json')),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(tmpDir, 'AGENTS.md')),
    ).resolves.toBeUndefined();
  });
});
