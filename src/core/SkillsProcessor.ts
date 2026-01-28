import * as path from 'path';
import * as fs from 'fs/promises';
import { SkillInfo } from '../types';
import {
  CLAUDE_SKILLS_PATH,
  SKILL_MD_FILENAME,
  MAX_RECURSION_DEPTH,
  logWarn,
  logVerboseInfo,
} from '../constants';
import { walkSkillsTree, copySkillsDirectory } from './SkillsUtils';
import type { IAgent } from '../agents/IAgent';

/**
 * Discovers skills in the project's skills directory (.claude/skills).
 * Returns discovered skills and any validation warnings.
 */
export async function discoverSkills(
  projectRoot: string,
  skillerDir?: string,
): Promise<{ skills: SkillInfo[]; warnings: string[] }> {
  // Use .claude/skills
  const skillsPath = skillerDir
    ? path.join(skillerDir, 'skills')
    : path.join(projectRoot, CLAUDE_SKILLS_PATH);

  // Check if skills directory exists
  try {
    await fs.access(skillsPath);
  } catch {
    // Skills directory doesn't exist - this is fine, just return empty
    return { skills: [], warnings: [] };
  }

  // Walk the skills tree
  return await walkSkillsTree(skillsPath);
}

/**
 * Gets the paths that skills will generate, for gitignore purposes.
 * In the new architecture, .claude/skills is the source of truth and should NOT be gitignored.
 * This function now returns an empty array as skills are committed.
 */
export async function getSkillsGitignorePaths(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _projectRoot: string,
): Promise<string[]> {
  // In the new architecture, .claude/skills is the source of truth and committed.
  // No skills-related paths need to be gitignored.
  return [];
}

/**
 * Propagates skills for agents that need them.
 * In the new architecture, skills are committed to .claude/skills and discovered by agents natively.
 * This function now only discovers and validates skills.
 */
export async function propagateSkills(
  projectRoot: string,
  _agents: IAgent[],
  skillsEnabled: boolean,
  verbose: boolean,
  dryRun: boolean,
  skillerDir?: string,
): Promise<void> {
  if (!skillsEnabled) {
    logVerboseInfo('Skills support disabled', verbose, dryRun);
    return;
  }

  // Determine skills directory - always use .claude/skills
  const skillsDir = skillerDir
    ? path.join(skillerDir, 'skills')
    : path.join(projectRoot, CLAUDE_SKILLS_PATH);

  // Check if skills directory exists
  try {
    await fs.access(skillsDir);
  } catch {
    // No skills directory - this is fine
    logVerboseInfo(
      `No .claude/skills directory found, skipping skills propagation`,
      verbose,
      dryRun,
    );
    return;
  }

  // Discover and validate skills
  const { skills, warnings } = await discoverSkills(projectRoot, skillerDir);

  if (warnings.length > 0) {
    for (const warning of warnings) {
      logWarn(warning, dryRun);
    }
  }

  if (skills.length === 0) {
    logVerboseInfo('No valid skills found in .claude/skills', verbose, dryRun);
    return;
  }

  logVerboseInfo(`Discovered ${skills.length} skill(s)`, verbose, dryRun);
}

/**
 * Recursively finds all folders containing SKILL.md in a directory.
 */
async function findSkillFoldersInRules(
  dir: string,
  depth: number = 0,
): Promise<string[]> {
  const skillFolders: string[] = [];

  // Security: Prevent DoS via deeply nested directories
  if (depth >= MAX_RECURSION_DEPTH) {
    return skillFolders;
  }

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const entryPath = path.join(dir, entry.name);

      // Check if this folder contains SKILL.md
      try {
        await fs.access(path.join(entryPath, SKILL_MD_FILENAME));
        skillFolders.push(entryPath);
      } catch {
        // No SKILL.md, check subdirectories recursively
        const subFolders = await findSkillFoldersInRules(entryPath, depth + 1);
        skillFolders.push(...subFolders);
      }
    }
  } catch {
    // Directory can't be read
  }

  return skillFolders;
}

/**
 * Copies skill folders (folders containing SKILL.md) from .claude/rules to .claude/skills.
 * This allows users to organize skills in the rules directory and have them automatically
 * propagated to the skills directory during apply.
 */
export async function copySkillFoldersFromRules(
  skillerDir: string,
  verbose: boolean,
  dryRun: boolean,
): Promise<void> {
  const rulesDir = path.join(skillerDir, 'rules');
  const skillsDir = path.join(skillerDir, 'skills');

  // Check if rules directory exists
  try {
    await fs.access(rulesDir);
  } catch {
    logVerboseInfo('No .claude/rules directory found', verbose, dryRun);
    return;
  }

  // Find all folders containing SKILL.md recursively
  const skillFolders = await findSkillFoldersInRules(rulesDir);

  if (skillFolders.length === 0) {
    logVerboseInfo(
      'No skill folders (with SKILL.md) found in .claude/rules',
      verbose,
      dryRun,
    );
    return;
  }

  // Copy each skill folder to .claude/skills
  for (const skillFolder of skillFolders) {
    const folderName = path.basename(skillFolder);
    const targetDir = path.join(skillsDir, folderName);

    if (dryRun) {
      logVerboseInfo(
        `DRY RUN: Would copy skill folder ${folderName} from rules to skills`,
        verbose,
        dryRun,
      );
    } else {
      await fs.mkdir(targetDir, { recursive: true });
      await copySkillsDirectory(skillFolder, targetDir);
      logVerboseInfo(
        `Copied skill folder ${folderName} from rules to skills`,
        verbose,
        dryRun,
      );
    }
  }

  logVerboseInfo(
    `Copied ${skillFolders.length} skill folder(s) from rules to skills`,
    verbose,
    dryRun,
  );
}
