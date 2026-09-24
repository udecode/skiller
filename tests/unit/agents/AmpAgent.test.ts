import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { AmpAgent } from '../../../src/agents/AmpAgent';

describe('AmpAgent', () => {
  const agent = new AmpAgent();

  it('exposes the shared AGENTS.md contract', () => {
    expect(agent.getIdentifier()).toBe('amp');
    expect(agent.getName()).toBe('Amp');
    expect(agent.getMcpServerKey()).toBe('');
    expect(agent.getDefaultOutputPath('/project')).toBe('/project/AGENTS.md');
  });

  it('preserves authored instructions and ignores output overrides', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'amp-agent-'));
    try {
      const agentsPath = path.join(projectRoot, 'AGENTS.md');
      await fs.writeFile(agentsPath, 'Authored instructions');

      await agent.applySkillerConfig('Generated rules', projectRoot, null, {
        outputPath: 'CUSTOM.md',
      });

      expect(await fs.readFile(agentsPath, 'utf8')).toBe(
        'Authored instructions',
      );
      await expect(
        fs.access(path.join(projectRoot, 'CUSTOM.md')),
      ).rejects.toThrow();
      await expect(fs.access(`${agentsPath}.bak`)).rejects.toThrow();
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('uses shared native skills', () => {
    expect(agent.supportsNativeSkills?.()).toBe(true);
    expect(agent.getSkillsPath?.('/project')).toBe('/project/.agents/skills');
  });
});
