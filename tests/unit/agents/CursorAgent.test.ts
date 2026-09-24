import { promises as fs } from 'fs';
import * as path from 'path';
import os from 'os';

import { CursorAgent } from '../../../src/agents/CursorAgent';

describe('CursorAgent', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skiller-cursor-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('Basic Agent Interface', () => {
    it('returns correct identifier', () => {
      const agent = new CursorAgent();
      expect(agent.getIdentifier()).toBe('cursor');
    });

    it('returns correct display name', () => {
      const agent = new CursorAgent();
      expect(agent.getName()).toBe('Cursor');
    });

    it('returns correct default output path for AGENTS.md', () => {
      const agent = new CursorAgent();
      const expected = path.join(tmpDir, 'AGENTS.md');
      expect(agent.getDefaultOutputPath(tmpDir)).toBe(expected);
    });
  });

  describe('File Operations', () => {
    it('does not generate AGENTS.md', async () => {
      const agent = new CursorAgent();
      const target = path.join(tmpDir, 'AGENTS.md');

      const sampleRules = 'Sample concatenated rules';

      await agent.applySkillerConfig(sampleRules, tmpDir, null);

      await expect(fs.access(target)).rejects.toThrow();
    });

    it('does not back up or rewrite existing instructions', async () => {
      const agent = new CursorAgent();
      const target = path.join(tmpDir, 'AGENTS.md');

      // Create an existing file
      await fs.writeFile(target, 'old cursor rules');

      await agent.applySkillerConfig('new cursor rules', tmpDir, null);

      await expect(fs.access(`${target}.bak`)).rejects.toThrow();
      expect(await fs.readFile(target, 'utf8')).toBe('old cursor rules');
    });

    it('is idempotent when content is unchanged', async () => {
      const agent = new CursorAgent();
      const target = path.join(tmpDir, 'AGENTS.md');
      const sampleRules = 'Sample rules content';

      await fs.writeFile(target, 'Authored rules');
      await agent.applySkillerConfig(sampleRules, tmpDir, null);
      const stat1 = await fs.stat(target);

      // Wait a bit to ensure timestamp would differ if file was rewritten
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Second write with same content
      await agent.applySkillerConfig(sampleRules, tmpDir, null);
      const stat2 = await fs.stat(target);

      // File should not have been rewritten (same modification time)
      expect(stat2.mtimeMs).toBe(stat1.mtimeMs);
    });
  });

  describe('MCP Support', () => {
    it('supports MCP stdio', () => {
      const agent = new CursorAgent();
      expect(agent.supportsMcpStdio()).toBe(true);
    });

    it('supports MCP remote', () => {
      const agent = new CursorAgent();
      expect(agent.supportsMcpRemote()).toBe(true);
    });
  });

  describe('Skills Support', () => {
    it('supports native skills', () => {
      const agent = new CursorAgent();
      expect(agent.supportsNativeSkills?.()).toBe(true);
    });

    it('uses the shared .agents/skills path', () => {
      const agent = new CursorAgent();
      expect(agent.getSkillsPath?.('/root')).toBe('/root/.agents/skills');
    });
  });
});
