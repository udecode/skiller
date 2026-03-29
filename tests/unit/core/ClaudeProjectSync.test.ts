import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { parseFrontmatter } from '../../../src/core/FrontmatterParser';

describe('Claude Project Commands/Agents → Skills Sync', () => {
  let tmpDir: string;
  let tmpHome: string;
  const originalHome = process.env.HOME;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skiller-claude-sync-'));
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'skiller-home-'));
    process.env.HOME = tmpHome;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.rm(tmpHome, { recursive: true, force: true });
  });

  it('syncs project .claude/commands + .claude/agents as skills into target skills dirs and cleans up when removed', async () => {
    const projectClaudeDir = path.join(tmpDir, '.claude');
    await fs.mkdir(path.join(projectClaudeDir, 'commands'), {
      recursive: true,
    });
    await fs.mkdir(path.join(projectClaudeDir, 'agents'), { recursive: true });

    await fs.writeFile(
      path.join(projectClaudeDir, 'commands', 'do-thing.md'),
      `---
description: Do the thing
argument-hint: [FOO=bar]
---

Do something with $FOO.
`,
    );

    await fs.writeFile(
      path.join(projectClaudeDir, 'agents', 'framework-docs-researcher.md'),
      `---
name: framework-docs-researcher
description: Research framework docs
model: inherit
---

Find docs and summarize.
`,
    );

    const targetSkillsDir = path.join(tmpDir, '.agents', 'skills');

    const { syncClaudeProjectCommandsAndAgentsToSkillsDirs } = await import(
      '../../../src/core/ClaudeProjectSync'
    );

    await syncClaudeProjectCommandsAndAgentsToSkillsDirs({
      projectRoot: tmpDir,
      targetSkillsDirs: [targetSkillsDir],
      verbose: false,
      dryRun: false,
    });

    const cmdSkillMd = await fs.readFile(
      path.join(targetSkillsDir, 'do-thing', 'SKILL.md'),
      'utf8',
    );
    const parsedCmd = parseFrontmatter(cmdSkillMd);
    expect(parsedCmd.rawFrontmatter?.name).toBe('do-thing');
    expect(parsedCmd.rawFrontmatter?.description).toBe('Do the thing');
    expect(parsedCmd.rawFrontmatter?.['argument-hint']).toEqual(['FOO=bar']);
    expect(parsedCmd.body).toContain('Do something with $FOO.');

    const agentSkillMd = await fs.readFile(
      path.join(targetSkillsDir, 'framework-docs-researcher', 'SKILL.md'),
      'utf8',
    );
    const parsedAgent = parseFrontmatter(agentSkillMd);
    expect(parsedAgent.rawFrontmatter?.name).toBe('framework-docs-researcher');
    expect(parsedAgent.rawFrontmatter?.description).toBe(
      'Research framework docs',
    );
    expect(parsedAgent.rawFrontmatter?.model).toBe('inherit');
    expect(parsedAgent.body).toContain('Find docs and summarize.');

    await expect(
      fs.access(path.join(tmpDir, '.agents', '.skiller.json')),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(targetSkillsDir, '.skiller.json')),
    ).rejects.toThrow();

    // Remove command and re-sync: should cleanup managed folder
    await fs.rm(path.join(projectClaudeDir, 'commands', 'do-thing.md'));

    await syncClaudeProjectCommandsAndAgentsToSkillsDirs({
      projectRoot: tmpDir,
      targetSkillsDirs: [targetSkillsDir],
      verbose: false,
      dryRun: false,
    });

    await expect(
      fs.access(path.join(targetSkillsDir, 'do-thing')),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(targetSkillsDir, 'framework-docs-researcher')),
    ).resolves.toBeUndefined();
  });

  it('discovers nested project commands recursively and flattens them to dash-separated names', async () => {
    const projectClaudeDir = path.join(tmpDir, '.claude');
    const nestedCommandsDir = path.join(
      projectClaudeDir,
      'commands',
      'workflows',
    );
    await fs.mkdir(nestedCommandsDir, { recursive: true });

    await fs.writeFile(
      path.join(nestedCommandsDir, 'brainstorm.md'),
      `---
description: Brainstorm
---

From nested project command.
`,
    );

    const targetSkillsDir = path.join(tmpDir, '.agents', 'skills');

    const { syncClaudeProjectCommandsAndAgentsToSkillsDirs } = await import(
      '../../../src/core/ClaudeProjectSync'
    );

    await syncClaudeProjectCommandsAndAgentsToSkillsDirs({
      projectRoot: tmpDir,
      targetSkillsDirs: [targetSkillsDir],
      verbose: false,
      dryRun: false,
    });

    const expectedDir = path.join(targetSkillsDir, 'workflows-brainstorm');
    const installedMd = await fs.readFile(
      path.join(expectedDir, 'SKILL.md'),
      'utf8',
    );
    expect(parseFrontmatter(installedMd).rawFrontmatter?.name).toBe(
      'workflows-brainstorm',
    );
    expect(parseFrontmatter(installedMd).body).toContain(
      'From nested project command.',
    );

    await expect(
      fs.access(path.join(targetSkillsDir, 'brainstorm')),
    ).rejects.toThrow();
  });

  it('namespaces project items only when they conflict with an existing (manual) skill', async () => {
    const projectClaudeDir = path.join(tmpDir, '.claude');
    await fs.mkdir(path.join(projectClaudeDir, 'commands'), {
      recursive: true,
    });

    await fs.writeFile(
      path.join(projectClaudeDir, 'commands', 'do-thing.md'),
      `---
description: Do the thing
---

Do something.
`,
    );

    const targetSkillsDir = path.join(tmpDir, '.claude', 'skills');

    // Simulate an existing manual skill already occupying the name.
    const manualDir = path.join(targetSkillsDir, 'do-thing');
    await fs.mkdir(manualDir, { recursive: true });
    await fs.writeFile(
      path.join(manualDir, 'SKILL.md'),
      `---
name: do-thing
description: Manual skill wins
---

Manual content.
`,
    );

    const { syncClaudeProjectCommandsAndAgentsToSkillsDirs } = await import(
      '../../../src/core/ClaudeProjectSync'
    );

    await syncClaudeProjectCommandsAndAgentsToSkillsDirs({
      projectRoot: tmpDir,
      targetSkillsDirs: [targetSkillsDir],
      verbose: false,
      dryRun: false,
    });

    // Manual skill remains unchanged
    const manualSkillMd = await fs.readFile(
      path.join(manualDir, 'SKILL.md'),
      'utf8',
    );
    expect(parseFrontmatter(manualSkillMd).body).toContain('Manual content.');

    // Project command is installed under a namespaced folder instead
    const projectDir = path.join(targetSkillsDir, 'claude-do-thing');
    await expect(
      fs.access(path.join(projectDir, 'SKILL.md')),
    ).resolves.toBeUndefined();
    const projectSkillMd = await fs.readFile(
      path.join(projectDir, 'SKILL.md'),
      'utf8',
    );
    expect(parseFrontmatter(projectSkillMd).rawFrontmatter?.name).toBe(
      'claude-do-thing',
    );
  });

  it('skips syncing a claude command when a canonical skill with the same name already exists', async () => {
    const projectClaudeDir = path.join(tmpDir, '.claude');
    await fs.mkdir(path.join(projectClaudeDir, 'commands'), {
      recursive: true,
    });

    await fs.writeFile(
      path.join(projectClaudeDir, 'commands', 'google-forms.md'),
      `---
description: Command copy
---

Command content.
`,
    );

    const canonicalSkillDir = path.join(
      tmpDir,
      '.agents',
      'skills',
      'google-forms',
    );
    await fs.mkdir(canonicalSkillDir, { recursive: true });
    await fs.writeFile(
      path.join(canonicalSkillDir, 'SKILL.md'),
      `---
name: google-forms
description: Canonical skill
---

Canonical content.
`,
    );

    const targetSkillsDir = path.join(tmpDir, '.claude', 'skills');
    const { syncClaudeProjectCommandsAndAgentsToSkillsDirs } = await import(
      '../../../src/core/ClaudeProjectSync'
    );

    await syncClaudeProjectCommandsAndAgentsToSkillsDirs({
      projectRoot: tmpDir,
      targetSkillsDirs: [targetSkillsDir],
      verbose: false,
      dryRun: false,
    });

    await expect(
      fs.access(path.join(targetSkillsDir, 'claude-google-forms')),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(targetSkillsDir, 'claude-google-forms-2')),
    ).rejects.toThrow();
  });

  it('skips syncing project items whose flattened names already exist as canonical skills', async () => {
    const projectClaudeDir = path.join(tmpDir, '.claude');
    await fs.mkdir(path.join(projectClaudeDir, 'commands'), {
      recursive: true,
    });

    await fs.writeFile(
      path.join(projectClaudeDir, 'commands', 'lfg.md'),
      `---
description: LFG
---

From project lfg.
`,
    );

    await fs.writeFile(
      path.join(projectClaudeDir, 'commands', 'workflows-lfg.md'),
      `---
description: Workflows LFG
---

From project workflows-lfg.
`,
    );

    // Nested local skill: .agents/skills/workflows/lfg (flattens to workflows-lfg)
    const localSkillDir = path.join(
      tmpDir,
      '.agents',
      'skills',
      'workflows',
      'lfg',
    );
    await fs.mkdir(path.join(tmpDir, '.agents'), { recursive: true });
    await fs.mkdir(localSkillDir, { recursive: true });
    await fs.writeFile(
      path.join(localSkillDir, 'SKILL.md'),
      `---
name: lfg
description: Local nested skill
---

Local nested content.
`,
    );
    await fs.writeFile(
      path.join(tmpDir, '.agents', '.skiller.json'),
      JSON.stringify(
        {
          version: 1,
          targets: {},
          localSkills: ['workflows-lfg'],
        },
        null,
        2,
      ),
    );

    const targetSkillsDir = path.join(tmpDir, '.agents', 'skills');
    const { syncClaudeProjectCommandsAndAgentsToSkillsDirs } = await import(
      '../../../src/core/ClaudeProjectSync'
    );

    await syncClaudeProjectCommandsAndAgentsToSkillsDirs({
      projectRoot: tmpDir,
      targetSkillsDirs: [targetSkillsDir],
      verbose: false,
      dryRun: false,
    });

    // Project 'lfg' can use its base name (no conflict with workflows-lfg)
    await expect(
      fs.access(path.join(targetSkillsDir, 'lfg', 'SKILL.md')),
    ).resolves.toBeUndefined();

    // Project 'workflows-lfg' conflicts with canonical nested (flattened) name, so it must be skipped
    await expect(
      fs.access(path.join(targetSkillsDir, 'claude-workflows-lfg')),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(targetSkillsDir, 'workflows-lfg')),
    ).rejects.toThrow();
  });
});
