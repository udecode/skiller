/**
 * Types for Model Context Protocol (MCP) server configuration.
 */
export type McpStrategy = 'merge' | 'overwrite';

/** MCP configuration for an agent or global. */
export interface McpConfig {
  /** Enable or disable MCP propagation (merge or overwrite). */
  enabled?: boolean;
  /** Merge strategy: 'merge' to merge servers, 'overwrite' to replace config. */
  strategy?: McpStrategy;
}

/** Global MCP configuration section (same as agent-specific config). */
export type GlobalMcpConfig = McpConfig;

/** Gitignore configuration for automatic .gitignore file updates. */
export interface GitignoreConfig {
  /** Enable or disable automatic .gitignore updates. */
  enabled?: boolean;
}

/** Backup configuration for .bak file creation. */
export interface BackupConfig {
  /** Enable or disable creation of .bak backup files. */
  enabled?: boolean;
}

/** Skills configuration for automatic skills distribution. */
export interface SkillsConfig {
  /** Enable or disable skills support. */
  enabled?: boolean;
}

/** Supported sync source modes. */
export type SyncMode = 'auto' | 'preset' | 'repo';

/** Sync configuration for inheriting preset or repo-managed agent files. */
export interface SyncConfig {
  /** Absolute path to the sync source root. */
  source: string;
  /** Source interpretation mode. */
  mode: SyncMode;
  /** Remove previously synced files that are no longer present. */
  clean: boolean;
  /** Include patterns for repo mode. */
  include?: string[];
  /** Exclude patterns applied after inclusion. */
  exclude?: string[];
}

/** Merge strategy for rules: 'all' merges all files, 'cursor' uses Cursor-style MDC format. */
export type MergeStrategy = 'all' | 'cursor';

/** MDC frontmatter metadata (used by Cursor-style rules). */
export interface MdcFrontmatter {
  /** Description of the rule. */
  description?: string;
  /** Glob patterns this rule applies to. */
  globs?: string[];
  /** Whether this rule should always be applied. */
  alwaysApply?: boolean;
  /** Name of the skill (used in SKILL.md). */
  name?: string;
}

/** Rules configuration for filtering which markdown files to include/exclude. */
export interface RulesConfig {
  /** Glob patterns to include (if specified, only matching files are included). */
  include?: string[];
  /** Glob patterns to exclude (takes precedence over include). */
  exclude?: string[];
  /** Merge strategy: 'all' (default) merges all files, 'cursor' uses Cursor-style MDC format. */
  merge_strategy?: MergeStrategy;
}

/** Information about a discovered skill. */
export interface SkillInfo {
  /** Name of the skill (directory name). */
  name: string;
  /** Absolute path to the skill directory. */
  path: string;
  /** Whether the directory contains a SKILL.md file. */
  hasSkillMd: boolean;
  /** Whether this is a valid skill. */
  valid: boolean;
  /** Error message if invalid. */
  error?: string;
}
