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
 * Check if SKILL.md body is just a reference (single non-empty line starting with @).
 * This replaces the previous synced: true frontmatter detection.
 */
export function isReferenceBody(body: string): {
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

/**
 * Bidirectional sync between .mdc files and SKILL.md in the skills directory.
 *
 * Sync logic (using @reference pattern instead of synced: true):
 * 1. If sibling .mdc exists (name/name.mdc) but no SKILL.md → generate SKILL.md with @./name.mdc
 * 2. If SKILL.md body is @reference → referenced file is source of truth
 * 3. If SKILL.md has full content → generate sibling .mdc, update SKILL.md to @./name.mdc
 *
 * File structure:
 * - .claude/skills/foo/foo.mdc → .claude/skills/foo/SKILL.md (with @./foo.mdc body)
 *
 * Backward compatibility:
 * - .claude/skills/foo.mdc at root → migrates to sibling pattern
 * - @.claude/rules/name.mdc → recognized as reference (pre-0.7 pattern)
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

  // Find .mdc files at skills root (for backward compatibility/migration)
  const rootMdcFiles = entries.filter(
    (e) => e.isFile() && e.name.endsWith('.mdc'),
  );

  // First, migrate any root .mdc files to sibling pattern
  for (const mdcFile of rootMdcFiles) {
    const skillName = path.basename(mdcFile.name, '.mdc');
    const rootMdcPath = path.join(skillsDir, mdcFile.name);
    const skillFolderPath = path.join(skillsDir, skillName);
    const siblingMdcPath = path.join(skillFolderPath, mdcFile.name);

    try {
      // Create skill folder if needed
      if (!dryRun) {
        await fs.mkdir(skillFolderPath, { recursive: true });
      }

      // Move .mdc to sibling location
      if (dryRun) {
        logVerboseInfo(
          `DRY RUN: Would migrate ${mdcFile.name} to ${skillName}/${mdcFile.name}`,
          verbose,
          dryRun,
        );
      } else {
        const mdcContent = await fs.readFile(rootMdcPath, 'utf8');
        await fs.writeFile(siblingMdcPath, mdcContent, 'utf8');
        await fs.unlink(rootMdcPath);
        logVerboseInfo(
          `Migrated ${mdcFile.name} to ${skillName}/${mdcFile.name}`,
          verbose,
          dryRun,
        );
      }
    } catch (err) {
      warnings.push(
        `Failed to migrate ${skillName}.mdc: ${(err as Error).message}`,
      );
    }
  }

  // Re-read entries after migration
  const updatedEntries = await fs.readdir(skillsDir, { withFileTypes: true });
  const updatedSkillFolders = updatedEntries.filter((e) => e.isDirectory());

  // Process skill folders
  for (const folder of updatedSkillFolders) {
    const skillName = folder.name;
    const skillFolderPath = path.join(skillsDir, skillName);
    const skillMdPath = path.join(skillFolderPath, SKILL_MD_FILENAME);
    const siblingMdcPath = path.join(skillFolderPath, `${skillName}.mdc`);

    // Check if sibling .mdc exists
    let siblingMdcContent: string | null = null;
    try {
      siblingMdcContent = await fs.readFile(siblingMdcPath, 'utf8');
    } catch {
      // No sibling .mdc
    }

    // Check if SKILL.md exists
    let skillMdContent: string | null = null;
    try {
      skillMdContent = await fs.readFile(skillMdPath, 'utf8');
    } catch {
      // No SKILL.md
    }

    try {
      if (siblingMdcContent !== null && skillMdContent === null) {
        // Case 1: Sibling .mdc exists but no SKILL.md
        const { frontmatter: mdcFrontmatter } =
          parseFrontmatter(siblingMdcContent);

        // Skip SKILL.md generation for .mdc files with alwaysApply: true
        // These are Cursor-style rules, not Claude Code skills
        if (mdcFrontmatter?.alwaysApply === true) {
          logVerboseInfo(
            `Skipping SKILL.md generation for ${skillName} (alwaysApply rule)`,
            verbose,
            dryRun,
          );
          continue;
        }

        // Generate SKILL.md with @reference (absolute path)
        const skillFrontmatter = {
          name: skillName,
          description: mdcFrontmatter?.description || `Skill: ${skillName}`,
        };

        const newSkillMd = `---
${yaml.dump(skillFrontmatter, { lineWidth: -1, noRefs: true }).trim()}
---

@.claude/skills/${skillName}/${skillName}.mdc
`;

        if (dryRun) {
          logVerboseInfo(
            `DRY RUN: Would generate ${skillName}/SKILL.md with @reference`,
            verbose,
            dryRun,
          );
        } else {
          await fs.writeFile(skillMdPath, newSkillMd, 'utf8');
          logVerboseInfo(
            `Generated ${skillName}/SKILL.md with @.claude/skills/${skillName}/${skillName}.mdc reference`,
            verbose,
            dryRun,
          );
        }
        synced.push(skillName);
      } else if (skillMdContent !== null) {
        // SKILL.md exists - check if it's a reference
        const { frontmatter: skillFrontmatter, body: skillBody } =
          parseFrontmatter(skillMdContent);
        const refCheck = isReferenceBody(skillBody);

        if (refCheck.isReference) {
          // Case 2: SKILL.md is @reference → source file is truth
          // Check for both relative and absolute sibling reference patterns
          const isRelativeSiblingRef =
            refCheck.referencePath === `./${skillName}.mdc`;
          const isAbsoluteSiblingRef =
            refCheck.referencePath ===
            `.claude/skills/${skillName}/${skillName}.mdc`;

          if (isRelativeSiblingRef || isAbsoluteSiblingRef) {
            // Sibling reference pattern - validate/update frontmatter if .mdc changed
            if (siblingMdcContent !== null) {
              const { frontmatter: mdcFrontmatter } =
                parseFrontmatter(siblingMdcContent);

              // Update SKILL.md frontmatter if description changed in .mdc
              // Also migrate from relative to absolute path if needed
              const needsUpdate =
                (mdcFrontmatter?.description &&
                  mdcFrontmatter.description !==
                    skillFrontmatter?.description) ||
                isRelativeSiblingRef; // Migrate old relative refs to absolute

              if (needsUpdate) {
                const newFrontmatter = {
                  name: skillFrontmatter?.name || skillName,
                  description:
                    mdcFrontmatter?.description ||
                    skillFrontmatter?.description ||
                    `Skill: ${skillName}`,
                };

                const newSkillMd = `---
${yaml.dump(newFrontmatter, { lineWidth: -1, noRefs: true }).trim()}
---

@.claude/skills/${skillName}/${skillName}.mdc
`;

                if (dryRun) {
                  logVerboseInfo(
                    `DRY RUN: Would update ${skillName}/SKILL.md frontmatter from .mdc`,
                    verbose,
                    dryRun,
                  );
                } else {
                  await fs.writeFile(skillMdPath, newSkillMd, 'utf8');
                  logVerboseInfo(
                    `Updated ${skillName}/SKILL.md frontmatter from .mdc`,
                    verbose,
                    dryRun,
                  );
                }
                synced.push(skillName);
              }
            }
          } else if (refCheck.referencePath) {
            // Pre-0.7 pattern or other external reference - migrate to sibling pattern
            // Determine base path for resolution:
            // - Paths starting with .claude/ are relative to project root
            // - Other paths are relative to the skill folder
            let referencedPath: string;
            if (refCheck.referencePath.startsWith('.claude/')) {
              // Project root is parent of .claude directory (skillsDir is .claude/skills)
              const projectRoot = path.dirname(path.dirname(skillsDir));
              referencedPath = path.join(projectRoot, refCheck.referencePath);
            } else {
              referencedPath = path.resolve(
                skillFolderPath,
                refCheck.referencePath,
              );
            }

            try {
              const referencedContent = await fs.readFile(
                referencedPath,
                'utf8',
              );

              // Parse the referenced file for frontmatter
              const { frontmatter: refFrontmatter, body: refBody } =
                parseFrontmatter(referencedContent);

              // Create sibling .mdc with the content
              let mdcContent: string;
              if (refFrontmatter && Object.keys(refFrontmatter).length > 0) {
                const mdcFrontmatterData: Record<string, unknown> = {};
                if (refFrontmatter.description) {
                  mdcFrontmatterData.description = refFrontmatter.description;
                }
                if (refFrontmatter.globs) {
                  mdcFrontmatterData.globs = refFrontmatter.globs;
                }
                if (refFrontmatter.alwaysApply !== undefined) {
                  mdcFrontmatterData.alwaysApply = refFrontmatter.alwaysApply;
                }

                if (Object.keys(mdcFrontmatterData).length > 0) {
                  mdcContent = `---
${yaml.dump(mdcFrontmatterData, { lineWidth: -1, noRefs: true }).trim()}
---

${refBody}
`;
                } else {
                  mdcContent = refBody;
                }
              } else {
                mdcContent = referencedContent;
              }

              // Update SKILL.md to point to sibling .mdc (absolute path)
              const newFrontmatter = {
                name: skillFrontmatter?.name || skillName,
                description:
                  refFrontmatter?.description ||
                  skillFrontmatter?.description ||
                  `Skill: ${skillName}`,
              };

              const newSkillMd = `---
${yaml.dump(newFrontmatter, { lineWidth: -1, noRefs: true }).trim()}
---

@.claude/skills/${skillName}/${skillName}.mdc
`;

              if (dryRun) {
                logVerboseInfo(
                  `DRY RUN: Would migrate ${skillName} from ${refCheck.referencePath} to sibling pattern`,
                  verbose,
                  dryRun,
                );
              } else {
                await fs.writeFile(siblingMdcPath, mdcContent, 'utf8');
                await fs.writeFile(skillMdPath, newSkillMd, 'utf8');
                logVerboseInfo(
                  `Migrated ${skillName} from ${refCheck.referencePath} to sibling pattern`,
                  verbose,
                  dryRun,
                );
              }
              synced.push(skillName);
            } catch {
              // Referenced file doesn't exist or can't be read
              warnings.push(
                `Cannot migrate ${skillName}: referenced file ${refCheck.referencePath} not found or unreadable`,
              );
            }
          }
        } else {
          // Case 3: SKILL.md has full content → generate sibling .mdc, update to @reference
          // Generate .mdc from SKILL.md body
          const mdcFrontmatter: Record<string, unknown> = {};
          if (skillFrontmatter?.description) {
            mdcFrontmatter.description = skillFrontmatter.description;
          }

          let mdcContent: string;
          if (Object.keys(mdcFrontmatter).length > 0) {
            mdcContent = `---
${yaml.dump(mdcFrontmatter, { lineWidth: -1, noRefs: true }).trim()}
---

${skillBody}
`;
          } else {
            mdcContent = skillBody;
          }

          // Update SKILL.md to @reference (absolute path)
          const newSkillFrontmatter = {
            name: skillFrontmatter?.name || skillName,
            description: skillFrontmatter?.description || `Skill: ${skillName}`,
          };

          const newSkillMd = `---
${yaml.dump(newSkillFrontmatter, { lineWidth: -1, noRefs: true }).trim()}
---

@.claude/skills/${skillName}/${skillName}.mdc
`;

          if (dryRun) {
            logVerboseInfo(
              `DRY RUN: Would generate ${skillName}/${skillName}.mdc and update SKILL.md`,
              verbose,
              dryRun,
            );
          } else {
            await fs.writeFile(siblingMdcPath, mdcContent, 'utf8');
            await fs.writeFile(skillMdPath, newSkillMd, 'utf8');
            logVerboseInfo(
              `Generated ${skillName}/${skillName}.mdc and updated SKILL.md to @reference`,
              verbose,
              dryRun,
            );
          }
          synced.push(skillName);
        }
      }
      // If neither exists, skip - not a valid skill folder
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
 * Migrates all content from .claude/rules to .claude/skills and deletes the rules directory.
 * This is the main entry point for rules migration - it only processes if rules directory exists.
 */
export async function migrateRulesToSkills(
  skillerDir: string,
  verbose: boolean,
  dryRun: boolean,
): Promise<void> {
  const rulesDir = path.join(skillerDir, 'rules');

  // Check if rules directory exists - early exit if not
  try {
    await fs.access(rulesDir);
  } catch {
    // No rules directory - nothing to migrate
    return;
  }

  // Copy skill folders (folders with SKILL.md)
  await copySkillFoldersFromRules(skillerDir, verbose, dryRun);

  // Copy standalone .mdc files
  await copyMdcFilesFromRules(skillerDir, verbose, dryRun);

  // Delete the rules directory after migration
  await deleteRulesDir(skillerDir, verbose, dryRun);
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

/**
 * Copies standalone .mdc files from .claude/rules to .claude/skills/name/name.mdc.
 * These are rule files (not skill folders) that should be available in the skills directory.
 * No SKILL.md is generated - these remain as .mdc files only.
 */
export async function copyMdcFilesFromRules(
  skillerDir: string,
  verbose: boolean,
  dryRun: boolean,
): Promise<string[]> {
  const rulesDir = path.join(skillerDir, 'rules');
  const skillsDir = path.join(skillerDir, 'skills');
  const copiedNames: string[] = [];

  // Check if rules directory exists
  try {
    await fs.access(rulesDir);
  } catch {
    return copiedNames;
  }

  const entries = await fs.readdir(rulesDir, { withFileTypes: true });

  // Find .mdc files at rules root (not in subdirectories)
  const mdcFiles = entries.filter((e) => e.isFile() && e.name.endsWith('.mdc'));

  for (const mdcFile of mdcFiles) {
    const skillName = path.basename(mdcFile.name, '.mdc');
    const sourcePath = path.join(rulesDir, mdcFile.name);
    const targetDir = path.join(skillsDir, skillName);
    const targetPath = path.join(targetDir, mdcFile.name);

    try {
      const content = await fs.readFile(sourcePath, 'utf8');

      // Parse and clean frontmatter - remove globs and alwaysApply: false
      const { frontmatter, body } = parseFrontmatter(content);
      let cleanedContent: string;

      if (frontmatter && Object.keys(frontmatter).length > 0) {
        const cleanedFrontmatter: Record<string, unknown> = {};

        // Only keep description and alwaysApply: true
        if (frontmatter.description) {
          cleanedFrontmatter.description = frontmatter.description;
        }
        if (frontmatter.alwaysApply === true) {
          cleanedFrontmatter.alwaysApply = true;
        }
        // Note: globs and alwaysApply: false are intentionally omitted

        if (Object.keys(cleanedFrontmatter).length > 0) {
          cleanedContent = `---
${yaml.dump(cleanedFrontmatter, { lineWidth: -1, noRefs: true }).trim()}
---

${body}
`;
        } else {
          cleanedContent = body;
        }
      } else {
        cleanedContent = content;
      }

      if (dryRun) {
        logVerboseInfo(
          `DRY RUN: Would copy ${mdcFile.name} from rules to skills/${skillName}/${mdcFile.name}`,
          verbose,
          dryRun,
        );
      } else {
        await fs.mkdir(targetDir, { recursive: true });
        await fs.writeFile(targetPath, cleanedContent, 'utf8');
        logVerboseInfo(
          `Copied ${mdcFile.name} from rules to skills/${skillName}/${mdcFile.name}`,
          verbose,
          dryRun,
        );
      }
      copiedNames.push(skillName);
    } catch (err) {
      logWarn(
        `Failed to copy ${mdcFile.name}: ${(err as Error).message}`,
        dryRun,
      );
    }
  }

  if (copiedNames.length > 0) {
    logVerboseInfo(
      `Copied ${copiedNames.length} .mdc file(s) from rules to skills`,
      verbose,
      dryRun,
    );
  }

  return copiedNames;
}

/**
 * Deletes the .claude/rules directory after content has been migrated to .claude/skills.
 * This completes the migration from the old rules-based structure to the new skills-based structure.
 */
export async function deleteRulesDir(
  skillerDir: string,
  verbose: boolean,
  dryRun: boolean,
): Promise<boolean> {
  const rulesDir = path.join(skillerDir, 'rules');

  // Check if rules directory exists
  try {
    await fs.access(rulesDir);
  } catch {
    return false; // No rules directory to delete
  }

  if (dryRun) {
    logVerboseInfo(
      `DRY RUN: Would delete .claude/rules directory after migration`,
      verbose,
      dryRun,
    );
    return true;
  }

  try {
    await fs.rm(rulesDir, { recursive: true, force: true });
    logVerboseInfo(
      `Deleted .claude/rules directory after migration to .claude/skills`,
      verbose,
      dryRun,
    );
    return true;
  } catch (err) {
    logWarn(
      `Failed to delete .claude/rules: ${(err as Error).message}`,
      dryRun,
    );
    return false;
  }
}
