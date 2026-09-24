import * as fs from 'fs/promises';
import * as path from 'path';
import {
  setupTestProject,
  teardownTestProject,
  runSkillerWithInheritedStdio,
} from '../harness';

describe('authored root AGENTS.md', () => {
  it('is used for projections without being rewritten or ignored', async () => {
    const { projectRoot } = await setupTestProject({
      'AGENTS.md': '# Shared instructions\n',
      '.agents/skiller.toml':
        'default_agents = ["claude-code", "codex", "cline"]\n',
      '.agents/extra.md': '# Supplemental rule\n',
      '.agents/AGENTS.md': '# Obsolete source\n',
    });
    try {
      runSkillerWithInheritedStdio('apply --no-skills', projectRoot);
      expect(
        await fs.readFile(path.join(projectRoot, 'AGENTS.md'), 'utf8'),
      ).toBe('# Shared instructions\n');
      const clineRules = await fs.readFile(
        path.join(projectRoot, '.clinerules'),
        'utf8',
      );
      expect(clineRules).toContain('# Shared instructions');
      expect(clineRules).toContain('# Supplemental rule');
      expect(clineRules).not.toContain('# Obsolete source');
      await expect(
        fs.stat(path.join(projectRoot, 'CLAUDE.md')),
      ).rejects.toThrow();
      const gitignore = await fs.readFile(
        path.join(projectRoot, '.gitignore'),
        'utf8',
      );
      expect(gitignore).not.toContain('/AGENTS.md');
      runSkillerWithInheritedStdio(
        'revert --agents claude-code,codex,cline',
        projectRoot,
      );
      expect(
        await fs.readFile(path.join(projectRoot, 'AGENTS.md'), 'utf8'),
      ).toBe('# Shared instructions\n');
    } finally {
      await teardownTestProject(projectRoot);
    }
  });

  it('does not create AGENTS.md when it is absent', async () => {
    const { projectRoot } = await setupTestProject({
      '.agents/skiller.toml': 'default_agents = ["claude-code", "codex"]\n',
      '.agents/extra.md': '# Supplemental rule\n',
    });
    try {
      runSkillerWithInheritedStdio('apply --no-skills', projectRoot);
      await expect(
        fs.stat(path.join(projectRoot, 'AGENTS.md')),
      ).rejects.toThrow();
      await expect(
        fs.stat(path.join(projectRoot, 'CLAUDE.md')),
      ).rejects.toThrow();
    } finally {
      await teardownTestProject(projectRoot);
    }
  });
});
