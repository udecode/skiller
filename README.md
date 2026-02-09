# `skiller`

A Claude-centric fork of [ruler](https://github.com/intellectronica/ruler) with native skills support:

## 1. Skills as Source of Truth

- `.claude/skills/` is the committed source of truth for skills
- **Bidirectional sync** between `.mdc` and `SKILL.md` (sibling pattern):
  - Create `.claude/skills/foo/foo.mdc` → auto-generates `.claude/skills/foo/SKILL.md`
  - Create `.claude/skills/foo/SKILL.md` → auto-generates `.claude/skills/foo/foo.mdc`
- Sync direction detected via `@reference` body pattern (SKILL.md with `@path` = .mdc is source)
- Edit either file, the other stays in sync on next `skiller apply`
- `.claude/rules/` contents are migrated to `.claude/skills/` and rules directory is deleted

## 2. CLAUDE.md @filename References

- Uses `@filename` syntax instead of merging content
- Claude Code auto-includes referenced files
- Reduces CLAUDE.md size and keeps sources separate
- Other agents still get merged content

## 3. MDC File Support

- Supports both `.md` and `.mdc` files (Nuxt Content, Vue)
- All patterns auto-expand: `"components"` → `"components/**/*.{md,mdc}"`

## 4. Rules Filtering

- `include`/`exclude` glob patterns in `[rules]`
- Directory names auto-expand to `directory/**/*.{md,mdc}`
- Organize by team/feature, exclude drafts/internal docs

## 5. Claude Root Folder

- Default directory is `.claude/` (no extra flags needed)
- Skills already in `.claude/skills` (no copying)
- Single directory for all Claude Code config

## 6. Cursor-style Rules

- `merge_strategy = "cursor"` parses `.mdc` frontmatter
- Only includes rules with `alwaysApply: true`
- Strips frontmatter, keeps body only

## 7. Backup Control

- `[backup].enabled = false` disables `.bak` files

## 8. Multi-Agent Skills Propagation

- `.claude/skills/` is the source of truth — skills are automatically copied to agent-specific directories on `skiller apply`
- Supported agent paths: `.codex/skills`, `.cursor/skills`, `.opencode/skill`, `.roo/skills`, `.gemini/skills`, `.agents/skills`
- Shared paths are deduplicated (Claude/Copilot/Kilo share `.claude/skills`, Goose/Amp share `.agents/skills`)
- Agent skills directories are auto-added to `.gitignore` (excluding `.claude/skills`)
- Validates skill structure — warns on missing `SKILL.md`

## 9. Claude Code Plugins → Skills

- Reads `.claude/settings.json` `enabledPlugins`
- Syncs enabled plugin `skills/` into agent skills directories on `skiller apply`
- Syncs enabled plugin `commands/*.md` as skills (`SKILL.md`) into agent skills directories
- Syncs enabled plugin `agents/**/*.md` as skills (`SKILL.md`) into agent skills directories
- Uses the skill/command/agent name by default (matches existing Codex skill names)
- If a name conflicts, local skills win and the plugin skill is namespaced as `<pluginId>-<name>`
- Tracks plugin-managed skills in a single `.skiller-plugins.json` file per agent skills directory
- Removes stale plugin skills when plugins are disabled

## 10. Claude Commands/Agents → Skills

- Syncs `.claude/commands/**/*.md` as skills (`SKILL.md`) into agent skills directories
- Syncs `.claude/agents/**/*.md` as skills (`SKILL.md`) into agent skills directories
- Uses the command/agent name by default
- If a name conflicts, existing local/manual skills win and the project item is namespaced as `claude-<name>`
- Project items win over plugin skills/commands/agents on name conflicts
- Tracks project-managed items in a single `.skiller-claude.json` file per agent skills directory

---

# Skiller: Centralise Your AI Coding Assistant Instructions

> **Beta Research Preview**
>
> - Please test this version carefully in your environment
> - Report issues at https://github.com/udecode/skiller/issues

## Why Skiller?

Managing instructions across multiple AI coding tools becomes complex as your team grows. Different agents (GitHub Copilot, Claude, Cursor, Aider, etc.) require their own configuration files, leading to:

- **Inconsistent guidance** across AI tools
- **Duplicated effort** maintaining multiple config files
- **Context drift** as project requirements evolve
- **Onboarding friction** for new AI tools
- **Complex project structures** requiring context-specific instructions for different components

Skiller solves this by providing a **single source of truth** for all your AI agent instructions, automatically distributing them to the right configuration files. With support for **nested rule loading**, Skiller can handle complex project structures with context-specific instructions for different components.

## Core Features

- **Centralised Rule Management**: Store all AI instructions in a dedicated `.claude/` directory using Markdown files
- **Nested Rule Loading**: Support complex project structures with multiple `.claude/` directories for context-specific instructions
- **Automatic Distribution**: Skiller applies these rules to configuration files of supported AI agents
- **Targeted Agent Configuration**: Fine-tune which agents are affected and their specific output paths via `skiller.toml`
- **MCP Server Propagation**: Manage and distribute Model Context Protocol (MCP) server settings
- **`.gitignore` Automation**: Keeps generated agent config files out of version control automatically
- **Simple CLI**: Easy-to-use commands for initialising and applying configurations

## Supported AI Agents

| Agent            | Rules File(s)                                      | MCP Configuration / Notes                        | Skills Location    |
| ---------------- | -------------------------------------------------- | ------------------------------------------------ | ------------------ |
| AGENTS.md        | `AGENTS.md`                                        | (pseudo-agent ensuring root `AGENTS.md` exists)  | -                  |
| GitHub Copilot   | `AGENTS.md`                                        | `.vscode/mcp.json`                               | `.claude/skills/`  |
| Claude Code      | `CLAUDE.md` (@filename references)                 | `.mcp.json`                                      | `.claude/skills/`  |
| OpenAI Codex CLI | `AGENTS.md`                                        | `.codex/config.toml`                             | `.codex/skills/`   |
| Jules            | `AGENTS.md`                                        | -                                                | -                  |
| Cursor           | `AGENTS.md`                                        | `.cursor/mcp.json`                               | `.cursor/skills/`  |
| Windsurf         | `AGENTS.md`                                        | `.windsurf/mcp_config.json`                      | -                  |
| Cline            | `.clinerules`                                      | -                                                | -                  |
| Crush            | `CRUSH.md`                                         | `.crush.json`                                    | -                  |
| Amp              | `AGENTS.md`                                        | -                                                | `.agents/skills/`  |
| Amazon Q CLI     | `.amazonq/rules/skiller_q_rules.md`                | `.amazonq/mcp.json`                              | -                  |
| Aider            | `AGENTS.md`, `.aider.conf.yml`                     | `.mcp.json`                                      | -                  |
| Firebase Studio  | `.idx/airules.md`                                  | `.idx/mcp.json`                                  | -                  |
| Open Hands       | `.openhands/microagents/repo.md`                   | `config.toml`                                    | -                  |
| Gemini CLI       | `AGENTS.md`                                        | `.gemini/settings.json`                          | `.gemini/skills/`  |
| Junie            | `.junie/guidelines.md`                             | -                                                | -                  |
| AugmentCode      | `.augment/rules/skiller_augment_instructions.md`   | -                                                | -                  |
| Kilo Code        | `.kilocode/rules/skiller_kilocode_instructions.md` | `.kilocode/mcp.json`                             | `.claude/skills/`  |
| OpenCode         | `AGENTS.md`                                        | `opencode.json`                                  | `.opencode/skill/` |
| Goose            | `.goosehints`                                      | -                                                | `.agents/skills/`  |
| Qwen Code        | `AGENTS.md`                                        | `.qwen/settings.json`                            | -                  |
| RooCode          | `AGENTS.md`                                        | `.roo/mcp.json`                                  | `.roo/skills/`     |
| Zed              | `AGENTS.md`                                        | `.zed/settings.json` (project root, never $HOME) | -                  |
| Trae AI          | `.trae/rules/project_rules.md`                     | -                                                | -                  |
| Warp             | `WARP.md`                                          | -                                                | -                  |
| Kiro             | `.kiro/steering/skiller_kiro_instructions.md`      | -                                                | -                  |
| Firebender       | `firebender.json`                                  | `firebender.json` (rules and MCP in same file)   | -                  |

## Getting Started

### Installation

**Using `npx` (for one-off commands):**

```bash
npx skiller@latest apply
```

### Project Initialisation

1. Navigate to your project's root directory
2. Run `skiller init`
3. This creates:

- `.claude/` directory
- `.claude/AGENTS.md`: The primary starter Markdown file for your rules
- `.claude/skiller.toml`: The main configuration file for Skiller

Additionally, you can create a global configuration to use when no local `.claude/` directory is found:

```bash
skiller init --global
```

The global configuration will be created to `$XDG_CONFIG_HOME/skiller` (default: `~/.config/skiller`).

## Core Concepts

### The `.claude/` Directory

This is your central hub for all AI agent instructions:

- **Primary File Order & Precedence**:
  1. A repository root `AGENTS.md` (outside `.claude/`) if present (highest precedence, prepended)
  2. `.claude/AGENTS.md` (new default starter file)
  3. Remaining discovered `.md` files under `.claude/` (and subdirectories) in sorted order
- **Rule Files (`*.md`)**: Discovered recursively from `.claude/` or `$XDG_CONFIG_HOME/skiller` and concatenated in the order above
- **Concatenation Marker**: Each file's content is prepended with `--- Source: <relative_path_to_md_file> ---` for traceability
- **`skiller.toml`**: Master configuration for Skiller's behavior, agent selection, and output paths
- **`mcp.json`**: Shared MCP server settings

This ordering lets you keep a short, high-impact root `AGENTS.md` (e.g. executive project summary) while housing detailed guidance inside `.claude/`.

### Nested Rule Loading

Skiller now supports **nested rule loading** with the `--nested` flag, enabling context-specific instructions for different parts of your project:

```
project/
├── .claude/           # Global project rules
│   ├── AGENTS.md
│   └── coding_style.md
├── src/
│   └── .claude/       # Component-specific rules
│       └── api_guidelines.md
├── tests/
│   └── .claude/       # Test-specific rules
│       └── testing_conventions.md
└── docs/
    └── .claude/       # Documentation rules
        └── writing_style.md
```

**How it works:**

- Discover all `.claude/` directories in the project hierarchy
- Load and concatenate rules from each directory in order
- Decide whether nested mode is enabled using the following precedence:
  1. `skiller apply --nested` (or `--no-nested`) takes top priority
  2. `nested = true` in `skiller.toml`
  3. Default to disabled when neither option is provided
- When a run is nested, downstream configs are forced to keep `nested = true`. If a child config attempts to disable it, Skiller keeps nested processing active and emits a warning in the logs.
- Nested processing carries forward each directory's own MCP bundle and configuration settings so that generated files remain scoped to their source directories while being normalized back to the project root.

> [!CAUTION]
> Nested mode is experimental and may change in future releases. The CLI logs this warning the first time a nested run is detected so you know the behavior may evolve.

**Perfect for:**

- Monorepos with multiple services
- Projects with distinct components (frontend/backend)
- Teams needing different instructions for different areas
- Complex codebases with varying standards

### Best Practices for Rule Files

**Granularity**: Break down complex instructions into focused `.md` files:

- `coding_style.md`
- `api_conventions.md`
- `project_architecture.md`
- `security_guidelines.md`

**Example rule file (`.claude/python_guidelines.md`):**

```markdown
# Python Project Guidelines

## General Style

- Follow PEP 8 for all Python code
- Use type hints for all function signatures and complex variables
- Keep functions short and focused on a single task

## Error Handling

- Use specific exception types rather than generic `Exception`
- Log errors effectively with context

## Security

- Always validate and sanitize user input
- Be mindful of potential injection vulnerabilities
```

## Usage: The `apply` Command

### Primary Command

```bash
skiller apply [options]
```

The `apply` command looks for `.claude/` in the current directory tree, reading the first match. If no such directory is found, it will look for a global configuration in `$XDG_CONFIG_HOME/skiller`.

### Options

| Option                         | Description                                                            |
| ------------------------------ | ---------------------------------------------------------------------- |
| `--project-root <path>`        | Project root path (default: current directory).                        |
| `--agents <agent1,agent2,...>` | Comma-separated agent names to target (see supported list below).      |
| `--config <path>`              | Custom `skiller.toml` path.                                            |
| `--mcp` / `--with-mcp`         | Enable applying MCP server configurations (default: true).             |
| `--no-mcp`                     | Disable applying MCP server configurations.                            |
| `--mcp-overwrite`              | Overwrite native MCP config instead of merging.                        |
| `--gitignore`                  | Enable automatic .gitignore updates (default: true).                   |
| `--no-gitignore`               | Disable automatic .gitignore updates.                                  |
| `--nested`                     | Enable nested rule loading (default: inherit from config or disabled). |
| `--no-nested`                  | Disable nested rule loading even if `nested = true` in config.         |
| `--backup` / `--no-backup`     | Enable/disable creation of `.bak` backup files (default: enabled).     |
| `--dry-run`                    | Preview changes without writing files.                                 |
| `--local-only`                 | Skip `$XDG_CONFIG_HOME` when looking for configuration.                |
| `--verbose` / `-v`             | Display detailed output during execution.                              |

### Common Examples

**Apply rules to all configured agents:**

```bash
skiller apply
```

**Apply rules only to GitHub Copilot and Claude:**

```bash
skiller apply --agents copilot,claude
```

**Apply rules only to Firebase Studio:**

```bash
skiller apply --agents firebase
```

**Apply rules only to Warp:**

```bash
skiller apply --agents warp
```

**Apply rules only to Trae AI:**

```bash
skiller apply --agents trae
```

**Apply rules only to RooCode:**

```bash
skiller apply --agents roo
```

**Use a specific configuration file:**

```bash
skiller apply --config ./team-configs/skiller.frontend.toml
```

**Apply rules with verbose output:**

```bash
skiller apply --verbose
```

**Apply rules but skip MCP and .gitignore updates:**

```bash
skiller apply --no-mcp --no-gitignore
```

## Usage: The `revert` Command

The `revert` command safely undoes all changes made by `skiller apply`, restoring your project to its pre-skiller state. It intelligently restores files from backups (`.bak` files) when available, or removes generated files that didn't exist before.

### Why Revert is Needed

When experimenting with different rule configurations or switching between projects, you may want to:

- **Clean slate**: Remove all skiller-generated files to start fresh
- **Restore originals**: Revert modified files back to their original state
- **Selective cleanup**: Remove configurations for specific agents only
- **Safe experimentation**: Try skiller without fear of permanent changes

### Primary Command

```bash
skiller revert [options]
```

### Options

| Option                         | Description                                                                                                                                                                                                                                                                   |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--project-root <path>`        | Path to your project's root (default: current directory)                                                                                                                                                                                                                      |
| `--agents <agent1,agent2,...>` | Comma-separated list of agent names to revert (agentsmd, aider, amazonqcli, amp, augmentcode, claude, cline, codex, copilot, crush, cursor, firebase, firebender, gemini-cli, goose, jules, junie, kilocode, kiro, opencode, openhands, qwen, roo, trae, warp, windsurf, zed) |
| `--config <path>`              | Path to a custom `skiller.toml` configuration file                                                                                                                                                                                                                            |
| `--keep-backups`               | Keep backup files (.bak) after restoration (default: false)                                                                                                                                                                                                                   |
| `--dry-run`                    | Preview changes without actually reverting files                                                                                                                                                                                                                              |
| `--verbose` / `-v`             | Display detailed output during execution                                                                                                                                                                                                                                      |
| `--local-only`                 | Only search for local .claude directories, ignore global config                                                                                                                                                                                                               |

### Common Examples

**Revert all skiller changes:**

```bash
skiller revert
```

**Preview what would be reverted (dry-run):**

```bash
skiller revert --dry-run
```

**Revert only specific agents:**

```bash
skiller revert --agents claude,copilot
```

**Revert with detailed output:**

```bash
skiller revert --verbose
```

**Keep backup files after reverting:**

```bash
skiller revert --keep-backups
```

## Configuration (`skiller.toml`) in Detail

### Location

Defaults to `.claude/skiller.toml` in the project root. Override with `--config` CLI option.

### Complete Example

```toml
# Default agents to run when --agents is not specified
# Uses case-insensitive substring matching
default_agents = ["copilot", "claude", "aider"]

# --- Global MCP Server Configuration ---
[mcp]
# Enable/disable MCP propagation globally (default: true)
enabled = true
# Global merge strategy: 'merge' or 'overwrite' (default: 'merge')
merge_strategy = "merge"

# --- MCP Server Definitions ---
[mcp_servers.filesystem]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/project"]

[mcp_servers.git]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-git", "--repository", "."]

[mcp_servers.remote_api]
url = "https://api.example.com"

[mcp_servers.remote_api.headers]
Authorization = "Bearer your-token"

# --- Global .gitignore Configuration ---
[gitignore]
# Enable/disable automatic .gitignore updates (default: true)
enabled = true

# --- Backup Configuration ---
[backup]
# Enable/disable creation of .bak backup files (default: true)
enabled = false

# --- Agent-Specific Configurations ---
[agents.copilot]
enabled = true

[agents.claude]
enabled = true
output_path = "CLAUDE.md"

[agents.aider]
enabled = true
output_path_instructions = "AGENTS.md"
output_path_config = ".aider.conf.yml"

# OpenAI Codex CLI agent and MCP config
[agents.codex]
enabled = true
output_path = "AGENTS.md"
output_path_config = ".codex/config.toml"

# Agent-specific MCP configuration for Codex CLI
[agents.codex.mcp]
enabled = true
merge_strategy = "merge"

[agents.firebase]
enabled = true
output_path = ".idx/airules.md"

[agents.gemini-cli]
enabled = true

[agents.jules]
enabled = true

[agents.junie]
enabled = true
output_path = ".junie/guidelines.md"

# Agent-specific MCP configuration
[agents.cursor.mcp]
enabled = true
merge_strategy = "merge"

# Disable specific agents
[agents.windsurf]
enabled = false

[agents.kilocode]
enabled = true
output_path = ".kilocode/rules/skiller_kilocode_instructions.md"

[agents.warp]
enabled = true
output_path = "WARP.md"
```

### Configuration Precedence

1. **CLI flags** (e.g., `--agents`, `--no-mcp`, `--mcp-overwrite`, `--no-gitignore`)
2. **Settings in `skiller.toml`** (`default_agents`, specific agent settings, global sections)
3. **Skiller's built-in defaults** (all agents enabled, standard output paths, MCP enabled with 'merge')

## MCP (Model Context Protocol) Server Configuration

MCP provides broader context to AI models through server configurations. Skiller can manage and distribute these settings across compatible agents.

### TOML Configuration (Recommended)

You can now define MCP servers directly in `skiller.toml` using the `[mcp_servers.<name>]` syntax:

```toml
# Global MCP behavior
[mcp]
enabled = true
merge_strategy = "merge"  # or "overwrite"

# Local (stdio) server
[mcp_servers.filesystem]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/project"]

[mcp_servers.filesystem.env]
API_KEY = "your-api-key"

# Remote server
[mcp_servers.search]
url = "https://mcp.example.com"

[mcp_servers.search.headers]
Authorization = "Bearer your-token"
"X-API-Version" = "v1"
```

### Configuration Precedence

When both TOML and JSON configurations are present:

1. **TOML servers take precedence** over JSON servers with the same name
2. **Servers are merged** from both sources (unless using overwrite strategy)
3. **Deprecation warning** is shown encouraging migration to TOML (warning shown once per run)

### Server Types

**Local/stdio servers** require a `command` field:

```toml
[mcp_servers.local_server]
command = "node"
args = ["server.js"]

[mcp_servers.local_server.env]
DEBUG = "1"
```

**Remote servers** require a `url` field (headers optional; bearer Authorization token auto-extracted for OpenHands when possible):

```toml
[mcp_servers.remote_server]
url = "https://api.example.com"

[mcp_servers.remote_server.headers]
Authorization = "Bearer token"
```

Skiller uses this configuration with the `merge` (default) or `overwrite` strategy, controlled by `skiller.toml` or CLI flags.

**Home Directory Safety:** Skiller never writes MCP configuration files outside your project root. Any historical references to user home directories (e.g. `~/.codeium/windsurf/mcp_config.json` or `~/.zed/settings.json`) have been removed; only project-local paths are targeted.

**Note for OpenAI Codex CLI:** To apply the local Codex CLI MCP configuration, set the `CODEX_HOME` environment variable to your project’s `.codex` directory:

```bash
export CODEX_HOME="$(pwd)/.codex"
```

## Skills Support

Skiller can manage and propagate skills to supported AI agents. Skills are stored in `.claude/skills/` as the **committed source of truth** and automatically copied to agent-specific directories on `skiller apply`.

### How It Works

Skills are specialized knowledge packages that extend AI agent capabilities. Skiller discovers skills in your `.claude/skills/` directory, keeps them in sync via bidirectional `.mdc`/`SKILL.md` sync, and propagates them to all agents with native skills support:

- **Claude Code, GitHub Copilot, Kilo Code**: `.claude/skills/` (shared, source of truth)
- **OpenAI Codex CLI**: `.codex/skills/`
- **Cursor**: `.cursor/skills/`
- **OpenCode**: `.opencode/skill/`
- **Goose, Amp**: `.agents/skills/` (shared)
- **Roo Code**: `.roo/skills/`
- **Gemini CLI**: `.gemini/skills/`

Shared paths are deduplicated — agents sharing the same directory only trigger one copy operation.

### Claude Code Plugins

If your project enables Claude Code plugins in `.claude/settings.json`, Skiller also syncs plugin content into agent skills directories on `skiller apply`:

- Plugin `skills/` are copied as skills
- Plugin `commands/*.md` are converted into skills (`SKILL.md`)
- Plugin skills use their original skill/command name by default
- If a name conflicts, local skills win and the plugin skill is namespaced as `<pluginId>-<name>`
- Plugin-managed skills are tracked via `.skiller-plugins.json` in each agent skills directory

### Skills Directory Structure

Skills can be organized flat or nested:

```
.claude/skills/
├── my-skill/
│   ├── my-skill.mdc       # Skill content (body)
│   └── SKILL.md           # @reference to my-skill.mdc (frontmatter here)
├── another-skill/
│   ├── another-skill.mdc  # Generated from SKILL.md body
│   ├── SKILL.md           # Manually created skill (now @reference)
│   ├── helper.py          # Optional: additional resources (scripts)
│   └── reference.md       # Optional: additional resources (docs)
```

Each skill can be defined in two ways:

1. **Standalone `.mdc` file** - Simple skills can be a single `.mdc` file at the skills root
2. **Skill folder with `SKILL.md`** - Complex skills with additional resources

### Bidirectional Sync

Skiller provides bidirectional sync between `.mdc` files and `SKILL.md` folders:

| Scenario                        | Sync Direction                                             |
| ------------------------------- | ---------------------------------------------------------- |
| `.mdc` exists, no `SKILL.md`    | → Generate `SKILL.md` with `@reference` to .mdc            |
| `SKILL.md` body is `@reference` | .mdc is source of truth (frontmatter in SKILL.md)          |
| `SKILL.md` has full content     | → Generate .mdc from body, update SKILL.md to `@reference` |

The `@reference` body pattern indicates that the `.mdc` file contains the skill content:

```yaml
---
name: my-skill
description: My custom skill
---

@.claude/skills/my-skill/my-skill.mdc
```

### Rules Migration

Content from `.claude/rules/` is automatically migrated to `.claude/skills/` during `skiller apply`, then the rules directory is deleted:

```
.claude/rules/docx/
├── SKILL.md          # Makes this a skill folder
├── script.sh         # Helper script
└── templates/        # Subdirectory
    └── default.docx  # Template file

→ Migrated to:

.claude/skills/docx/
├── docx.mdc          # Generated from SKILL.md body
├── SKILL.md          # Updated to @reference
├── script.sh         # Copied automatically
└── templates/        # Copied automatically
    └── default.docx  # Copied automatically

.claude/rules/ → Deleted after migration
```

### Configuration

Skills support is **enabled by default** but can be controlled via:

**CLI flags:**

```bash
# Enable skills (default)
skiller apply --skills

# Disable skills
skiller apply --no-skills
```

**Configuration in `skiller.toml`:**

```toml
[skills]
enabled = true  # or false to disable
```

### Validation

Skiller validates discovered skills and issues warnings for:

- Missing required file (`SKILL.md`)
- Invalid directory structures (directories without `SKILL.md` and no sub-skills)

Warnings don't prevent propagation but help identify potential issues.

### `.gitignore` Integration

When skills propagation is enabled, agent skills directories are automatically added to `.gitignore` (excluding `.claude/skills/` which is the committed source of truth):

- `.codex/skills/`, `.cursor/skills/`, `.opencode/skill/`, `.agents/skills/`, `.roo/skills/`, `.gemini/skills/`

### Dry-Run Mode

Test skills propagation without making changes:

```bash
skiller apply --dry-run
```

This shows which skills would be synced, validated, and copied to each agent directory.

### Example Workflow

```bash
# 1. Create a skill folder
mkdir -p .claude/skills/my-skill
cat > .claude/skills/my-skill/SKILL.md << 'EOF'
---
name: my-skill
description: My custom skill
---

# My Custom Skill

This skill provides specialized knowledge for...
EOF

# 2. Apply to sync and propagate skills
skiller apply

# 3. Skills are now available to all compatible agents:
#    - Claude Code, Copilot, Kilo Code: .claude/skills/my-skill/
#    - Codex CLI: .codex/skills/my-skill/
#    - Cursor: .cursor/skills/my-skill/
#    - OpenCode: .opencode/skill/my-skill/
#    - Goose, Amp: .agents/skills/my-skill/
#    - Roo Code: .roo/skills/my-skill/
#    - Gemini CLI: .gemini/skills/my-skill/
```

## `.gitignore` Integration

Skiller automatically manages your `.gitignore` file to keep generated agent configuration files out of version control.

### How it Works

- Creates or updates `.gitignore` in your project root
- Adds paths to a managed block marked with `# START Skiller Generated Files` and `# END Skiller Generated Files`
- Preserves existing content outside this block
- Sorts paths alphabetically and uses relative POSIX-style paths

### Example `.gitignore` Section (sample - actual list depends on enabled agents)

```gitignore
# Your existing rules
node_modules/
*.log

# START Skiller Generated Files
.aider.conf.yml
.clinerules
AGENTS.md
CLAUDE.md
# END Skiller Generated Files

dist/
```

### Control Options

- **CLI flags**: `--gitignore` or `--no-gitignore`
- **Configuration**: `[gitignore].enabled` in `skiller.toml`
- **Default**: enabled

## Practical Usage Scenarios

### Scenario 1: Getting Started Quickly

```bash
# Initialize Skiller in your project
cd your-project
skiller init

# Edit the generated files
# - Add your coding guidelines to .claude/AGENTS.md (or keep adding additional .md files)
# - Customize .claude/skiller.toml if needed

# Apply rules to all AI agents
skiller apply
```

### Scenario 2: Complex Projects with Nested Rules

For large projects with multiple components or services, enable nested rule loading so each directory keeps its own rules and MCP bundle:

```bash
# Set up nested .claude directories
mkdir -p src/.claude tests/.claude docs/.claude

# Add component-specific instructions
echo "# API Design Guidelines" > src/.claude/api_rules.md
echo "# Testing Best Practices" > tests/.claude/test_rules.md
echo "# Documentation Standards" > docs/.claude/docs_rules.md
```

```toml
# .claude/skiller.toml
nested = true
```

```bash
# The CLI inherits nested mode from skiller.toml
skiller apply --verbose

# Override from the CLI at any time
skiller apply --no-nested
```

This creates context-specific instructions for different parts of your project while maintaining global rules in the root `.claude/` directory. Nested runs automatically keep every nested config enabled even if a child tries to disable it.

> [!NOTE]
> The CLI prints "Nested mode is experimental and may change in future releases." the first time nested processing runs. Expect refinements in future versions.

### Scenario 3: Team Standardization

1. Create `.claude/coding_standards.md`, `.claude/api_usage.md`
2. Commit the `.claude` directory to your repository
3. Team members pull changes and run `skiller apply` to update their local AI agent configurations

### Scenario 4: Project-Specific Context for AI

1. Detail your project's architecture in `.claude/project_overview.md`
2. Describe primary data structures in `.claude/data_models.md`
3. Run `skiller apply` to help AI tools provide more relevant suggestions

### Integration with NPM Scripts

```json
{
  "scripts": {
    "skiller:apply": "skiller apply",
    "dev": "npm run skiller:apply && your_dev_command",
    "precommit": "npm run skiller:apply"
  }
}
```

### Integration with GitHub Actions

```yaml
# .github/workflows/skiller-check.yml
name: Check Skiller Configuration
on:
  pull_request:
    paths: ['.claude/**']

jobs:
  check-skiller:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'

      - name: Install Skiller
        run: npm install -g skiller

      - name: Apply Skiller configuration
        run: skiller apply --no-gitignore

      - name: Check for uncommitted changes
        run: |
          if [[ -n $(git status --porcelain) ]]; then
            echo "::error::Skiller configuration is out of sync!"
            echo "Please run 'skiller apply' locally and commit the changes."
            exit 1
          fi
```

## Troubleshooting

### Common Issues

**"Cannot find module" errors:**

- Ensure Skiller is installed globally: `npm install -g skiller`
- Or use `npx skiller@latest`

**Permission denied errors:**

- On Unix systems, you may need `sudo` for global installation

**Agent files not updating:**

- Check if the agent is enabled in `skiller.toml`
- Verify agent isn't excluded by `--agents` flag
- Use `--verbose` to see detailed execution logs

**Configuration validation errors:**

- Skiller now validates `skiller.toml` format and will show specific error details
- Check that all configuration values match the expected types and formats

### Debug Mode

Use `--verbose` flag to see detailed execution logs:

```bash
skiller apply --verbose
```

This shows:

- Configuration loading details
- Agent selection logic
- File processing information
- MCP configuration steps

## FAQ

**Q: Can I use different rules for different agents?**
A: Currently, all agents receive the same concatenated rules. For agent-specific instructions, include sections in your rule files like "## GitHub Copilot Specific" or "## Aider Configuration".

**Q: How do I set up different instructions for different parts of my project?**
A: Enable nested mode either by setting `nested = true` in `skiller.toml` or by passing `skiller apply --nested`. The CLI inherits the config setting by default, but `--no-nested` always wins if you need to opt out for a run. Nested mode keeps loading rules (and MCP settings) from every `.claude/` directory in the hierarchy, forces child configs to remain nested, and logs "Nested mode is experimental and may change in future releases." if any nested processing occurs.

**Q: How do I temporarily disable Skiller for an agent?**
A: Set `enabled = false` in `skiller.toml` under `[agents.agentname]`, or use `--agents` flag to specify only the agents you want.

**Q: What happens to my existing agent configuration files?**
A: Skiller creates backups with `.bak` extension before overwriting any existing files.

**Q: Can I run Skiller in CI/CD pipelines?**
A: Yes! Use `skiller apply --no-gitignore` in CI to avoid modifying `.gitignore`. See the GitHub Actions example above.

**Q: How does OpenHands MCP propagation classify servers?**
A: Local stdio servers become `stdio_servers`. Remote URLs containing `/sse` are classified as `sse_servers`; others become `shttp_servers`. Bearer tokens in an `Authorization` header are extracted into `api_key` where possible.

**Q: Where is Zed configuration written now?**
A: Skiller writes a `settings.json` in the project root (not the user home dir) and transforms MCP server definitions to Zed's `context_servers` format including `source: "custom"`.

**Q: What changed about MCP initialization?**
A: `skiller init` now only adds example MCP server sections to `skiller.toml` instead of creating `.claude/mcp.json`. The JSON file is still consumed if present, but TOML servers win on name conflicts.

**Q: Is Kiro supported?**
A: Yes. Kiro receives concatenated rules at `.kiro/steering/skiller_kiro_instructions.md`.

## Development

### Setup

```bash
git clone https://github.com/udecode/skiller.git
cd skiller
npm install
npm run build
```

### Testing

```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:coverage

# Run tests in watch mode
npm run test:watch
```

### Code Quality

```bash
# Run linting
npm run lint

# Run formatting
npm run format
```
