# Skills

Skiller treats `.claude/skills/` as the committed source of truth.

- Claude/Copilot/Kilo Code use `.claude/skills/` directly
- Other agents get synced copies in their native skills directories

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

- `.codex/skills`
- `.cursor/skills`
- `.opencode/skill`
- `.roo/skills`
- `.gemini/skills`
- `.agents/skills`

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

If `.claude/settings.json` enables Claude Code plugins, Skiller syncs plugin content into agent skills directories:

- Plugin `skills/` directories are copied as skills
- Plugin `commands/**/*.md` are converted into skills (`SKILL.md`)
- Plugin `agents/**/*.md` are converted into skills (`SKILL.md`)

Conflict behavior:

- Local and project names win
- Plugin items are namespaced as `<pluginName>-<name>` (numeric suffix if needed)

Tracking + cleanup:

- Skiller tracks plugin/project-managed items in `.claude/.skiller.json`
- Disabling a plugin removes its managed items (unless the plugin is enabled but cannot be resolved on disk)
