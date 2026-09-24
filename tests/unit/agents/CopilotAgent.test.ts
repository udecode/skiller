import { promises as fs } from 'fs';
import * as path from 'path';
import { CopilotAgent } from '../../../src/agents/CopilotAgent';
import { setupTestProject, teardownTestProject } from '../../harness';

describe('CopilotAgent', () => {
  it('should be defined', () => {
    expect(new CopilotAgent()).toBeDefined();
  });

  it('should implement IAgent interface', () => {
    const agent = new CopilotAgent();
    // Check that it implements the IAgent interface methods
    expect(typeof agent.getIdentifier).toBe('function');
    expect(typeof agent.getName).toBe('function');
    expect(typeof agent.getDefaultOutputPath).toBe('function');
    expect(typeof agent.applySkillerConfig).toBe('function');
  });

  it('should have the correct identifier', () => {
    const agent = new CopilotAgent();
    expect(agent.getIdentifier()).toBe('github-copilot');
  });

  it('should have the correct name', () => {
    const agent = new CopilotAgent();
    expect(agent.getName()).toBe('GitHub Copilot');
  });

  it('should support MCP stdio and remote', () => {
    const agent = new CopilotAgent();
    expect(agent.supportsMcpStdio()).toBe(true);
    expect(agent.supportsMcpRemote()).toBe(true);
  });

  it('should use servers as MCP key', () => {
    const agent = new CopilotAgent();
    expect(agent.getMcpServerKey()).toBe('servers');
  });

  it('preserves the authored AGENTS.md file', async () => {
    const { projectRoot } = await setupTestProject({
      'AGENTS.md': 'Rule A',
    });
    try {
      const agent = new CopilotAgent();
      const rules = 'Combined rules\n- Rule A';

      await agent.applySkillerConfig(rules, projectRoot, null);

      // AGENTS.md should be written at the repository root
      const agentsMdPath = path.join(projectRoot, 'AGENTS.md');
      const content = await fs.readFile(agentsMdPath, 'utf8');
      expect(content).toBe('Rule A');
    } finally {
      await teardownTestProject(projectRoot);
    }
  });

  it('does not create backups for authored AGENTS.md', async () => {
    const { projectRoot } = await setupTestProject({
      'AGENTS.md': 'Rule A',
    });
    try {
      // Create existing file to be backed up
      const agentsMdPath = path.join(projectRoot, 'AGENTS.md');

      await fs.writeFile(agentsMdPath, 'Existing AGENTS.md content');

      const agent = new CopilotAgent();
      const rules = 'Combined rules\n- Rule A';

      await agent.applySkillerConfig(rules, projectRoot, null, undefined, true);

      const agentsMdBackup = path.join(projectRoot, 'AGENTS.md.bak');
      await expect(fs.access(agentsMdBackup)).rejects.toThrow();
      expect(await fs.readFile(agentsMdPath, 'utf8')).toBe(
        'Existing AGENTS.md content',
      );
    } finally {
      await teardownTestProject(projectRoot);
    }
  });

  it('respects --no-backup flag for AGENTS.md', async () => {
    const { projectRoot } = await setupTestProject({
      'AGENTS.md': 'Rule A',
    });
    try {
      // Create existing file
      const agentsMdPath = path.join(projectRoot, 'AGENTS.md');

      await fs.writeFile(agentsMdPath, 'Existing AGENTS.md content');

      const agent = new CopilotAgent();
      const rules = 'Combined rules\n- Rule A';

      await agent.applySkillerConfig(
        rules,
        projectRoot,
        null,
        undefined,
        false,
      );

      // Check that no backup file was created
      const agentsMdBackup = path.join(projectRoot, 'AGENTS.md.bak');

      const agentsMdBackupExists = await fs
        .access(agentsMdBackup)
        .then(() => true)
        .catch(() => false);

      expect(agentsMdBackupExists).toBe(false);

      expect(await fs.readFile(agentsMdPath, 'utf8')).toBe(
        'Existing AGENTS.md content',
      );
    } finally {
      await teardownTestProject(projectRoot);
    }
  });

  it('is idempotent - does not write when content is unchanged', async () => {
    const { projectRoot } = await setupTestProject({
      'AGENTS.md': 'Rule A',
    });
    try {
      const agent = new CopilotAgent();
      const rules = 'Combined rules\n- Rule A';

      // First apply
      await agent.applySkillerConfig(rules, projectRoot, null);

      const agentsMdPath = path.join(projectRoot, 'AGENTS.md');

      // Get modification time
      const agentsMdStat1 = await fs.stat(agentsMdPath);

      // Wait a bit to ensure different timestamps if files are rewritten
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Second apply with same rules
      await agent.applySkillerConfig(rules, projectRoot, null);

      // Get modification time again
      const agentsMdStat2 = await fs.stat(agentsMdPath);

      // File should not have been modified (idempotency)
      expect(agentsMdStat1.mtime.getTime()).toBe(agentsMdStat2.mtime.getTime());
    } finally {
      await teardownTestProject(projectRoot);
    }
  });

  it('should support native skills', () => {
    const agent = new CopilotAgent();
    expect(agent.supportsNativeSkills?.()).toBe(true);
  });

  it('should return .agents/skills path', () => {
    const agent = new CopilotAgent();
    const projectRoot = '/test/project';
    expect(agent.getSkillsPath?.(projectRoot)).toBe(
      '/test/project/.agents/skills',
    );
  });
});
