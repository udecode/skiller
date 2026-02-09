---
title: Refactor sync detection via @reference and move .mdc to skill folder
type: refactor
date: 2026-01-28
---

# Refactor: Detect sync via @reference + move .mdc into skill folder

## Overview

Two changes:

1. Replace `synced: true` frontmatter flag with content-based detection - if body is just `@reference`, the referenced file is source of truth
2. Move `.mdc` files from `.claude/skills/name.mdc` to `.claude/skills/name/name.mdc` (sibling to SKILL.md)

This restores compatibility with the pre-0.7 pattern and creates a cleaner file structure.

## Problem Statement

Current approach:

- Uses `synced: true` in frontmatter - extra metadata that can get out of sync
- Places `.mdc` at skills root (`.claude/skills/name.mdc`) - scattered files

## Proposed Solution

1. **Detect sync via body content**: If body has only one non-empty line starting with `@` → referenced file is source of truth
2. **Collocate .mdc with SKILL.md**: `.claude/skills/name/name.mdc` alongside `SKILL.md`

### New File Structure

```
.claude/skills/
├── my-skill/
│   ├── name.mdc              # Source file (sibling to SKILL.md)
│   └── SKILL.md              # Contains @./name.mdc reference
└── another-skill/
    ├── another-skill.mdc
    ├── SKILL.md
    └── helper.py             # Additional resources
```

## Technical Approach

### Detection Function

```typescript
/**
 * Check if SKILL.md body is just a reference (single line starting with @).
 */
function isReferenceBody(body: string): {
  isReference: boolean;
  referencePath?: string;
} {
  const lines = body.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length === 1 && lines[0].trim().startsWith('@')) {
    return {
      isReference: true,
      referencePath: lines[0].trim().slice(1), // Remove @ prefix
    };
  }
  return { isReference: false };
}
```

### Sync Logic Changes

Update `syncMdcToSkillMd()`:

1. **Look for .mdc inside skill folders** instead of at skills root
2. **Remove synced: true from generated frontmatter**
3. **Replace `synced === true` checks** with `isReferenceBody(body).isReference`
4. **When generating SKILL.md from .mdc** - write `@./{name}.mdc` as body (relative path)
5. **When SKILL.md has full content** - generate sibling .mdc with content, update SKILL.md to `@reference`

### Files to Modify

1. **[src/core/SkillsProcessor.ts](src/core/SkillsProcessor.ts)**
   - [x] Add `isReferenceBody()` helper function
   - [x] Update sync to look for `.mdc` inside skill folders (`.claude/skills/name/name.mdc`)
   - [x] Update Case 1: Generate SKILL.md with `@./name.mdc` body
   - [x] Update Case 2: Check `isReferenceBody()` instead of `synced === true`
   - [x] Update Case 3: Generate sibling .mdc, update SKILL.md to `@reference`
   - [x] Remove all `synced: true` additions

2. **[src/types.ts](src/types.ts)**
   - [x] Remove `synced?: boolean` from `MdcFrontmatter` interface

3. **[src/core/FrontmatterParser.ts](src/core/FrontmatterParser.ts)**
   - [x] Remove `synced` field extraction (lines 131-134)

4. **[README.md](README.md)**
   - [ ] Update Skills documentation to show new file structure

## Acceptance Criteria

- [x] Add `isReferenceBody()` helper function
- [x] .mdc files are now inside skill folders (`.claude/skills/name/name.mdc`)
- [x] SKILL.md contains `@./name.mdc` reference when synced
- [x] Remove `synced` from `MdcFrontmatter` type and parser
- [x] Add test for pre-0.7 pattern (backward compatibility)
- [x] Update existing tests

## Test Cases

### New Test: Pre-0.7 Pattern Compatibility

```typescript
it('recognizes pre-0.7 reference pattern as synced', async () => {
  const skillsDir = path.join(tmpDir, '.claude', 'skills');
  const rulesDir = path.join(tmpDir, '.claude', 'rules');
  const skillFolder = path.join(skillsDir, 'my-skill');

  await fs.mkdir(skillFolder, { recursive: true });
  await fs.mkdir(rulesDir, { recursive: true });

  // Create the rule source file (pre-0.7 location)
  await fs.writeFile(
    path.join(rulesDir, 'my-skill.mdc'),
    `---
description: My skill description
---

# My Skill Content
`,
  );

  // Create SKILL.md with @reference (pre-0.7 pattern)
  await fs.writeFile(
    path.join(skillFolder, SKILL_MD_FILENAME),
    `---
name: my-skill
description: My skill description
---

@.claude/rules/my-skill.mdc
`,
  );

  const result = await syncMdcToSkillMd(skillsDir, false, false);

  // Should recognize as reference file - no modification needed
  // The SKILL.md already points to source
});
```

### New Test: Sibling .mdc Pattern

```typescript
it('syncs from sibling .mdc file in skill folder', async () => {
  const skillsDir = path.join(tmpDir, '.claude', 'skills');
  const skillFolder = path.join(skillsDir, 'my-skill');

  await fs.mkdir(skillFolder, { recursive: true });

  // Create .mdc file inside skill folder
  await fs.writeFile(
    path.join(skillFolder, 'my-skill.mdc'),
    `---
description: My skill
---

# Skill Content
`,
  );

  const result = await syncMdcToSkillMd(skillsDir, false, false);

  expect(result.synced).toContain('my-skill');

  // Verify SKILL.md was created with @reference
  const skillMd = await fs.readFile(
    path.join(skillFolder, SKILL_MD_FILENAME),
    'utf8',
  );
  expect(skillMd).toContain('@./my-skill.mdc');
});
```

## Migration

- **Old pattern** (`.claude/skills/name.mdc` at root): Automatically migrated to sibling pattern
- **Pre-0.7 pattern** (`@.claude/rules/name.mdc`): Automatically migrated to sibling pattern (allows `.claude/rules` to be removed)
- **New pattern** (`.claude/skills/name/name.mdc`): Preferred going forward

## References

- Current implementation: [src/core/SkillsProcessor.ts](src/core/SkillsProcessor.ts)
- Type definitions: [src/types.ts](src/types.ts)
- Existing tests: [tests/skills-propagation.test.ts](tests/skills-propagation.test.ts)
