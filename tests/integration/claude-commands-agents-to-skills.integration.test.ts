import * as fs from 'fs/promises';
import * as path from 'path';
import { applyAllAgentConfigs } from '../../src/lib';
import { setupTestProject, teardownTestProject } from '../harness';

describe('Claude Project Commands/Agents → Agent Skills (Integration)', () => {
  let testProject: { projectRoot: string };

  beforeEach(async () => {
    testProject = await setupTestProject({
      '.claude/AGENTS.md': '# Test',
      '.claude/skiller.toml': `
default_agents = ["codex"]

[skills]
enabled = true
`,
      '.claude/commands/do-thing.md': `---
description: Do the thing
argument-hint: [FOO=bar]
---

Do something with $FOO.
`,
      '.claude/agents/framework-docs-researcher.md': `---
name: framework-docs-researcher
description: Research framework docs
model: inherit
---

Find docs and summarize.
`,
    });
  });

  afterEach(async () => {
    await teardownTestProject(testProject.projectRoot);
  });

  it('syncs .claude/commands + .claude/agents as skills into .agents/skills even when .claude/skills is missing', async () => {
    const { projectRoot } = testProject;

    // Ensure .claude/skills does NOT exist
    await fs.rm(path.join(projectRoot, '.claude', 'skills'), {
      recursive: true,
      force: true,
    });

    await applyAllAgentConfigs(
      projectRoot,
      ['codex'],
      undefined,
      false, // mcp disabled
      undefined,
      false, // gitignore disabled (avoid noise)
      false,
      false,
      true, // localOnly
      false,
      false,
      true, // skills enabled
    );

    await expect(
      fs.access(
        path.join(projectRoot, '.agents', 'skills', 'do-thing', 'SKILL.md'),
      ),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(
        path.join(
          projectRoot,
          '.agents',
          'skills',
          'framework-docs-researcher',
          'SKILL.md',
        ),
      ),
    ).resolves.toBeUndefined();
  });
});
