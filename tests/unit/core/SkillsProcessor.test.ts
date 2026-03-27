import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { ClaudeAgent } from '../../../src/agents/ClaudeAgent';
import { CodexCliAgent } from '../../../src/agents/CodexCliAgent';
import { CopilotAgent } from '../../../src/agents/CopilotAgent';

describe('Skills Processor', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skills-processor-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('copySkillsToAgent', () => {
    it('should copy single skill folder with SKILL.md', async () => {
      // Setup source skills
      const sourceDir = path.join(tmpDir, 'source');
      const targetDir = path.join(tmpDir, 'target');
      const skillDir = path.join(sourceDir, 'test-skill');

      await fs.mkdir(skillDir, { recursive: true });
      const skillContent = `---
name: test-skill
description: Test skill
---

# Test Skill`;
      await fs.writeFile(path.join(skillDir, 'SKILL.md'), skillContent);

      const { copySkillsToAgent } = await import(
        '../../../src/core/SkillsProcessor'
      );

      const result = await copySkillsToAgent(
        sourceDir,
        targetDir,
        tmpDir,
        false,
        false,
      );

      expect(result.copied).toBe(1);
      expect(result.warnings).toHaveLength(0);

      // Verify skill was copied
      const targetSkillPath = path.join(targetDir, 'test-skill', 'SKILL.md');
      const content = await fs.readFile(targetSkillPath, 'utf8');
      expect(content).toContain('Test Skill');
      expect(content).toContain('name: test-skill');
    });

    it('should compile @reference SKILL.md and exclude .mdc when copying to other agents', async () => {
      const sourceDir = path.join(tmpDir, '.claude', 'skills');
      const targetDir = path.join(tmpDir, '.agents', 'skills');
      const skillDir = path.join(sourceDir, 'test-skill');

      await fs.mkdir(skillDir, { recursive: true });

      // SKILL.md wrapper pointing to sibling .mdc (Claude-only)
      const skillContent = `---
name: test-skill
description: Test skill
---

@.claude/skills/test-skill/test-skill.mdc
`;
      await fs.writeFile(path.join(skillDir, 'SKILL.md'), skillContent);

      // .mdc content should be compiled into SKILL.md for non-Claude agents
      const mdcContent = `# Test Skill

This is a test skill.`;
      await fs.writeFile(path.join(skillDir, 'test-skill.mdc'), mdcContent);

      // Non-mdc resources must still be copied
      await fs.writeFile(
        path.join(skillDir, 'helper.js'),
        'console.log("helper");',
      );

      const { copySkillsToAgent } = await import(
        '../../../src/core/SkillsProcessor'
      );

      const result = await copySkillsToAgent(
        sourceDir,
        targetDir,
        tmpDir,
        false,
        false,
      );

      expect(result.copied).toBe(1);
      expect(result.warnings).toHaveLength(0);

      const targetSkillPath = path.join(targetDir, 'test-skill', 'SKILL.md');
      const compiled = await fs.readFile(targetSkillPath, 'utf8');
      expect(compiled).toContain('# Test Skill');
      expect(compiled).toContain('This is a test skill.');
      expect(compiled).not.toContain(
        '@.claude/skills/test-skill/test-skill.mdc',
      );

      await expect(
        fs.access(path.join(targetDir, 'test-skill', 'test-skill.mdc')),
      ).rejects.toThrow();

      expect(
        await fs.readFile(
          path.join(targetDir, 'test-skill', 'helper.js'),
          'utf8',
        ),
      ).toBe('console.log("helper");');
    });

    it('should flatten nested skill folders when copying to other agents', async () => {
      const sourceDir = path.join(tmpDir, 'source');
      const targetDir = path.join(tmpDir, 'target');
      const nestedSkillDir = path.join(sourceDir, 'category', 'test-skill');

      await fs.mkdir(nestedSkillDir, { recursive: true });
      const skillContent = `---
name: test-skill
description: Nested skill
---

# Nested Skill`;
      await fs.writeFile(path.join(nestedSkillDir, 'SKILL.md'), skillContent);
      await fs.writeFile(
        path.join(nestedSkillDir, 'helper.js'),
        'console.log("helper");',
      );

      const { copySkillsToAgent } = await import(
        '../../../src/core/SkillsProcessor'
      );

      const result = await copySkillsToAgent(
        sourceDir,
        targetDir,
        tmpDir,
        false,
        false,
      );

      expect(result.copied).toBe(1);

      // Verify nested structure flattened and SKILL.md renamed
      const targetSkillMd = path.join(
        targetDir,
        'category-test-skill',
        'SKILL.md',
      );
      const targetHelper = path.join(
        targetDir,
        'category-test-skill',
        'helper.js',
      );

      const copiedSkillMd = await fs.readFile(targetSkillMd, 'utf8');
      expect(copiedSkillMd).toContain('Nested Skill');
      expect(copiedSkillMd).toContain('name: category-test-skill');
      expect(await fs.readFile(targetHelper, 'utf8')).toBe(
        'console.log("helper");',
      );
    });

    it('should skip folders without SKILL.md', async () => {
      const sourceDir = path.join(tmpDir, 'source');
      const targetDir = path.join(tmpDir, 'target');
      const invalidSkillDir = path.join(sourceDir, 'invalid-skill');

      await fs.mkdir(invalidSkillDir, { recursive: true });
      await fs.writeFile(path.join(invalidSkillDir, 'other.md'), 'Not a skill');

      const { copySkillsToAgent } = await import(
        '../../../src/core/SkillsProcessor'
      );

      const result = await copySkillsToAgent(
        sourceDir,
        targetDir,
        tmpDir,
        false,
        false,
      );

      // walkSkillsTree deletes empty dirs, so no skills found and no warnings
      expect(result.copied).toBe(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('should respect dry-run flag and not create files', async () => {
      const sourceDir = path.join(tmpDir, 'source');
      const targetDir = path.join(tmpDir, 'target');
      const skillDir = path.join(sourceDir, 'test-skill');

      await fs.mkdir(skillDir, { recursive: true });
      const skillContent = `---
name: test-skill
description: Test skill
---

# Test Skill`;
      await fs.writeFile(path.join(skillDir, 'SKILL.md'), skillContent);

      const { copySkillsToAgent } = await import(
        '../../../src/core/SkillsProcessor'
      );

      const result = await copySkillsToAgent(
        sourceDir,
        targetDir,
        tmpDir,
        false,
        true,
      );

      expect(result.copied).toBe(1);

      // Verify no files created in dry-run
      await expect(fs.access(targetDir)).rejects.toThrow();
    });
  });

  describe('propagateSkills with multiple agents', () => {
    it('should copy skills to all agents with native skills support', async () => {
      // Setup source skills with proper YAML frontmatter
      const sourceDir = path.join(tmpDir, '.claude', 'skills');
      const skillDir = path.join(sourceDir, 'test-skill');

      await fs.mkdir(skillDir, { recursive: true });
      const skillContent = `---
name: test-skill
description: Test skill for unit testing
---

# Test Skill

This is a test skill.`;
      await fs.writeFile(path.join(skillDir, 'SKILL.md'), skillContent);

      const agents = [
        new ClaudeAgent(),
        new CodexCliAgent(),
        new CopilotAgent(),
      ];

      const { propagateSkills } = await import(
        '../../../src/core/SkillsProcessor'
      );

      await propagateSkills(tmpDir, agents, true, false, false);

      // Verify skills copied to the shared .agents/skills destination
      const codexSkillPath = path.join(
        tmpDir,
        '.agents',
        'skills',
        'test-skill',
        'SKILL.md',
      );
      const copiedContent = await fs.readFile(codexSkillPath, 'utf8');
      // Copied skills should be compiled for non-Claude agents (no @reference to .mdc)
      expect(copiedContent).toContain('name: test-skill');
      expect(copiedContent).toContain(
        'description: Test skill for unit testing',
      );
      expect(copiedContent).toContain('# Test Skill');
      expect(copiedContent).toContain('This is a test skill.');
      expect(copiedContent).not.toContain(
        '@.claude/skills/test-skill/test-skill.mdc',
      );

      await expect(
        fs.access(
          path.join(
            tmpDir,
            '.agents',
            'skills',
            'test-skill',
            'test-skill.mdc',
          ),
        ),
      ).rejects.toThrow();
    });

    it('should handle shared .agents/skills destinations across multiple agents', async () => {
      const sourceDir = path.join(tmpDir, '.claude', 'skills');
      const skillDir = path.join(sourceDir, 'test-skill');

      await fs.mkdir(skillDir, { recursive: true });
      const skillContent = `---
name: test-skill
description: Shared skill
---

# Shared Skill`;
      await fs.writeFile(path.join(skillDir, 'SKILL.md'), skillContent);

      const agents = [new CodexCliAgent(), new CopilotAgent()];

      const { propagateSkills } = await import(
        '../../../src/core/SkillsProcessor'
      );

      await propagateSkills(tmpDir, agents, true, false, false);

      const sharedSkillPath = path.join(
        tmpDir,
        '.agents',
        'skills',
        'test-skill',
        'SKILL.md',
      );
      const content = await fs.readFile(sharedSkillPath, 'utf8');
      expect(content).toContain('name: test-skill');
    });

    it('should skip agents without native skills support', async () => {
      const sourceDir = path.join(tmpDir, '.claude', 'skills');
      await fs.mkdir(sourceDir, { recursive: true });

      // Mock agent without skills support
      const mockAgent = {
        getIdentifier: () => 'mock',
        getName: () => 'Mock Agent',
        getDefaultOutputPath: () => '/mock/path',
        applySkillerConfig: async () => {},
        supportsNativeSkills: () => false,
        getSkillsPath: () => null,
      };

      const agents = [mockAgent as any];

      const { propagateSkills } = await import(
        '../../../src/core/SkillsProcessor'
      );

      // Should not throw, just skip silently
      await expect(
        propagateSkills(tmpDir, agents, true, false, false),
      ).resolves.not.toThrow();
    });

    it('should migrate legacy .codex/skills into .agents/skills for Codex', async () => {
      const sourceDir = path.join(tmpDir, '.claude', 'skills');
      await fs.mkdir(sourceDir, { recursive: true });

      const legacySkillDir = path.join(
        tmpDir,
        '.codex',
        'skills',
        'legacy-skill',
      );
      await fs.mkdir(legacySkillDir, { recursive: true });
      await fs.writeFile(
        path.join(legacySkillDir, 'SKILL.md'),
        `---
name: legacy-skill
description: Legacy Codex skill
---

Legacy content.
`,
      );

      const agents = [new CodexCliAgent()];

      const { propagateSkills } = await import(
        '../../../src/core/SkillsProcessor'
      );

      await propagateSkills(tmpDir, agents, true, false, false);

      await expect(
        fs.access(
          path.join(tmpDir, '.agents', 'skills', 'legacy-skill', 'SKILL.md'),
        ),
      ).resolves.toBeUndefined();
      await expect(
        fs.access(path.join(tmpDir, '.codex', 'skills', 'legacy-skill')),
      ).rejects.toThrow();
    });
  });

  describe('getSkillsGitignorePaths', () => {
    it('should collect paths from all agents with native skills', () => {
      const agents = [
        new ClaudeAgent(),
        new CodexCliAgent(),
        new CopilotAgent(),
      ];

      const {
        getSkillsGitignorePaths,
      } = require('../../../src/core/SkillsProcessor');

      const paths = getSkillsGitignorePaths(tmpDir, agents);

      // Should include .agents/skills but NOT .claude/skills (source)
      expect(paths).toContain('.agents/skills');
      expect(paths).not.toContain('.claude/skills');
    });

    it('should return relative paths from project root', () => {
      const agents = [new CodexCliAgent()];

      const {
        getSkillsGitignorePaths,
      } = require('../../../src/core/SkillsProcessor');

      const paths = getSkillsGitignorePaths(tmpDir, agents);

      // All paths should be relative
      paths.forEach((p: string) => {
        expect(p.startsWith('.')).toBe(true);
        expect(path.isAbsolute(p)).toBe(false);
      });
    });

    it('should handle agents returning null from getSkillsPath', () => {
      const mockAgent = {
        getIdentifier: () => 'mock',
        getName: () => 'Mock',
        supportsNativeSkills: () => true,
        getSkillsPath: () => null,
      };

      const agents = [mockAgent as any];

      const {
        getSkillsGitignorePaths,
      } = require('../../../src/core/SkillsProcessor');

      const paths = getSkillsGitignorePaths(tmpDir, agents);

      expect(paths).toHaveLength(0);
    });
  });
});
