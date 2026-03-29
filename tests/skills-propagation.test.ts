import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { ClaudeAgent } from '../src/agents/ClaudeAgent';
import { CodexCliAgent } from '../src/agents/CodexCliAgent';
import {
  compileRulesToSkills,
  discoverSkills,
  extractLocalRulesFromCanonicalSkills,
  isReferenceBody,
  normalizeCanonicalSkills,
  propagateSkills,
} from '../src/core/SkillsProcessor';
import { SKILL_MD_FILENAME } from '../src/constants';

describe('skills propagation', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skiller-skills-test-'));
    await fs.mkdir(path.join(tmpDir, '.agents'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('detects wrapper-style @references', () => {
    const result = isReferenceBody('@.agents/skills/my-skill/my-skill.mdc');
    expect(result.isReference).toBe(true);
    expect(result.referencePath).toBe('.agents/skills/my-skill/my-skill.mdc');
  });

  it('discovers canonical skills in .agents/skills and deletes invalid folders', async () => {
    const skillsDir = path.join(tmpDir, '.agents', 'skills');
    const validSkill = path.join(skillsDir, 'valid-skill');
    const invalidSkill = path.join(skillsDir, 'invalid-skill');

    await fs.mkdir(validSkill, { recursive: true });
    await fs.mkdir(invalidSkill, { recursive: true });
    await fs.writeFile(
      path.join(validSkill, SKILL_MD_FILENAME),
      `---
name: valid-skill
description: Valid
---

# Valid`,
    );
    await fs.writeFile(path.join(invalidSkill, 'README.md'), 'not a skill');

    const result = await discoverSkills(tmpDir);

    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].name).toBe('valid-skill');
    expect(result.deleted).toEqual(['invalid-skill']);
    await expect(fs.access(invalidSkill)).rejects.toThrow();
  });

  it('compiles local .agents/rules sources into plain canonical SKILL.md files', async () => {
    const rulesDir = path.join(tmpDir, '.agents', 'rules');
    await fs.mkdir(rulesDir, { recursive: true });
    await fs.writeFile(
      path.join(rulesDir, 'local-skill.mdc'),
      `---
description: Local skill
alwaysApply: true
argument-hint: "[topic]"
---

# Local Skill

Use this well.`,
    );

    const result = await compileRulesToSkills(
      path.join(tmpDir, '.agents'),
      tmpDir,
      false,
      false,
    );

    expect(result.compiled).toEqual(['local-skill']);

    const skillMd = await fs.readFile(
      path.join(tmpDir, '.agents', 'skills', 'local-skill', 'SKILL.md'),
      'utf8',
    );
    expect(skillMd).toContain('name: local-skill');
    expect(skillMd).toContain('description: Local skill');
    expect(skillMd).toContain("argument-hint: '[topic]'");
    expect(skillMd).toContain('source: .agents/rules/local-skill.mdc');
    expect(skillMd).toContain('alwaysApply: true');
    expect(skillMd).toContain('# Local Skill');
    expect(skillMd).not.toContain(
      '@.agents/skills/local-skill/local-skill.mdc',
    );

    await expect(
      fs.access(
        path.join(
          tmpDir,
          '.agents',
          'skills',
          'local-skill',
          'local-skill.mdc',
        ),
      ),
    ).rejects.toThrow();

    const manifest = JSON.parse(
      await fs.readFile(path.join(tmpDir, '.agents', '.skiller.json'), 'utf8'),
    ) as { localSkills: string[] };
    expect(manifest.localSkills).toEqual(['local-skill']);
  });

  it('inlines embedded reference directives when compiling local rules', async () => {
    const rulesDir = path.join(tmpDir, '.agents', 'rules');
    const ruleRefsDir = path.join(rulesDir, 'references');
    await fs.mkdir(ruleRefsDir, { recursive: true });
    await fs.writeFile(
      path.join(ruleRefsDir, 'persona.md'),
      `# Persona Catalog

- Reviewer A
- Reviewer B

# Other Section

Ignore me.`,
    );
    await fs.writeFile(
      path.join(rulesDir, 'review-skill.mdc'),
      `---
description: Review skill
---

# Review Skill

## Included References

@./references/persona.md#Persona Catalog
`,
    );

    await compileRulesToSkills(
      path.join(tmpDir, '.agents'),
      tmpDir,
      false,
      false,
    );

    const skillMd = await fs.readFile(
      path.join(tmpDir, '.agents', 'skills', 'review-skill', 'SKILL.md'),
      'utf8',
    );
    expect(skillMd).toContain('- Reviewer A');
    expect(skillMd).toContain('- Reviewer B');
    expect(skillMd).not.toContain('@./references/persona.md#Persona Catalog');
    expect(skillMd).not.toContain('Ignore me.');
  });

  it('fails when a local rule collides with an upstream-managed skill name', async () => {
    const rulesDir = path.join(tmpDir, '.agents', 'rules');
    await fs.mkdir(rulesDir, { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, 'skills-lock.json'),
      JSON.stringify(
        {
          version: 1,
          skills: {
            conflict: {
              source: 'skills',
              sourceType: 'github',
              computedHash: 'abc',
            },
          },
        },
        null,
        2,
      ),
    );
    await fs.writeFile(
      path.join(rulesDir, 'conflict.mdc'),
      `---
description: No chance
---

# Nope`,
    );

    await expect(
      compileRulesToSkills(path.join(tmpDir, '.agents'), tmpDir, false, false),
    ).rejects.toThrow(
      "Local rule 'conflict' conflicts with upstream-managed skill 'conflict'",
    );
  });

  it('extracts orphan canonical skills into local rules and adopts them', async () => {
    const skillDir = path.join(tmpDir, '.agents', 'skills', 'orphan-skill');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, 'SKILL.md'),
      `---
name: orphan-skill
description: Orphan skill
---

# Orphan body`,
    );

    const result = await extractLocalRulesFromCanonicalSkills(
      tmpDir,
      false,
      false,
    );

    expect(result.extracted).toEqual(['orphan-skill']);

    const ruleContent = await fs.readFile(
      path.join(tmpDir, '.agents', 'rules', 'orphan-skill.mdc'),
      'utf8',
    );
    expect(ruleContent).toContain('description: Orphan skill');
    expect(ruleContent).toContain('# Orphan body');

    const manifest = JSON.parse(
      await fs.readFile(path.join(tmpDir, '.agents', '.skiller.json'), 'utf8'),
    ) as { localSkills: string[] };
    expect(manifest.localSkills).toEqual(['orphan-skill']);
  });

  it('extracts nested-frontmatter canonical skills into a single-frontmatter local rule', async () => {
    const skillDir = path.join(tmpDir, '.agents', 'skills', 'linear');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, 'SKILL.md'),
      `---
description: 'Command: linear'
name: linear
metadata:
  skiller:
    source: .agents/rules/linear.mdc
---

---
name: linear
description: Work a Linear ticket end-to-end
argument-hint: "[Linear issue id/link]"
disable-model-invocation: true
---

# Work Linear Ticket`,
    );

    const result = await extractLocalRulesFromCanonicalSkills(
      tmpDir,
      false,
      false,
    );

    expect(result.extracted).toEqual(['linear']);

    const ruleContent = await fs.readFile(
      path.join(tmpDir, '.agents', 'rules', 'linear.mdc'),
      'utf8',
    );
    expect(ruleContent).toContain(
      'description: Work a Linear ticket end-to-end',
    );
    expect(ruleContent).toContain("argument-hint: '[Linear issue id/link]'");
    expect(ruleContent).not.toContain("description: 'Command: linear'");
    expect(ruleContent).not.toContain('\n---\n\n---\n');
  });

  it('does not extract canonical skills that are upstream-owned via normalized lock names', async () => {
    const skillDir = path.join(tmpDir, '.agents', 'skills', 'ce-review');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, 'skills-lock.json'),
      JSON.stringify(
        {
          version: 1,
          skills: {
            'ce:review': {
              source: 'skills',
              sourceType: 'github',
              computedHash: 'abc',
            },
          },
        },
        null,
        2,
      ),
    );
    await fs.writeFile(
      path.join(skillDir, 'SKILL.md'),
      `---
name: ce:review
description: Upstream ce review
---

# Upstream body`,
    );

    const result = await extractLocalRulesFromCanonicalSkills(
      tmpDir,
      false,
      false,
    );

    expect(result.extracted).toEqual([]);
    await expect(
      fs.readFile(path.join(tmpDir, '.agents', 'rules', 'ce-review.mdc')),
    ).rejects.toThrow();
  });

  it('normalizes malformed local rule sources with nested frontmatter during compile', async () => {
    const rulesDir = path.join(tmpDir, '.agents', 'rules');
    await fs.mkdir(rulesDir, { recursive: true });
    await fs.writeFile(
      path.join(rulesDir, 'linear.mdc'),
      `---
description: 'Command: linear'
---

---
name: linear
description: Work a Linear ticket end-to-end
argument-hint: "[Linear issue id/link]"
disable-model-invocation: true
---

# Work Linear Ticket`,
    );

    const result = await compileRulesToSkills(
      path.join(tmpDir, '.agents'),
      tmpDir,
      false,
      false,
    );

    expect(result.compiled).toEqual(['linear']);

    const cleanedRule = await fs.readFile(
      path.join(rulesDir, 'linear.mdc'),
      'utf8',
    );
    expect(cleanedRule).toContain(
      'description: Work a Linear ticket end-to-end',
    );
    expect(cleanedRule).not.toContain("description: 'Command: linear'");
    expect(cleanedRule).not.toContain('\n---\n\n---\n');

    const skillMd = await fs.readFile(
      path.join(tmpDir, '.agents', 'skills', 'linear', 'SKILL.md'),
      'utf8',
    );
    expect(skillMd).toContain('name: linear');
    expect(skillMd).toContain('description: Work a Linear ticket end-to-end');
    expect(skillMd).not.toContain("description: 'Command: linear'");
    expect(skillMd).not.toContain('\n---\n\n---\n');
  });

  it('normalizes legacy wrapper skills into plain SKILL.md and removes sidecars', async () => {
    const skillsDir = path.join(tmpDir, '.agents', 'skills');
    const skillDir = path.join(skillsDir, 'legacy-skill');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, 'legacy-skill.mdc'),
      `---
description: Legacy
alwaysApply: true
---

# Legacy body`,
    );
    await fs.writeFile(
      path.join(skillDir, 'SKILL.md'),
      `---
name: legacy-skill
description: Legacy
---

@.agents/skills/legacy-skill/legacy-skill.mdc
`,
    );

    const result = await normalizeCanonicalSkills(
      tmpDir,
      skillsDir,
      false,
      false,
    );

    expect(result.normalized).toContain('legacy-skill');

    const skillMd = await fs.readFile(path.join(skillDir, 'SKILL.md'), 'utf8');
    expect(skillMd).toContain('# Legacy body');
    expect(skillMd).not.toContain(
      '@.agents/skills/legacy-skill/legacy-skill.mdc',
    );
    await expect(
      fs.access(path.join(skillDir, 'legacy-skill.mdc')),
    ).rejects.toThrow();
  });

  it('normalizes canonical skills by inlining embedded reference directives', async () => {
    const skillsDir = path.join(tmpDir, '.agents', 'skills');
    const skillDir = path.join(skillsDir, 'inline-refs');
    const refsDir = path.join(skillDir, 'references');
    await fs.mkdir(refsDir, { recursive: true });
    await fs.writeFile(
      path.join(refsDir, 'template.md'),
      `# Template

This content should be inlined.`,
    );
    await fs.writeFile(
      path.join(skillDir, 'SKILL.md'),
      `---
name: inline-refs
description: Inline refs
---

# Inline Refs

@./references/template.md
`,
    );

    const result = await normalizeCanonicalSkills(
      tmpDir,
      skillsDir,
      false,
      false,
    );

    expect(result.normalized).toContain('inline-refs');
    const skillMd = await fs.readFile(path.join(skillDir, 'SKILL.md'), 'utf8');
    expect(skillMd).toContain('This content should be inlined.');
    expect(skillMd).not.toContain('@./references/template.md');
  });

  it('compiles a legacy canonical skill that only has a sidecar .mdc and no SKILL.md', async () => {
    const skillsDir = path.join(tmpDir, '.agents', 'skills');
    const skillDir = path.join(skillsDir, 'legacy-only-mdc');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, 'legacy-only-mdc.mdc'),
      `---
description: Legacy only
alwaysApply: true
---

# Legacy only body`,
    );

    const result = await normalizeCanonicalSkills(
      tmpDir,
      skillsDir,
      false,
      false,
    );

    expect(result.normalized).toContain('legacy-only-mdc');

    const skillMd = await fs.readFile(path.join(skillDir, 'SKILL.md'), 'utf8');
    expect(skillMd).toContain('name: legacy-only-mdc');
    expect(skillMd).toContain('description: Legacy only');
    expect(skillMd).toContain(
      'source: .agents/skills/legacy-only-mdc/legacy-only-mdc.mdc',
    );
    expect(skillMd).toContain('alwaysApply: true');
    expect(skillMd).toContain('# Legacy only body');
    await expect(
      fs.access(path.join(skillDir, 'legacy-only-mdc.mdc')),
    ).rejects.toThrow();
  });

  it('creates local rules for orphan canonical skills during propagation', async () => {
    const canonicalSkillDir = path.join(
      tmpDir,
      '.agents',
      'skills',
      'plain-local',
    );
    await fs.mkdir(canonicalSkillDir, { recursive: true });
    await fs.writeFile(
      path.join(canonicalSkillDir, 'SKILL.md'),
      `---
name: plain-local
description: Plain local skill
---

# Plain local body`,
    );

    const agents = [new ClaudeAgent(), new CodexCliAgent()];

    await propagateSkills(
      tmpDir,
      agents,
      true,
      false,
      false,
      path.join(tmpDir, '.agents'),
    );

    const extractedRule = await fs.readFile(
      path.join(tmpDir, '.agents', 'rules', 'plain-local.mdc'),
      'utf8',
    );
    expect(extractedRule).toContain('description: Plain local skill');
    expect(extractedRule).toContain('# Plain local body');

    const canonicalSkill = await fs.readFile(
      path.join(tmpDir, '.agents', 'skills', 'plain-local', 'SKILL.md'),
      'utf8',
    );
    expect(canonicalSkill).toContain('source: .agents/rules/plain-local.mdc');
    expect(canonicalSkill).toContain('# Plain local body');
  });
});
