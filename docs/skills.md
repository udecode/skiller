# Skills

Skiller treats `.claude/skills/` as the committed source of truth.

- Claude uses `.claude/skills/` directly
- Other agents get synced copies into the same project skill directories defined by the sibling `skills` project

## Skill layout

Canonical (sibling pattern):

- `.claude/skills/<name>/SKILL.md`
- `.claude/skills/<name>/<name>.mdc`

`SKILL.md` is expected to have frontmatter. The body is either:

- A single `@...` line pointing at the `.mdc` (wrapper mode)
- Full content (source mode)

On `skiller apply`, Skiller normalizes skills:

- If `<name>.mdc` exists but `SKILL.md` is missing, it generates `SKILL.md` as a wrapper
- If `SKILL.md` has full content, it generates `<name>.mdc` and rewrites `SKILL.md` into a wrapper
- Root-level `.mdc` files in `.claude/skills/` are migrated into the sibling pattern

Cursor rules inside skills:

- If `<name>.mdc` has `alwaysApply: true` frontmatter, Skiller treats it as a Cursor rule, not a Claude skill

## Propagation to other agents

On `skiller apply` (when skills are enabled), Skiller copies skills into agent-native skills directories:

- `.agents/skills` for agents on the shared project convention such as Codex, GitHub Copilot, Cursor, Gemini CLI, OpenCode, Cline, Warp, Firebender, and Amp
- `.goose/skills`
- `.openhands/skills`
- `.qwen/skills`
- `.augment/skills`
- `.junie/skills`
- `.crush/skills`
- `.windsurf/skills`
- `.trae/skills`
- `.kiro/skills`
- `.kilocode/skills`
- `.roo/skills`

Propagation rules:

- Nested skill folders are flattened (`workflows/lfg` -> `workflows-lfg`)
- Name collisions get numeric suffixes (`foo-2`, `foo-3`, ...)
- `.mdc` files are excluded from non-Claude skill dirs
- If `SKILL.md` is a pure wrapper (`@...` only), non-Claude agents receive an inlined `SKILL.md`

Security constraint:

- Wrapper inlining only happens when the referenced file resolves inside the project root

## `.claude/rules/` migration

If skills are enabled, Skiller migrates `.claude/rules/` into `.claude/skills/` on `apply` and then deletes `.claude/rules/`.

## Claude project commands and agents

Skiller also syncs project-local Claude assets into agent skills directories (not into `.claude/skills/`):

- `.claude/commands/**/*.md` -> skills
- `.claude/agents/**/*.md` -> skills

Conflict behavior:

- Local/manual skills win
- If a name is taken, Skiller namespaces as `claude-<name>` (numeric suffix if needed)
- Project items can take over plugin-managed folders

## Claude plugins

Skiller no longer syncs Claude Code plugins into skills:

- `enabledPlugins` and `extraKnownMarketplaces` in `.claude/settings.json` are native Claude Code config; `skiller apply` leaves them as they are
- Plugin entries left in skiller's manifest (`.agents/.skiller.json` or `.claude/.skiller.json`) are legacy sync state: `skiller apply` refuses until `skiller migrate claude-plugins --execute` moves them to repo installs
