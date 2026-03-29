import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  getCanonicalSkillsDir,
  migrateLegacyProjectState,
  readUpstreamOwnedSkillNames,
  resolveSkillOwnership,
} from '../../../src/core/SkillOwnership';

describe('SkillOwnership', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skiller-ownership-'));
    await fs.mkdir(path.join(tmpDir, '.agents'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('reads upstream-owned skill names from skills-lock.json', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'skills-lock.json'),
      JSON.stringify(
        {
          version: 1,
          skills: {
            vendorSkill: {
              source: 'skills',
              sourceType: 'node_modules',
              computedHash: 'abc',
            },
            anotherSkill: {
              source: 'skills',
              sourceType: 'node_modules',
              computedHash: 'def',
            },
            'ce:review': {
              source: 'skills',
              sourceType: 'node_modules',
              computedHash: 'ghi',
            },
          },
        },
        null,
        2,
      ),
    );

    const names = await readUpstreamOwnedSkillNames(tmpDir);
    expect([...names]).toEqual(['anotherSkill', 'ce-review', 'vendorSkill']);
  });

  it('ignores stale .agents/.skiller.json localSkills without matching rule files', async () => {
    await fs.writeFile(
      path.join(tmpDir, '.agents', '.skiller.json'),
      JSON.stringify(
        {
          version: 1,
          targets: {},
          localSkills: ['local-skill'],
        },
        null,
        2,
      ),
    );

    const ownership = await resolveSkillOwnership(tmpDir);
    expect([...ownership.localOwned]).toEqual([]);
    expect([...ownership.orphaned]).toEqual([]);
    expect(ownership.conflicts).toEqual([]);
  });

  it('treats .agents/rules sources as local-owned even without manifest localSkills', async () => {
    await fs.mkdir(path.join(tmpDir, '.agents', 'rules'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.agents', 'rules', 'rule-owned.mdc'),
      `---
description: Rule owned
---

# Rule owned
`,
    );

    const ownership = await resolveSkillOwnership(tmpDir);
    expect([...ownership.localOwned]).toEqual(['rule-owned']);
    expect([...ownership.orphaned]).toEqual([]);
  });

  it('classifies canonical skills with no explicit ownership as orphaned and warns', async () => {
    const orphanSkillDir = path.join(
      tmpDir,
      '.agents',
      'skills',
      'orphan-skill',
    );
    await fs.mkdir(orphanSkillDir, { recursive: true });
    await fs.writeFile(
      path.join(orphanSkillDir, 'SKILL.md'),
      `---
name: orphan-skill
description: Orphaned skill
---

# Orphaned skill
`,
    );

    const ownership = await resolveSkillOwnership(tmpDir);
    expect([...ownership.orphaned]).toEqual(['orphan-skill']);
    expect(ownership.warnings).toContain(
      "Canonical skill 'orphan-skill' is unmanaged; leaving it untouched because it is not in skills-lock.json or .agents/rules/orphan-skill.mdc.",
    );
  });

  it('ignores stale manifest localSkills when the same skill is upstream-owned', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'skills-lock.json'),
      JSON.stringify(
        {
          version: 1,
          skills: {
            shared: {
              source: 'skills',
              sourceType: 'node_modules',
              computedHash: 'abc',
            },
          },
        },
        null,
        2,
      ),
    );
    await fs.writeFile(
      path.join(tmpDir, '.agents', '.skiller.json'),
      JSON.stringify(
        {
          version: 1,
          targets: {},
          localSkills: ['shared'],
        },
        null,
        2,
      ),
    );

    const ownership = await resolveSkillOwnership(tmpDir);
    expect(ownership.conflicts).toEqual([]);
    expect(ownership.warnings).toEqual([]);
  });

  it('uses .agents/skills as the canonical skills directory', async () => {
    expect(getCanonicalSkillsDir(tmpDir)).toBe(
      path.join(tmpDir, '.agents', 'skills'),
    );
  });

  it('migrates legacy .claude project state into .agents and localizes rules as skills', async () => {
    await fs.mkdir(path.join(tmpDir, '.claude', 'skills', 'legacy-skill'), {
      recursive: true,
    });
    await fs.mkdir(path.join(tmpDir, '.claude', 'rules'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.claude', 'skiller.toml'),
      'default_agents = ["codex"]\n',
    );
    await fs.writeFile(
      path.join(tmpDir, '.claude', 'AGENTS.md'),
      '# Legacy instructions\n',
    );
    await fs.writeFile(
      path.join(tmpDir, '.claude', '.skiller.json'),
      JSON.stringify(
        {
          version: 1,
          targets: {},
          localSkills: ['preexisting-local'],
        },
        null,
        2,
      ),
    );
    await fs.writeFile(
      path.join(tmpDir, '.claude', 'skills', 'legacy-skill', 'SKILL.md'),
      `---
name: legacy-skill
description: Legacy skill
---

# Legacy Skill

Still works.
`,
    );
    await fs.writeFile(
      path.join(tmpDir, '.claude', 'rules', 'always-rule.mdc'),
      `---
description: Legacy always rule
alwaysApply: true
---

# Always Rule
`,
    );

    await migrateLegacyProjectState(tmpDir, false);

    expect(
      await fs.readFile(path.join(tmpDir, '.agents', 'skiller.toml'), 'utf8'),
    ).toContain('default_agents = ["codex"]');
    expect(
      await fs.readFile(path.join(tmpDir, '.agents', 'AGENTS.md'), 'utf8'),
    ).toContain('# Legacy instructions');
    expect(
      await fs.readFile(
        path.join(tmpDir, '.agents', 'rules', 'legacy-skill.mdc'),
        'utf8',
      ),
    ).toContain('# Legacy Skill');
    expect(
      await fs.readFile(
        path.join(tmpDir, '.agents', 'skills', 'legacy-skill', 'SKILL.md'),
        'utf8',
      ),
    ).toContain('source: .agents/rules/legacy-skill.mdc');
    expect(
      await fs.readFile(
        path.join(tmpDir, '.agents', 'rules', 'always-rule.mdc'),
        'utf8',
      ),
    ).toContain('# Always Rule');
    expect(
      await fs.readFile(
        path.join(tmpDir, '.agents', 'skills', 'always-rule', 'SKILL.md'),
        'utf8',
      ),
    ).toContain('# Always Rule');
    await expect(
      fs.access(path.join(tmpDir, '.agents', '.skiller.json')),
    ).rejects.toThrow();

    await expect(
      fs.access(path.join(tmpDir, '.claude', 'skiller.toml')),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(tmpDir, '.claude', 'AGENTS.md')),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(tmpDir, '.claude', '.skiller.json')),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(tmpDir, '.claude', 'skills')),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(tmpDir, '.claude', 'rules')),
    ).rejects.toThrow();
  });

  it('drops legacy duplicates when canonical files already match', async () => {
    await fs.writeFile(
      path.join(tmpDir, '.agents', 'AGENTS.md'),
      '# Same instructions\n',
    );
    await fs.mkdir(path.join(tmpDir, '.claude'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.claude', 'AGENTS.md'),
      '# Same instructions\n',
    );

    await migrateLegacyProjectState(tmpDir, false);

    expect(
      await fs.readFile(path.join(tmpDir, '.agents', 'AGENTS.md'), 'utf8'),
    ).toBe('# Same instructions\n');
    await expect(
      fs.access(path.join(tmpDir, '.claude', 'AGENTS.md')),
    ).rejects.toThrow();
  });

  it('does not re-extract local rules from .claude mirrors after canonical migration already exists', async () => {
    await fs.mkdir(path.join(tmpDir, '.claude', 'commands'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.claude', 'commands', 'noop.md'),
      '# native extra\n',
    );

    const canonicalSkillDir = path.join(
      tmpDir,
      '.agents',
      'skills',
      'ghost-skill',
    );
    await fs.mkdir(canonicalSkillDir, { recursive: true });
    await fs.writeFile(
      path.join(canonicalSkillDir, 'SKILL.md'),
      `---
name: ghost-skill
description: Ghost skill
metadata:
  skiller:
    source: .agents/rules/ghost-skill.mdc
---

# Ghost skill
`,
    );
    await fs.mkdir(path.join(tmpDir, '.claude', 'skills', 'ghost-skill'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(tmpDir, '.claude', 'skills', 'ghost-skill', 'SKILL.md'),
      `---
name: ghost-skill
description: Ghost skill
---

# Ghost skill
`,
    );

    await migrateLegacyProjectState(tmpDir, false);

    await expect(
      fs.access(path.join(tmpDir, '.agents', 'rules', 'ghost-skill.mdc')),
    ).rejects.toThrow();
  });

  it('rewrites legacy agent ids when migrating skiller.toml', async () => {
    await fs.mkdir(path.join(tmpDir, '.claude'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.claude', 'skiller.toml'),
      `default_agents = ["claude", "codex"]

[agents.claude]
enabled = true

[agents.qwen]
enabled = false
`,
    );

    await migrateLegacyProjectState(tmpDir, false);

    const migratedToml = await fs.readFile(
      path.join(tmpDir, '.agents', 'skiller.toml'),
      'utf8',
    );
    expect(migratedToml).toContain('"claude-code"');
    expect(migratedToml).toContain('[agents.claude-code]');
    expect(migratedToml).toContain('[agents.qwen-code]');
    expect(migratedToml).not.toContain('[agents.claude]');
    expect(migratedToml).not.toContain('[agents.qwen]');
  });

  it('fails loudly when legacy and canonical project state conflict', async () => {
    await fs.writeFile(
      path.join(tmpDir, '.agents', 'AGENTS.md'),
      '# Canonical instructions\n',
    );
    await fs.mkdir(path.join(tmpDir, '.claude'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.claude', 'AGENTS.md'),
      '# Legacy instructions\n',
    );

    await expect(migrateLegacyProjectState(tmpDir, false)).rejects.toThrow(
      '.claude/AGENTS.md',
    );
  });

  it('ignores legacy .claude skill folders when canonical .agents skills already exist', async () => {
    await fs.mkdir(path.join(tmpDir, '.claude', 'skills', 'ai'), {
      recursive: true,
    });
    await fs.mkdir(path.join(tmpDir, '.agents', 'skills', 'ai'), {
      recursive: true,
    });

    await fs.writeFile(
      path.join(tmpDir, '.claude', 'skills', 'ai', 'ai.mdc'),
      '# AI Skill\n\nExpanded body.\n',
    );
    await fs.writeFile(
      path.join(tmpDir, '.claude', 'skills', 'ai', 'SKILL.md'),
      `---
name: ai
description: AI skill
---

@.claude/skills/ai/ai.mdc
`,
    );
    await fs.writeFile(
      path.join(tmpDir, '.agents', 'skills', 'ai', 'SKILL.md'),
      `---
name: ai
description: AI skill
---

# AI Skill

Expanded body.
`,
    );

    await migrateLegacyProjectState(tmpDir, false);

    const canonicalSkill = await fs.readFile(
      path.join(tmpDir, '.agents', 'skills', 'ai', 'SKILL.md'),
      'utf8',
    );
    expect(canonicalSkill).toContain('Expanded body.');
    expect(canonicalSkill).not.toContain('source: .agents/rules/ai.mdc');
    await expect(
      fs.access(path.join(tmpDir, '.agents', 'rules', 'ai.mdc')),
    ).rejects.toThrow();
    await expect(fs.access(path.join(tmpDir, '.claude', 'skills', 'ai')))
      .resolves.toBeUndefined();
  });

  it('leaves .claude skill mirrors alone when canonical .agents skills already exist', async () => {
    await fs.mkdir(path.join(tmpDir, '.claude', 'skills', 'react'), {
      recursive: true,
    });
    await fs.mkdir(path.join(tmpDir, '.agents', 'skills', 'react'), {
      recursive: true,
    });

    await fs.writeFile(
      path.join(tmpDir, '.claude', 'skills', 'react', 'SKILL.md'),
      `---
name: react
description: Legacy react
---

@.claude/skills/react/react.mdc
`,
    );
    await fs.writeFile(
      path.join(tmpDir, '.claude', 'skills', 'react', 'react.mdc'),
      '# stale legacy react\n',
    );
    await fs.writeFile(
      path.join(tmpDir, '.agents', 'skills', 'react', 'SKILL.md'),
      `---
name: react
description: Canonical react
---

# canonical react
`,
    );

    await migrateLegacyProjectState(tmpDir, false);

    expect(
      await fs.readFile(
        path.join(tmpDir, '.agents', 'skills', 'react', 'SKILL.md'),
        'utf8',
      ),
    ).toContain('Canonical react');
    await expect(fs.access(path.join(tmpDir, '.claude', 'skills', 'react')))
      .resolves.toBeUndefined();
  });
});
