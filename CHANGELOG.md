# skiller

## 0.7.10

### Patch Changes

- Add `gitignore` option to agent configs (e.g., `[agents.claude]`) to control whether output files are added to .gitignore (defaults to `true`)

## 0.7.7

### Minor Changes

**Skills as Source of Truth:**

- `.claude/skills/` is now the **committed source of truth** for skills (no longer gitignored)
- **Bidirectional sync** between `.mdc` and `SKILL.md`:
  - Create `.claude/skills/foo.mdc` → auto-generates `.claude/skills/foo/SKILL.md`
  - Create `.claude/skills/foo/SKILL.md` → auto-generates `.claude/skills/foo.mdc`
- Detect sync direction via `@reference` body pattern (replaces `synced: true` frontmatter)
- Edit either file, the other stays in sync on next `skiller apply`

**Simplifications:**

- Remove skillz MCP integration (skillz directory, MCP tool registration)
- Remove `generate_from_rules` and `prune` config options (deprecated warnings added)
- Remove `generateSkillsFromRules()` and orphan detection
- Stop gitignoring `.claude/skills/` - it's now the committed source

**Security:**

- Add path traversal prevention in SkillsUtils.ts
- Use explicit safe YAML schema in FrontmatterParser.ts
- Add depth limits to recursive functions

**Bug Fixes:**

- Include `.mdc` files with `alwaysApply: true` from both `rules/` and `skills/` directories in AGENTS.md (cursor mode)
- Preserve ALL custom frontmatter fields (e.g., `user-invocable`) when syncing SKILL.md → .mdc
- Auto-delete empty skill folders (directories with neither SKILL.md nor .mdc files)

## 0.6.3

### Patch Changes

- [`7bb47db`](https://github.com/udecode/skiller/commit/7bb47db73aa76dee45a42c450422a598ab09ec7c) - Fix orphaned skill detection for folder skills copied from `.claude/rules`

## 0.6.2

### Patch Changes

- [#14](https://github.com/udecode/skiller/pull/14) [`9625330`](https://github.com/udecode/skiller/commit/96253305e6106e25069518a9287724c646be5a61) Thanks [@zbeyens](https://github.com/zbeyens)! - Copy skill folders from `.claude/rules` to `.claude/skills` during apply

## 0.6.1

### Patch Changes

- [`56e32a5`](https://github.com/udecode/skiller/commit/56e32a55772db0f19cf21e9c8cb907b6d7c9228a) Thanks [@zbeyens](https://github.com/zbeyens)! - Add `${VAR}` environment variable expansion in MCP server env config

  You can now reference environment variables in your `skiller.toml` env values:

  ```toml
  [mcp_servers.linear]
  command = "npx"
  args = ["-y", "github:obra/streamlinear"]
  env = { LINEAR_API_KEY = "${LINEAR_API_KEY}" }
  ```

  The `${VAR}` syntax is expanded from `process.env` at config load time. Undefined variables are replaced with empty strings.

## 0.6.0

### Minor Changes

- [#9](https://github.com/udecode/skiller/pull/9) [`2bd6738`](https://github.com/udecode/skiller/commit/2bd67383827b1e4b3e5d227acb324ffd9b974477) Thanks [@zbeyens](https://github.com/zbeyens)! - Add `prune` option to `[skills]` config for handling orphaned skills
  - `prune = true`: Auto-delete orphaned skills (skills in `.claude/skills/` not generated from any `.mdc` rule)
  - `prune = false`: Keep orphaned skills without prompting
  - `prune` undefined: Interactive prompt asking to delete, with recommendation to set config

## 0.4.3

### Patch Changes

- Fix: Actually remove skillz from Claude and Cursor MCP configs
  - Add missing code to explicitly remove skillz server from filtered MCP config
  - Previous version (0.4.2) didn't include this critical fix
  - Claude .mcp.json and Cursor .cursor/mcp.json now correctly exclude skillz
  - Codex .codex/config.toml still correctly includes skillz

## 0.4.2

### Patch Changes

- Fix skillz MCP server removal from agents with native skills support
  - Explicitly remove skillz from filtered MCP config for Claude Code and Cursor
  - Fixes issue where skillz was still appearing in .mcp.json and .cursor/mcp.json even though agents have native skills support
  - Skillz is added to shared skillerMcpJson for agents like Codex, but now properly filtered out for agents with native skills

## 0.4.1

### Patch Changes

- 658d48a: Fix skillz MCP and Codex config issues
  - Exclude Claude Code and Cursor from skillz MCP (they use native skills support)
  - Fix Codex creating duplicate config files (.codex/config.json and .codex/config.toml)
  - Add CursorAgent.supportsNativeSkills() for cleaner architecture

## 0.4.0

### Minor Changes

- c77a019: ## 1. CLAUDE.md @filename References
  - Uses `@filename` syntax instead of merging content
  - Claude Code auto-includes referenced files
  - Reduces CLAUDE.md size and keeps sources separate
  - Other agents still get merged content

  ## 2. MDC File Support
  - Supports both `.md` and `.mdc` files (Nuxt Content, Vue)
  - All patterns auto-expand: `"components"` → `"components/**/*.{md,mdc}"`

  ## 3. Rules Filtering
  - `include`/`exclude` glob patterns in `[rules]`
  - Directory names auto-expand to `directory/**/*.{md,mdc}`
  - Organize by team/feature, exclude drafts/internal docs

  ## 4. Claude Root Folder
  - `skiller init --claude` creates `.claude/` instead of `.claude/`
  - Skills already in `.claude/skills` (no copying)
  - Single directory for all Claude Code config

  ## 5. Cursor-style Rules
  - `merge_strategy = "cursor"` parses `.mdc` frontmatter
  - Only includes rules with `alwaysApply: true`
  - Strips frontmatter, keeps body only

  ## 6. Backup Control
  - `[backup].enabled = false` disables `.bak` files

  ## 7. Auto-Generate Skills from Rules
  - `[skills].generate_from_rules = true` creates skills from .mdc files
  - Only generates from files with `alwaysApply: false` (or undefined)
  - Files with `alwaysApply: true` are merged into AGENTS.md instead
  - Automatically removes skills when `alwaysApply` changes to `true`
  - Skills use @filename references to original .mdc (for Claude Code)
  - MCP agents (excluding Cursor) get full content in .skillz (frontmatter stripped)
  - Cursor uses .cursor/rules directly (no skillz MCP needed)
  - Globs appended to description: "Applies to files matching: ..."
  - **Folder support**: `rules/docx/docx.mdc` + `rules/docx/script.sh` → `skills/docx/SKILL.md` + `skills/docx/script.sh`
