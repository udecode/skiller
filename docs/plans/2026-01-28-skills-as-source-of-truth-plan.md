---
date: 2026-01-28
topic: skills-as-source-of-truth
brainstorm: docs/brainstorms/2026-01-28-skills-as-source-of-truth-brainstorm.md
deepened: 2026-01-28
---

# Implementation Plan: Skills as Source of Truth

## Enhancement Summary

**Deepened on:** 2026-01-28
**Research agents used:** kieran-typescript-reviewer, pattern-recognition-specialist, architecture-strategist, code-simplicity-reviewer, data-migration-expert, security-sentinel, agent-native-reviewer, best-practices-researcher, framework-docs-researcher, skill-creator

### Key Improvements from Research

1. **Simplified sync model** - Consider eliminating two-pass sync entirely
2. **Security fixes required** - Path traversal vulnerability in @filename expansion
3. **Type safety** - Explicit result types with discriminated unions
4. **Migration safety** - Atomic transactions, backups, collision detection
5. **Agent accessibility** - Keep full content in SKILL.md for non-Claude agents

### Critical Decisions Required

- **Simplification opportunity**: Should we eliminate the .mdc sibling entirely and have users edit SKILL.md directly? (40-50% LOC reduction)
- **MCP deprecation**: Non-Claude agents lose skill access - is this acceptable?

---

## Overview

Refactor skiller to make `.claude/skills/` the committed source of truth, eliminating the intermediate `.claude/rules/` → skills generation pipeline.

---

## Phase 1: Remove Skillz MCP Support

**Files to modify:**

### 1.1 Remove Skillz MCP Functions from SkillsProcessor.ts

Location: [src/core/SkillsProcessor.ts](src/core/SkillsProcessor.ts)

Remove:

- `getSkillzJsonFilePath()` (lines ~624-627)
- `getSkillzMdcFilePaths()` (lines ~629-649)
- `generateSkillzJsonFile()` (lines ~651-694)
- All imports/references to skillz functionality

### Research Insights

**Agent-Native Concern (HIGH):**
Non-Claude agents (Codex CLI, Windsurf, Cursor via MCP) completely lose access to skills with MCP removal.

**Options:**

1. Keep `.skillz/` copy for MCP agents (remove server config only)
2. Document that non-Claude agents lose skill support
3. Add `[skills].mcp_propagation = true` option for users who need MCP skills

**Security Improvement:**
Removing the Skillz MCP server is a positive security change - eliminates external process invocation via `uvx`.

### 1.2 Remove Skillz Constants

Location: [src/constants.ts](src/constants.ts)

Remove:

- `SKILLZ_DIR` constant
- `SKILLZ_MCP_SERVER_NAME` constant

### 1.3 Remove Skillz Directory Handling

Location: [src/lib.ts](src/lib.ts)

Remove:

- All references to `.skillz/` directory creation
- Skillz JSON file generation calls
- Skillz MCP server configuration

### 1.4 Remove Skillz Types

Location: [src/types.ts](src/types.ts)

Remove any skillz-related type definitions.

### 1.5 Update Tests

Remove/update tests in:

- `tests/unit/core/skillz-mcp.test.ts` (delete file)
- Any other tests referencing skillz functionality

---

## Phase 2: Remove Config Options

**Files to modify:**

### 2.1 Remove Config Options from Types

