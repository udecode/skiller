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

    await expect(
      fs.access(path.join(tmpDir, '.agents', '.skiller.json')),
    ).rejects.toThrow();
  });

  it('removes stale localSkills-only manifests when their .mdc sources were deleted', async () => {
    const rulesDir = path.join(tmpDir, '.agents', 'rules');
    const upstreamSkillDir = path.join(
      tmpDir,
      '.agents',
      'skills',
      'find-skills',
    );
    await fs.mkdir(rulesDir, { recursive: true });
    await fs.mkdir(upstreamSkillDir, { recursive: true });

    await fs.writeFile(
      path.join(rulesDir, 'local-skill.mdc'),
      `---
description: Local skill
---

# Local Skill`,
    );

    await fs.writeFile(
      path.join(upstreamSkillDir, 'SKILL.md'),
      `---
name: find-skills
description: Upstream installed skill
---

# Find Skills`,
    );

    await fs.writeFile(
      path.join(tmpDir, 'skills-lock.json'),
      JSON.stringify(
        {
          version: 1,
          skills: {
            'find-skills': {
              source: 'vercel-labs/skills',
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
      path.join(tmpDir, '.agents', '.skiller.json'),
      JSON.stringify(
        {
          version: 1,
          targets: {},
          localSkills: ['find-skills'],
        },
        null,
        2,
      ),
    );

    await propagateSkills(
      tmpDir,
      [new ClaudeAgent(), new CodexCliAgent()],
      true,
      false,
      false,
      path.join(tmpDir, '.agents'),
    );

    await expect(
      fs.access(path.join(tmpDir, '.agents', '.skiller.json')),
    ).rejects.toThrow();
  });

  it('does not re-extract orphan canonical skills into .agents/rules during apply', async () => {
    const orphanSkillDir = path.join(
      tmpDir,
      '.agents',
      'skills',
      'cli-agent-readiness-reviewer',
    );
    await fs.mkdir(orphanSkillDir, { recursive: true });
    await fs.writeFile(
      path.join(orphanSkillDir, 'SKILL.md'),
      `---
name: cli-agent-readiness-reviewer
description: Orphan canonical skill
---

# Orphan canonical skill`,
    );

    await fs.writeFile(
      path.join(tmpDir, '.agents', '.skiller.json'),
      JSON.stringify(
        {
          version: 1,
          targets: {},
          localSkills: ['cli-agent-readiness-reviewer'],
        },
        null,
        2,
      ),
    );

    await propagateSkills(
      tmpDir,
      [new ClaudeAgent(), new CodexCliAgent()],
      true,
      false,
      false,
      path.join(tmpDir, '.agents'),
    );

    await expect(
      fs.access(
        path.join(
          tmpDir,
          '.agents',
          'rules',
          'cli-agent-readiness-reviewer.mdc',
        ),
      ),
    ).rejects.toThrow();

    await expect(
      fs.access(path.join(tmpDir, '.agents', '.skiller.json')),
    ).rejects.toThrow();
  });

  it('prunes compiled canonical skills when their local rule source was deleted', async () => {
    const canonicalSkillDir = path.join(
      tmpDir,
      '.agents',
      'skills',
      'vercel-root-directory-cli',
    );
    await fs.mkdir(canonicalSkillDir, { recursive: true });
    await fs.writeFile(
      path.join(canonicalSkillDir, 'SKILL.md'),
      `---
name: vercel-root-directory-cli
description: Skill: vercel-root-directory-cli
metadata:
  skiller:
    source: .agents/rules/vercel-root-directory-cli.mdc
---

# Vercel Root Directory vs CLI Deploy`,
    );

    const claudeMirrorDir = path.join(
      tmpDir,
      '.claude',
      'skills',
      'vercel-root-directory-cli',
    );
    await fs.mkdir(claudeMirrorDir, { recursive: true });
    await fs.writeFile(
      path.join(claudeMirrorDir, 'SKILL.md'),
      `---
name: vercel-root-directory-cli
description: stale mirror
---

mirror`,
    );

    const codexMirrorDir = path.join(
      tmpDir,
      '.codex',
      'skills',
      'vercel-root-directory-cli',
    );
    await fs.mkdir(codexMirrorDir, { recursive: true });
    await fs.writeFile(
      path.join(codexMirrorDir, 'SKILL.md'),
      `---
name: vercel-root-directory-cli
description: stale mirror
---

mirror`,
    );

    await fs.writeFile(
      path.join(tmpDir, '.agents', '.skiller.json'),
      JSON.stringify(
        {
          version: 1,
          targets: {},
          localSkills: ['vercel-root-directory-cli'],
        },
        null,
        2,
      ),
    );

    await propagateSkills(
      tmpDir,
      [new ClaudeAgent(), new CodexCliAgent()],
      true,
      false,
      false,
      path.join(tmpDir, '.agents'),
    );

    await expect(fs.access(canonicalSkillDir)).rejects.toThrow();
    await expect(fs.access(claudeMirrorDir)).rejects.toThrow();
    await expect(fs.access(codexMirrorDir)).rejects.toThrow();
    await expect(
      fs.access(
        path.join(tmpDir, '.agents', 'rules', 'vercel-root-directory-cli.mdc'),
      ),
    ).rejects.toThrow();

    await expect(
      fs.access(path.join(tmpDir, '.agents', '.skiller.json')),
    ).rejects.toThrow();
  });

  it('prunes stale claude-* local aliases when the base rule already exists with identical content', async () => {
    const rulesDir = path.join(tmpDir, '.agents', 'rules');
    await fs.mkdir(rulesDir, { recursive: true });

    const translateRule = `---
description: 'Command: translate'
---

Translate the file.`;

    await fs.writeFile(path.join(rulesDir, 'translate.mdc'), translateRule);
    await fs.writeFile(
      path.join(rulesDir, 'claude-translate.mdc'),
      translateRule,
    );

    const staleCanonicalAliasDir = path.join(
      tmpDir,
      '.agents',
      'skills',
      'claude-translate',
    );
    await fs.mkdir(staleCanonicalAliasDir, { recursive: true });
    await fs.writeFile(
      path.join(staleCanonicalAliasDir, 'SKILL.md'),
      `---
name: claude-translate
description: stale alias
---

stale alias`,
    );

    const staleClaudeAliasDir = path.join(
      tmpDir,
      '.claude',
      'skills',
      'claude-translate',
    );
    await fs.mkdir(staleClaudeAliasDir, { recursive: true });
    await fs.writeFile(
      path.join(staleClaudeAliasDir, 'SKILL.md'),
      `---
name: claude-translate
description: stale alias
---

stale alias`,
    );

    const staleCodexAliasDir = path.join(
      tmpDir,
      '.codex',
      'skills',
      'claude-translate',
    );
    await fs.mkdir(staleCodexAliasDir, { recursive: true });
    await fs.writeFile(
      path.join(staleCodexAliasDir, 'SKILL.md'),
      `---
name: claude-translate
description: stale alias
---

stale alias`,
    );

    await propagateSkills(
      tmpDir,
      [new ClaudeAgent(), new CodexCliAgent()],
      true,
      false,
      false,
      path.join(tmpDir, '.agents'),
    );

    await expect(
      fs.access(path.join(rulesDir, 'claude-translate.mdc')),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(tmpDir, '.agents', 'skills', 'claude-translate')),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(tmpDir, '.claude', 'skills', 'claude-translate')),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(tmpDir, '.codex', 'skills', 'claude-translate')),
    ).rejects.toThrow();

    await expect(
      fs.access(path.join(rulesDir, 'translate.mdc')),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(
        path.join(tmpDir, '.agents', 'skills', 'translate', 'SKILL.md'),
      ),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(tmpDir, '.claude', 'skills', 'translate')),
    ).resolves.toBeUndefined();
  });

  it('keeps claude-* local aliases when their rule content is different', async () => {
    const rulesDir = path.join(tmpDir, '.agents', 'rules');
    await fs.mkdir(rulesDir, { recursive: true });

    await fs.writeFile(
      path.join(rulesDir, 'translate.mdc'),
      `---
description: 'Command: translate'
---

Translate the file.`,
    );
    await fs.writeFile(
      path.join(rulesDir, 'claude-translate.mdc'),
      `---
description: Alternate translate flow
---

Translate the file, but differently.`,
    );

    await propagateSkills(
      tmpDir,
      [new ClaudeAgent(), new CodexCliAgent()],
      true,
      false,
      false,
      path.join(tmpDir, '.agents'),
    );

    await expect(
      fs.access(path.join(rulesDir, 'claude-translate.mdc')),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(
        path.join(tmpDir, '.agents', 'skills', 'claude-translate', 'SKILL.md'),
      ),
    ).resolves.toBeUndefined();
  });

  it('does not generate skills from .claude commands and cleans legacy claude-managed mirrors', async () => {
    const canonicalSkillDir = path.join(
      tmpDir,
      '.agents',
      'skills',
      'local-skill',
    );
    await fs.mkdir(canonicalSkillDir, { recursive: true });
    await fs.writeFile(
      path.join(canonicalSkillDir, 'SKILL.md'),
      `---
name: local-skill
description: Local skill
---

Canonical content.`,
    );

    const projectClaudeDir = path.join(tmpDir, '.claude');
    await fs.mkdir(path.join(projectClaudeDir, 'commands'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(projectClaudeDir, 'commands', 'do-thing.md'),
      `---
description: Do the thing
---

From claude command.`,
    );

    await fs.writeFile(
      path.join(tmpDir, '.agents', '.skiller.json'),
      JSON.stringify(
        {
          version: 1,
          targets: {
            '.claude/skills': [
              {
                sourceType: 'claude',
                sourceKind: 'command',
                sourceRelPath: '.claude/commands/do-thing.md',
                destRelPath: 'do-thing',
              },
            ],
          },
        },
        null,
        2,
      ),
    );

    const staleClaudeManagedDir = path.join(
      tmpDir,
      '.claude',
      'skills',
      'do-thing',
    );
    await fs.mkdir(staleClaudeManagedDir, { recursive: true });
    await fs.writeFile(
      path.join(staleClaudeManagedDir, 'SKILL.md'),
      `---
name: do-thing
description: stale claude mirror
---

stale`,
    );

    await propagateSkills(
      tmpDir,
      [new ClaudeAgent(), new CodexCliAgent()],
      true,
      false,
      false,
      path.join(tmpDir, '.agents'),
    );

    await expect(
      fs.access(path.join(tmpDir, '.claude', 'skills', 'do-thing')),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(tmpDir, '.claude', 'skills', 'local-skill')),
    ).resolves.toBeUndefined();

    await expect(
      fs.access(path.join(tmpDir, '.agents', '.skiller.json')),
    ).rejects.toThrow();
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

    await expect(
      fs.access(path.join(tmpDir, '.agents', '.skiller.json')),
    ).rejects.toThrow();
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

  it('leaves orphan canonical skills alone during propagation', async () => {
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

    await expect(
      fs.access(path.join(tmpDir, '.agents', 'rules', 'plain-local.mdc')),
    ).rejects.toThrow();

    const canonicalSkill = await fs.readFile(
      path.join(tmpDir, '.agents', 'skills', 'plain-local', 'SKILL.md'),
      'utf8',
    );
    expect(canonicalSkill).not.toContain(
      'source: .agents/rules/plain-local.mdc',
    );
    expect(canonicalSkill).toContain('# Plain local body');
  });
});
