import * as path from 'path';
import * as fs from 'fs/promises';
import * as yaml from 'js-yaml';
import { SkillInfo } from '../types';
import {
  CLAUDE_SKILLS_PATH,
  SKILL_MD_FILENAME,
  MAX_RECURSION_DEPTH,
  logWarn,
  logVerboseInfo,
} from '../constants';
import { walkSkillsTree, copySkillsDirectory } from './SkillsUtils';
import { parseFrontmatter } from './FrontmatterParser';
import type { IAgent } from '../agents/IAgent';

/**
 * Bidirectional sync between .mdc files and SKILL.md in the skills directory.
 *
 * Sync logic:
 * 1. If .mdc exists but no SKILL.md → generate SKILL.md with synced: true
 * 2. If SKILL.md has synced: true + .mdc exists → regenerate SKILL.md from .mdc
 * 3. If SKILL.md exists WITHOUT synced: true → generate .mdc from SKILL.md, add synced: true
 *
 * File structure:
 * - .claude/skills/foo.mdc → .claude/skills/foo/SKILL.md
 */
export async function syncMdcToSkillMd(
  skillsDir: string,
  verbose: boolean,
  dryRun: boolean,
): Promise<{ synced: string[]; warnings: string[] }> {
  const synced: string[] = [];
  const warnings: string[] = [];

  try {
    await fs.access(skillsDir);
  } catch {
    // Skills directory doesn't exist
    return { synced, warnings };
  }

  const entries = await fs.readdir(skillsDir, { withFileTypes: true });

  // Find .mdc files at the skills root level
  const mdcFiles = entries.filter((e) => e.isFile() && e.name.endsWith('.mdc'));
  const skillFolders = entries.filter((e) => e.isDirectory());

  // Case 1 & 2: Process .mdc files
  for (const mdcFile of mdcFiles) {
    const skillName = path.basename(mdcFile.name, '.mdc');
    const mdcPath = path.join(skillsDir, mdcFile.name);
    const skillFolderPath = path.join(skillsDir, skillName);
    const skillMdPath = path.join(skillFolderPath, SKILL_MD_FILENAME);

    // Check if SKILL.md exists
    let skillMdContent: string | null = null;
    try {
      skillMdContent = await fs.readFile(skillMdPath, 'utf8');
    } catch {
      // No SKILL.md
    }

    try {
      const mdcContent = await fs.readFile(mdcPath, 'utf8');
      const { frontmatter: mdcFrontmatter, body: mdcBody } =
        parseFrontmatter(mdcContent);

      if (skillMdContent === null) {
        // Case 1: No SKILL.md exists → generate from .mdc with synced: true
        const skillFrontmatter = {
          name: skillName,
          description: mdcFrontmatter?.description || `Skill: ${skillName}`,
          synced: true,
        };

        const newSkillMd = `---
${yaml.dump(skillFrontmatter, { lineWidth: -1, noRefs: true }).trim()}
---

${mdcBody}
`;

        if (dryRun) {
          logVerboseInfo(
            `DRY RUN: Would generate ${skillName}/SKILL.md from ${mdcFile.name}`,
            verbose,
            dryRun,
          );
        } else {
          await fs.mkdir(skillFolderPath, { recursive: true });
          await fs.writeFile(skillMdPath, newSkillMd, 'utf8');
          logVerboseInfo(
            `Generated ${skillName}/SKILL.md from ${mdcFile.name}`,
            verbose,
            dryRun,
          );
        }
        synced.push(skillName);
      } else {
        // SKILL.md exists - check if it has synced: true
        const { frontmatter: skillFrontmatter, body: skillBody } =
          parseFrontmatter(skillMdContent);

        if (skillFrontmatter?.synced === true) {
          // Case 2: synced: true → regenerate SKILL.md from .mdc
          const newFrontmatter = {
            name: skillFrontmatter.name || skillName,
            description:
              mdcFrontmatter?.description ||
              skillFrontmatter.description ||
              `Skill: ${skillName}`,
            synced: true,
          };

          const newSkillMd = `---
${yaml.dump(newFrontmatter, { lineWidth: -1, noRefs: true }).trim()}
---

${mdcBody}
`;

          if (dryRun) {
            logVerboseInfo(
              `DRY RUN: Would update ${skillName}/SKILL.md from ${mdcFile.name}`,
              verbose,
              dryRun,
            );
          } else {
            await fs.writeFile(skillMdPath, newSkillMd, 'utf8');
            logVerboseInfo(
              `Updated ${skillName}/SKILL.md from ${mdcFile.name}`,
              verbose,
              dryRun,
            );
          }
          synced.push(skillName);
        } else {
          // SKILL.md exists without synced: true → SKILL.md is source of truth
          // Update .mdc from SKILL.md and add synced: true
          const mdcFrontmatterObj: Record<string, unknown> = {};
          if (skillFrontmatter?.description) {
            mdcFrontmatterObj.description = skillFrontmatter.description;
          }

          let newMdcContent: string;
          if (Object.keys(mdcFrontmatterObj).length > 0) {
            newMdcContent = `---
${yaml.dump(mdcFrontmatterObj, { lineWidth: -1, noRefs: true }).trim()}
---

${skillBody}
`;
          } else {
            newMdcContent = skillBody;
          }

          // Update SKILL.md with synced: true
          const newSkillFrontmatter = {
            name: skillFrontmatter?.name || skillName,
            description: skillFrontmatter?.description || `Skill: ${skillName}`,
            synced: true,
          };

          const newSkillMd = `---
${yaml.dump(newSkillFrontmatter, { lineWidth: -1, noRefs: true }).trim()}
---

${skillBody}
`;

          if (dryRun) {
            logVerboseInfo(
              `DRY RUN: Would update ${skillName}.mdc from ${skillName}/SKILL.md`,
              verbose,
              dryRun,
            );
          } else {
            await fs.writeFile(mdcPath, newMdcContent, 'utf8');
            await fs.writeFile(skillMdPath, newSkillMd, 'utf8');
            logVerboseInfo(
              `Updated ${skillName}.mdc from ${skillName}/SKILL.md`,
              verbose,
              dryRun,
            );
          }
          synced.push(skillName);
        }
      }
    } catch (err) {
      warnings.push(`Failed to sync ${skillName}: ${(err as Error).message}`);
    }
  }

  // Case 3: Process skill folders without .mdc (SKILL.md → .mdc)
  for (const folder of skillFolders) {
    const skillName = folder.name;
    const mdcPath = path.join(skillsDir, `${skillName}.mdc`);
    const skillMdPath = path.join(skillsDir, skillName, SKILL_MD_FILENAME);

    // Check if .mdc already exists
    let hasMdc = false;
    try {
      await fs.access(mdcPath);
      hasMdc = true;
    } catch {
      // No .mdc
    }

    if (hasMdc) {
      // Already processed in Cases 1 & 2
      continue;
    }

    // Check if SKILL.md exists
    let skillMdContent: string | null = null;
    try {
      skillMdContent = await fs.readFile(skillMdPath, 'utf8');
    } catch {
      // No SKILL.md - not a valid skill
      continue;
    }

    try {
      const { frontmatter, body } = parseFrontmatter(skillMdContent);

      if (frontmatter?.synced !== true) {
        // Case 3: SKILL.md without synced: true → generate .mdc, add synced: true to SKILL.md
        // Generate .mdc from SKILL.md body
        const mdcFrontmatter: Record<string, unknown> = {};
        if (frontmatter?.description) {
          mdcFrontmatter.description = frontmatter.description;
        }

        let mdcContent: string;
        if (Object.keys(mdcFrontmatter).length > 0) {
          mdcContent = `---
${yaml.dump(mdcFrontmatter, { lineWidth: -1, noRefs: true }).trim()}
---

${body}
`;
        } else {
          mdcContent = body;
        }

        // Update SKILL.md with synced: true
        const newSkillFrontmatter = {
          name: frontmatter?.name || skillName,
          description: frontmatter?.description || `Skill: ${skillName}`,
          synced: true,
        };

        const newSkillMd = `---
${yaml.dump(newSkillFrontmatter, { lineWidth: -1, noRefs: true }).trim()}
---

${body}
`;

        if (dryRun) {
          logVerboseInfo(
            `DRY RUN: Would generate ${skillName}.mdc from ${skillName}/SKILL.md`,
            verbose,
            dryRun,
          );
        } else {
          await fs.writeFile(mdcPath, mdcContent, 'utf8');
          await fs.writeFile(skillMdPath, newSkillMd, 'utf8');
          logVerboseInfo(
            `Generated ${skillName}.mdc from ${skillName}/SKILL.md`,
            verbose,
            dryRun,
          );
        }
        synced.push(skillName);
      }
    } catch (err) {
      warnings.push(`Failed to sync ${skillName}: ${(err as Error).message}`);
    }
  }

  return { synced, warnings };
}

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

  // Sync standalone .mdc files to SKILL.md folders before discovery
  const syncResult = await syncMdcToSkillMd(skillsDir, verbose, dryRun);
  if (syncResult.synced.length > 0) {
    logVerboseInfo(
      `Synced ${syncResult.synced.length} .mdc file(s) to SKILL.md`,
      verbose,
      dryRun,
    );
  }
  for (const warning of syncResult.warnings) {
    logWarn(warning, dryRun);
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
