# `skiller`

Apply the same rules (and skills) to multiple AI coding agents.

```bash
npx skiller@latest init
npx skiller@latest apply
```

- Rules live in `.claude/`
- Config lives in `.claude/skiller.toml`
- Docs live in `docs/` (start at `docs/README.md`)

## Docs

- `docs/README.md`
- `docs/cli.md`
- `docs/config.md`
- `docs/skills.md`
- `docs/agents.md`
- `docs/mcp.md`
- `docs/troubleshooting.md`
- `docs/development.md`
- `docs/migration-from-ruler.md`

## Supported agents

- Claude Code
- OpenAI Codex CLI
- Cursor
- GitHub Copilot
- Aider
- Gemini CLI
- Kilo Code
- OpenCode
- RooCode
- Goose
- Amp
- Plus a bunch more: `docs/agents.md`

---

A Claude-centric fork of [ruler](https://github.com/intellectronica/ruler) with native skills support:

## 1. Skills as Source of Truth

- `.claude/skills/` is the committed source of truth for skills
- **Bidirectional sync** between sibling `.mdc` and `SKILL.md` on `skiller apply`
- Sync direction is detected via the `@reference` body pattern
- `.claude/rules/` content is migrated to `.claude/skills/` and the rules directory is deleted

## 2. `CLAUDE.md` `@file` References

- Claude Code gets `CLAUDE.md` as `@relative/path` lines (one per rule file)
- Other agents still get a merged blob with `<!-- Source: ... -->` markers

## 3. `.mdc` File Support

- Reads `.md` and `.mdc` rule files
- Directory patterns auto-expand to `directory/**/*.{md,mdc}`

## 4. Rules Filtering

- `[rules].include` / `[rules].exclude` glob patterns filter rule discovery

## 5. Claude Root Folder

- Root directory is `.claude/` (no extra flags needed)
- Keeps Claude config (`settings.json`, `prompt.json`, hooks, etc.) together

## 6. Cursor-Style Rules

- `rules.merge_strategy = "cursor"` parses `.mdc` frontmatter
- Only includes `.mdc` rules under `rules/` or `skills/` with `alwaysApply: true`
- Strips frontmatter and keeps body only

## 7. Backup Control

- `[backup].enabled = false` disables `.bak` backups

## 8. Multi-Agent Skills Propagation

- `.claude/skills/` is the source of truth; skills are copied to agent-native skill dirs on `skiller apply`
- Supported agent skill dirs: `.codex/skills`, `.cursor/skills`, `.opencode/skill`, `.roo/skills`, `.gemini/skills`, `.agents/skills`
- Agent skill dirs are auto-added to `.gitignore` (excluding `.claude/skills`)
- Validates skill structure and warns on missing `SKILL.md`
- Flattens nested skills into dash-separated names (e.g., `workflows/lfg` -> `workflows-lfg`)

## 9. Claude Code Plugins -> Skills

- Reads `.claude/settings.json` `enabledPlugins`
- Loads plugin content from `~/.claude/plugins/marketplaces/...`
- Syncs enabled plugin `skills/` into agent skill dirs
- Converts plugin `commands/**/*.md` and `agents/**/*.md` into skills (`SKILL.md`) in agent skill dirs
- Local/project skills win name conflicts; plugin items are namespaced as `<pluginName>-<name>`
- Tracks plugin-managed items in `.claude/.skiller.json` and removes stale items when plugins are disabled

## 10. Claude Commands/Agents -> Skills

- Converts `.claude/commands/**/*.md` and `.claude/agents/**/*.md` into skills in agent skill dirs
- Local/manual skills win name conflicts; project items are namespaced as `claude-<name>`
- Project items win over plugin items on name conflicts