Location: [src/types.ts:29-37](src/types.ts#L29-L37)

```typescript
// Remove from SkillsConfig interface:
// - generate_from_rules?: boolean
// - prune?: boolean

// Add synced marker support:
export interface MdcFrontmatter {
  description?: string;
  globs?: string[];
  alwaysApply?: boolean;
  synced?: boolean; // NEW: Marker for sync direction detection
}
```

### 2.2 Update Config Loader

Location: [src/core/ConfigLoader.ts](src/core/ConfigLoader.ts)

Remove handling of `generate_from_rules` and `prune` options from Zod schema.

### 2.3 Update Unified Config Loader

Location: [src/core/UnifiedConfigLoader.ts](src/core/UnifiedConfigLoader.ts)

Remove references to removed config options.

### 2.4 Update lib.ts

Location: [src/lib.ts](src/lib.ts)

Remove:

- `generate_from_rules` conditional logic (lines ~137-172, ~244-263)
- `prune` conditional logic
- Replace with unconditional new sync behavior

---

## Phase 3: Implement New Sync Logic

**Core concept:** Two-pass sync with `synced: true` marker

### Research Insights

**Simplicity Review (CONSIDER ALTERNATIVE):**
The two-pass sync with marker may be over-engineered. Simpler alternative:

```
Option A (Proposed - Complex):
.claude/skills/api/SKILL.md  +  .claude/skills/api.mdc
Two-pass sync with synced: true marker detection

Option B (Simpler - 40% less code):
.claude/skills/api/SKILL.md only
Users edit SKILL.md directly, no generation needed
```

**If proceeding with two-pass sync:**

### 3.1 Define Result Types

Location: [src/types.ts](src/types.ts)

```typescript
/** Result of a single file sync operation */
export interface SyncedFile {
  skillName: string;
  path: string;
  action: 'created' | 'updated' | 'removed' | 'unchanged';
}

/** Result of the syncSkills operation */
export interface SyncResult {
  success: boolean;
  syncedFiles: SyncedFile[];
  warnings: string[];
  error?: string;
}

/** Actions determined during sync */
export type SyncAction =
  | { type: 'create'; skillName: string; sourcePath: string }
  | { type: 'update'; skillName: string; sourcePath: string; reason: string }
  | { type: 'keep'; skillName: string; path: string };
```

### 3.2 Create New Sync Module

Location: NEW FILE [src/core/SkillsSync.ts](src/core/SkillsSync.ts)

**Rationale:** Extract sync logic to dedicated module (SkillsProcessor.ts is 789 lines).

```typescript
import * as yaml from 'js-yaml';

interface SyncSkillsOptions {
  dryRun?: boolean;
  verbose?: boolean;
  projectRoot?: string;
}

/**
 * Syncs skills between SKILL.md and .mdc files
 *
 * Detection logic:
 * 1. If SKILL.md has NO `synced: true` → external install
 *    - Sync direction: SKILL.md → .mdc
 *    - Extract body to sibling .mdc, add `synced: true` to SKILL.md
 * 2. If SKILL.md HAS `synced: true` → skiller-managed
 *    - Sync direction: .mdc → SKILL.md
 *    - Regenerate SKILL.md from .mdc content
 */
export async function syncSkills(
  skillerDir: string,
  options: SyncSkillsOptions = {},
): Promise<SyncResult>;
```

### 3.3 Implement SKILL.md Generation from .mdc

**Security Fix Required:** Use js-yaml to safely serialize frontmatter:

```typescript
import * as yaml from 'js-yaml';

interface SkillMdOptions {
  name: string;
  description: string;
  sourceFilePath: string;
}

function generateSkillMd({
  name,
  description,
  sourceFilePath,
}: SkillMdOptions): string {
  // Use js-yaml to safely serialize frontmatter, avoiding YAML injection
  const frontmatter = yaml.dump(
    {
      name,
      description,
      synced: true,
    },
    {
      lineWidth: -1, // No line wrapping
      noRefs: true, // No YAML anchors
      sortKeys: false, // Preserve key order
    },
  );

  return `---
${frontmatter.trim()}
---

@${sourceFilePath}
`;
}
```

### 3.4 Implement .mdc Extraction from SKILL.md

For external installs (no `synced: true` marker):

1. Parse SKILL.md frontmatter and body
2. Create sibling .mdc with extracted content
3. Add `synced: true` to SKILL.md
4. Update SKILL.md body to reference .mdc

### 3.5 Handle Folder Skills

For skills in `.claude/skills/{name}/SKILL.md`:

- Sibling .mdc goes at `.claude/skills/{name}.mdc` (outside folder)
- Reference in SKILL.md: `@.claude/skills/{name}.mdc`

**Agent-Native Concern:**
This structure is counterintuitive - agents looking in the skill folder won't find the source.
**Alternative:** `.claude/skills/{name}/source.mdc` inside the folder.

### Edge Cases to Handle

From architecture review:

| Edge Case                        | Handling                           |
| -------------------------------- | ---------------------------------- |
| Simultaneous modification        | Detect via content hash, warn user |
| Marker manually removed          | Treat as standalone skill          |
| New skill created manually       | No marker = standalone             |
| .mdc exists but SKILL.md deleted | Regenerate SKILL.md                |
| Name collision (nested folders)  | Throw error with clear message     |

---

## Phase 4: Migration from Rules

### 4.1 Create Migration Module

Location: NEW FILE [src/core/SkillsMigration.ts](src/core/SkillsMigration.ts)

```typescript
export interface MigrationResult {
  success: boolean;
  created: Array<{ name: string; path: string }>;
  skipped: Array<{
    name: string;
    path: string;
    reason: 'already_exists' | 'already_synced';
  }>;
  updated: Array<{ name: string; path: string }>;
  warnings: string[];
  error?: string;
}

/**
 * Migrates .claude/rules/ to .claude/skills/ structure
 */
export async function migrateFromRules(
  skillerDir: string,
  options: { dryRun?: boolean; verbose?: boolean } = {},
): Promise<MigrationResult>;
```

### Research Insights

**Data Migration Expert (CRITICAL FIXES):**

1. **DO NOT delete rules/ if SKILL.md contains @references to it**
   - Current: Generated SKILL.md has `@.claude/rules/foo.mdc`
   - If we delete rules/, these references break
   - Fix: Either inline content OR change reference to new location

2. **Add collision detection:**

   ```typescript
   if (generatedSkillNames.has(fileName)) {
     throw new Error(`Duplicate skill name: ${fileName}`);
   }
   ```

3. **Implement atomic migration:**

   ```typescript
   const tempDir = `${skillsDir}.tmp-${Date.now()}`;
   try {
     await performMigration(rulesDir, tempDir);
     await fs.rename(tempDir, skillsDir); // Atomic
     await fs.rm(rulesDir, { recursive: true });
   } catch (error) {
     await fs.rm(tempDir, { recursive: true, force: true });
     throw error;
   }
   ```

4. **Create backup before deletion:**

   ```typescript
   const backupPath = `${rulesDir}.backup-${Date.now()}`;
   await fs.cp(rulesDir, backupPath, { recursive: true });
   ```

5. **Add migration marker to prevent re-running:**
   ```typescript
   const migrationMarker = path.join(skillsDir, '.migrated');
   if (await fileExists(migrationMarker)) return; // Already done
   ```

### 4.2 Update Apply Command

Location: [src/lib.ts](src/lib.ts)

Add migration check at start of apply:

1. If `.claude/rules/` exists → run migration
2. After successful migration → delete rules folder
3. Proceed with normal sync

---

## Phase 5: Update Gitignore Handling

### 5.1 Remove .claude/skills/ from Gitignore

Location: [src/core/SkillsProcessor.ts:54-95](src/core/SkillsProcessor.ts#L54-L95)

Update `getSkillsGitignorePaths()`:

- Remove `.claude/skills/` from auto-gitignore list
- Keep `.skillz/` removal (cleanup for old installations)

### Research Insights

**Security Concern (LOW):**
Committing `.claude/skills/` could expose sensitive data if users accidentally include API keys in skill content.

**Recommendation:**

- Document this change prominently in migration notes
- Consider adding pre-commit validation that scans for common secret patterns

### 5.2 Update GitignoreUtils

Location: [src/utils/GitignoreUtils.ts](src/utils/GitignoreUtils.ts)

Ensure no references add `.claude/skills/` to gitignore.

---

## Phase 6: Remove Orphan Detection

### 6.1 Remove Pruning Logic

Location: [src/core/SkillsProcessor.ts:205-277](src/core/SkillsProcessor.ts#L205-L277)

Remove:

- `pruneOrphanedSkills()` function
- `isSkillOrphaned()` helper
- All orphan detection logic

The new sync model doesn't have orphans - every skill in `.claude/skills/` is intentional.

### Research Insights

**Architecture Review:**
Keep orphan detection for first few releases with deprecation notice, in case migration fails partially.

---

## Phase 7: Security Fixes

### 7.1 Fix Path Traversal Vulnerability (HIGH PRIORITY)

Location: [src/core/SkillsUtils.ts:183-217](src/core/SkillsUtils.ts#L183-L217)

**Issue:** `expandAtFilenameReferences()` resolves @filename references without validating path is within project.

**Attack:** `@../../../etc/passwd` could read arbitrary files.

**Fix:**

```typescript
const absolutePath = path.resolve(projectRoot, filePath);
const normalizedProjectRoot = path.resolve(projectRoot);
if (!absolutePath.startsWith(normalizedProjectRoot + path.sep)) {
  // Skip references outside project root
  logWarn(`Skipping reference outside project: ${filePath}`);
  continue;
}
```

### 7.2 Use Explicit Safe YAML Schema

Location: [src/core/FrontmatterParser.ts:46](src/core/FrontmatterParser.ts#L46)

**Current:**

```typescript
const parsed = yaml.load(yamlContent) as Record<string, unknown> | null;
```

**Fix:**

```typescript
const parsed = yaml.load(yamlContent, {
  schema: yaml.JSON_SCHEMA, // Explicit safe schema
}) as Record<string, unknown> | null;
```

### 7.3 Add Depth Limits to Recursive Functions

Location: Multiple files

Add `MAX_DEPTH = 50` to:

- `findAllSkillerDirs()` in FileSystemUtils.ts
- `findMdcFiles()` in SkillsProcessor.ts
- `walkSkillsTree()` in SkillsUtils.ts

---

## Phase 8: Update Tests

### 8.1 Update Unit Tests

Files to update:

- `tests/unit/core/SkillsProcessor.test.ts` - update for new sync behavior
- `tests/unit/core/copy-skill-folders-from-rules.test.ts` - may need updates

### 8.2 Add New Unit Tests

```typescript
// tests/unit/core/SkillsSync.test.ts
describe('syncSkills', () => {
  it('creates SKILL.md with synced marker for new skills', async () => {});
  it('is idempotent - running twice produces same result', async () => {});
  it('preserves manually created skills without synced marker', async () => {});
  it('handles concurrent modifications safely', async () => {});
});

// tests/unit/core/SkillsMigration.test.ts
describe('migrateFromRules', () => {
  it('migrates .mdc files to new structure', async () => {});
  it('detects and errors on duplicate skill names', async () => {});
  it('is atomic - partial failure rolls back', async () => {});
  it('creates backup before deleting rules', async () => {});
});

// tests/unit/security/path-traversal.test.ts
describe('expandAtFilenameReferences', () => {
  it('blocks references outside project root', async () => {});
  it('blocks absolute path references', async () => {});
});
```

### 8.3 Update Integration Tests

Files to update:

- `tests/integration/apply-skills.test.ts` - test new sync flow
- Add new integration tests for external skill installs

### 8.4 Update E2E Tests

Files to update:

- `tests/e2e/basic-apply.test.ts` - ensure new structure works

---

## Implementation Order

1. **Phase 7**: Security fixes (path traversal, YAML schema) - do first
2. **Phase 1**: Remove Skillz MCP (isolated, no dependencies)
3. **Phase 6**: Remove orphan detection (simplifies later phases)
4. **Phase 2**: Remove config options
5. **Phase 3**: Implement new sync logic
6. **Phase 4**: Implement migration
7. **Phase 5**: Update gitignore handling
8. **Phase 8**: Update all tests

---

## Test Verification

Before each phase:

```bash
npm test
npm run lint
npm run build
```

After all phases:

```bash
npm ci && npm run lint && npm test && npm run build
```

---

## Rollback Strategy

Each phase should be a separate commit. If issues arise:

1. Revert to last working commit
2. Fix issues
3. Recommit

**Migration Rollback:**

1. Set feature flag (if kept)
2. Restore from backup
3. Re-run `skiller apply`

---

## Success Criteria

- [x] No more `.claude/rules/` directory concept (chose Option B - simpler approach)
- [x] `.claude/skills/` is committed (not gitignored)
- [x] All tests pass (720 tests)
- [x] No skillz MCP code remains
- [x] Path traversal vulnerability fixed
- [x] YAML parsing uses safe schema
- [x] Depth limits added to recursive functions

**Note:** Chose Option B (simpler approach) which eliminates .mdc → SKILL.md sync entirely.
Users edit SKILL.md directly. This reduced code by ~2,400 lines.

---

## Open Questions for Decision

1. **Simplify further?** Should we eliminate .mdc sibling and have users edit SKILL.md directly? (Simpler but changes user workflow)

2. **MCP alternative?** Should we keep `.skillz/` propagation for non-Claude agents as optional feature?

3. **Content in SKILL.md?** Should SKILL.md contain full content (for agent accessibility) or just @reference (current plan)?

4. **Folder skill .mdc location?** Inside folder (`source.mdc`) or outside (`{name}.mdc`)?
