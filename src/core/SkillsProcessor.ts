import type { Dirent } from 'fs';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as yaml from 'js-yaml';
import { SkillInfo } from '../types';
import {
  CANONICAL_SKILLS_PATH,
  SKILL_MD_FILENAME,
  MAX_RECURSION_DEPTH,
  logWarn,
  logVerboseInfo,
} from '../constants';
import { walkSkillsTree, copySkillsDirectory } from './SkillsUtils';
import { parseFrontmatter } from './FrontmatterParser';
import type { IAgent } from '../agents/IAgent';
import {
  isClaudeManifestEntry,
  loadSkillsManifestEntries,
  scrubLegacyLocalSkillsManifest,
  writeSkillsManifestEntries,
  type SkillsManifestEntry,
} from './SkillsManifest';
import {
  resolveSkillOwnership,
} from './SkillOwnership';

const LEGACY_CODEX_SKILLS_PATH = path.join('.codex', 'skills');
const UNIVERSAL_AGENTS_SKILLS_PATH = path.join('.agents', 'skills');

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function resolveProjectSkillsDir(
  projectRoot: string,
  skillerDir?: string,
): Promise<string> {
  if (skillerDir) return path.join(skillerDir, 'skills');

  const canonicalSkillsDir = path.join(projectRoot, '.agents', 'skills');
  if (await pathExists(canonicalSkillsDir)) {
    return canonicalSkillsDir;
  }

  const legacySkillsDir = path.join(projectRoot, '.claude', 'skills');
  if (await pathExists(legacySkillsDir)) {
    return legacySkillsDir;
  }

  return canonicalSkillsDir;
}

async function skillFolderContainsMdc(
  dir: string,
  depth: number = 0,
): Promise<boolean> {
  if (depth >= MAX_RECURSION_DEPTH) return false;

  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.endsWith('.mdc')) {
      return true;
    }
    if (entry.isDirectory()) {
      const nestedHasMdc = await skillFolderContainsMdc(fullPath, depth + 1);
      if (nestedHasMdc) return true;
    }
  }

  return false;
}

async function skillCanBeSymlinked(skillPath: string): Promise<boolean> {
  const skillMdPath = path.join(skillPath, SKILL_MD_FILENAME);
  let skillMdContent: string;

  try {
    skillMdContent = await fs.readFile(skillMdPath, 'utf8');
  } catch {
    return false;
  }

  if (isReferenceBody(parseFrontmatter(skillMdContent).body).isReference) {
    return false;
  }

  return !(await skillFolderContainsMdc(skillPath));
}

async function createRelativeDirectorySymlink(
  sourceDir: string,
  targetDir: string,
): Promise<boolean> {
  try {
    await fs.rm(targetDir, { recursive: true, force: true });
    await fs.mkdir(path.dirname(targetDir), { recursive: true });
    const relativeTarget = path.relative(path.dirname(targetDir), sourceDir);
    await fs.symlink(relativeTarget, targetDir, 'junction');
    return true;
  } catch {
    return false;
  }
}

/**
 * For non-Claude agents, compile a wrapper SKILL.md (body is a single @reference)
 * into a standalone SKILL.md with the referenced file's body inlined.
 *
 * We intentionally keep this conservative: only expand when the body is *just*
 * an @reference line, to avoid accidentally treating email addresses or
 * "@mentions" inside real content as file references.
 */
async function compileSkillMdForNonClaudeAgents(
  skillMdContent: string,
  projectRoot: string,
  skillFolderPath: string,
  options: {
    baseFilePath?: string;
    fallbackReferenceDir?: string;
  } = {},
): Promise<string> {
  const { frontmatter, rawFrontmatter, body } =
    parseFrontmatter(skillMdContent);
  const compiledBodyResult = await inlineReferenceDirectives(
    body,
    projectRoot,
    options.baseFilePath ?? path.join(skillFolderPath, SKILL_MD_FILENAME),
    {
      fallbackReferenceDir: options.fallbackReferenceDir,
    },
  );

  if (!compiledBodyResult.changed) {
    return skillMdContent;
  }

  const fmData =
    rawFrontmatter && Object.keys(rawFrontmatter).length > 0
      ? rawFrontmatter
      : frontmatter && Object.keys(frontmatter).length > 0
        ? frontmatter
        : null;

  if (fmData) {
    return `---
${yaml.dump(fmData, { lineWidth: -1, noRefs: true }).trim()}
---

${compiledBodyResult.body}
`;
  }

  return `${compiledBodyResult.body}\n`;
}

/**
 * Copies a single skill directory to an agent skill directory:
 * - SKILL.md is compiled (inlines @reference wrapper content)
 * - .mdc files are excluded (Claude-only sources)
 * - all other files are copied as-is
 */
async function copySkillDirectoryForNonClaudeAgents(
  src: string,
  dest: string,
  projectRoot: string,
  skillFolderPath: string,
  depth: number = 0,
): Promise<void> {
  // Security: Prevent DoS via deeply nested directories
  if (depth >= MAX_RECURSION_DEPTH) {
    return;
  }

  const stat = await fs.stat(src);

  if (stat.isDirectory()) {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
      // Exclude all .mdc files from agent skills directories.
      if (entry.isFile() && entry.name.endsWith('.mdc')) {
        continue;
      }

      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      await copySkillDirectoryForNonClaudeAgents(
        srcPath,
        destPath,
        projectRoot,
        skillFolderPath,
        depth + 1,
      );
    }
    return;
  }

  // Files
  if (path.basename(src) === SKILL_MD_FILENAME) {
    const content = await fs.readFile(src, 'utf8');
    const compiled = await compileSkillMdForNonClaudeAgents(
      content,
      projectRoot,
      skillFolderPath,
    );
    await fs.writeFile(dest, compiled, 'utf8');
    return;
  }

  // Extra guard: skip .mdc even if reached via recursion.
  if (src.endsWith('.mdc')) {
    return;
  }

  await fs.copyFile(src, dest);
}

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

function parseReferenceDirectiveLine(line: string): {
  pathPart: string;
  fragment?: string;
} | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('@')) return null;

  const raw = trimmed.slice(1);
  const hashIndex = raw.indexOf('#');
  const pathPart = (hashIndex === -1 ? raw : raw.slice(0, hashIndex)).trim();
  const fragment =
    hashIndex === -1 ? undefined : raw.slice(hashIndex + 1).trim() || undefined;

  const looksLikePath =
    pathPart.startsWith('./') ||
    pathPart.startsWith('../') ||
    pathPart.startsWith('.agents/') ||
    pathPart.startsWith('.claude/') ||
    pathPart.includes('/') ||
    /\.[A-Za-z0-9_-]+$/.test(pathPart);

  if (!looksLikePath) return null;

  return { pathPart, fragment };
}

function slugifyHeading(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function extractMarkdownFragment(body: string, fragment?: string): string {
  if (!fragment) return body;

  const lines = body.split('\n');
  const target = fragment.trim();
  const targetSlug = slugifyHeading(target);
  let startIndex = -1;
  let headingLevel = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(#{1,6})\s+(.*)$/.exec(lines[index].trim());
    if (!match) continue;

    const headingText = match[2].trim();
    if (headingText === target || slugifyHeading(headingText) === targetSlug) {
      startIndex = index + 1;
      headingLevel = match[1].length;
      break;
    }
  }

  if (startIndex === -1) return body;

  let endIndex = lines.length;
  for (let index = startIndex; index < lines.length; index += 1) {
    const match = /^(#{1,6})\s+/.exec(lines[index].trim());
    if (match && match[1].length <= headingLevel) {
      endIndex = index;
      break;
    }
  }

  return lines.slice(startIndex, endIndex).join('\n').trim();
}

async function readReferenceDirectiveContent(
  projectRoot: string,
  baseFilePath: string,
  directive: { pathPart: string; fragment?: string },
  options: {
    fallbackReferenceDir?: string;
    visited: Set<string>;
    depth: number;
  },
): Promise<string | null> {
  const candidates: string[] = [];
  const { pathPart, fragment } = directive;

  if (pathPart.startsWith('./') || pathPart.startsWith('../')) {
    candidates.push(path.resolve(path.dirname(baseFilePath), pathPart));
    if (options.fallbackReferenceDir) {
      candidates.push(path.resolve(options.fallbackReferenceDir, pathPart));
    }
  } else {
    candidates.push(path.resolve(projectRoot, pathPart));
  }

  let resolvedPath: string | null = null;
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      resolvedPath = candidate;
      break;
    } catch {
      // Try next candidate.
    }
  }

  if (!resolvedPath) return null;

  const visitKey = `${resolvedPath}#${fragment ?? ''}`;
  if (options.visited.has(visitKey)) {
    return null;
  }
  options.visited.add(visitKey);

  try {
    const rawContent = await fs.readFile(resolvedPath, 'utf8');
    const extension = path.extname(resolvedPath).toLowerCase();

    if (extension === '.md' || extension === '.mdc') {
      const parsed = parseFrontmatter(rawContent);
      const nested = await inlineReferenceDirectives(
        parsed.body,
        projectRoot,
        resolvedPath,
        {
          fallbackReferenceDir: path.dirname(resolvedPath),
          visited: options.visited,
          depth: options.depth + 1,
        },
      );
      return extractMarkdownFragment(nested.body, fragment);
    }

    return rawContent.trim();
  } finally {
    options.visited.delete(visitKey);
  }
}

async function inlineReferenceDirectives(
  body: string,
  projectRoot: string,
  baseFilePath: string,
  options: {
    fallbackReferenceDir?: string;
    visited?: Set<string>;
    depth?: number;
  } = {},
): Promise<{ body: string; changed: boolean }> {
  const depth = options.depth ?? 0;
  if (depth >= MAX_RECURSION_DEPTH) {
    return { body, changed: false };
  }

  const visited = options.visited ?? new Set<string>();
  const lines = body.split('\n');
  const output: string[] = [];
  let changed = false;

  for (const line of lines) {
    const directive = parseReferenceDirectiveLine(line);
    if (!directive) {
      output.push(line);
      continue;
    }

    const referencedContent = await readReferenceDirectiveContent(
      projectRoot,
      baseFilePath,
      directive,
      {
        fallbackReferenceDir: options.fallbackReferenceDir,
        visited,
        depth,
      },
    );

    if (referencedContent === null) {
      output.push(line);
      continue;
    }

    changed = true;
    output.push(referencedContent.trimEnd());
  }

  return {
    body: output.join('\n'),
    changed,
  };
}

function toProjectRelative(projectRoot: string, targetPath: string): string {
  return path.relative(projectRoot, targetPath).replace(/\\/g, '/');
}

function cloneRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function buildCanonicalSkillFrontmatter(
  skillName: string,
  rawFrontmatter: Record<string, unknown> | null,
  options: {
    sourceRelPath?: string;
    alwaysApply?: boolean;
  } = {},
): Record<string, unknown> {
  const next = rawFrontmatter ? { ...rawFrontmatter } : {};
  delete next.globs;
  delete next.alwaysApply;

  next.name = skillName;
  if (
    typeof next.description !== 'string' ||
    next.description.trim().length === 0
  ) {
    next.description = `Skill: ${skillName}`;
  }

  const metadata = cloneRecord(next.metadata);
  const skillerMeta = cloneRecord(metadata.skiller);
  if (options.sourceRelPath) {
    skillerMeta.source = options.sourceRelPath;
  }
  if (options.alwaysApply === true) {
    skillerMeta.alwaysApply = true;
  } else {
    delete skillerMeta.alwaysApply;
  }

  if (Object.keys(skillerMeta).length > 0) {
    metadata.skiller = skillerMeta;
  } else {
    delete metadata.skiller;
  }

  if (Object.keys(metadata).length > 0) {
    next.metadata = metadata;
  } else {
    delete next.metadata;
  }

  return next;
}

function buildCanonicalSkillContent(
  skillName: string,
  rawFrontmatter: Record<string, unknown> | null,
  body: string,
  options: {
    sourceRelPath?: string;
    alwaysApply?: boolean;
  } = {},
): string {
  const frontmatter = buildCanonicalSkillFrontmatter(
    skillName,
    rawFrontmatter,
    options,
  );

  return `---
${yaml.dump(frontmatter, { lineWidth: -1, noRefs: true }).trim()}
---

${body.trim()}
`;
}

function buildRuleSourceContent(
  rawFrontmatter: Record<string, unknown> | null,
  body: string,
): string {
  const next = rawFrontmatter ? { ...rawFrontmatter } : {};
  delete next.name;
  delete next.globs;

  const metadata = cloneRecord(next.metadata);
  const skillerMeta = cloneRecord(metadata.skiller);
  const alwaysApply = skillerMeta.alwaysApply === true;
  delete skillerMeta.source;
  delete skillerMeta.alwaysApply;

  if (Object.keys(skillerMeta).length > 0) {
    metadata.skiller = skillerMeta;
  } else {
    delete metadata.skiller;
  }

  if (Object.keys(metadata).length > 0) {
    next.metadata = metadata;
  } else {
    delete next.metadata;
  }

  if (alwaysApply) {
    next.alwaysApply = true;
  }

  if (Object.keys(next).length === 0) {
    return `${body.trim()}\n`;
  }

  return `---
${yaml.dump(next, { lineWidth: -1, noRefs: true }).trim()}
---

${body.trim()}
`;
}

function flattenNestedFrontmatter(
  rawFrontmatter: Record<string, unknown> | null,
  body: string,
): {
  rawFrontmatter: Record<string, unknown> | null;
  body: string;
} {
  const nested = parseFrontmatter(body);
  if (!nested.rawFrontmatter) {
    return { rawFrontmatter, body };
  }

  return {
    rawFrontmatter: {
      ...(rawFrontmatter ?? {}),
      ...nested.rawFrontmatter,
    },
    body: nested.body,
  };
}

function normalizeRuleSourceContent(content: string): string {
  const parsed = parseFrontmatter(content);
  const flattened = flattenNestedFrontmatter(
    parsed.rawFrontmatter,
    parsed.body,
  );
  return buildRuleSourceContent(flattened.rawFrontmatter, flattened.body);
}

function resolveSkillReferencePath(
  projectRoot: string,
  skillFolderPath: string,
  referencePath: string,
): string {
  return referencePath.startsWith('./') || referencePath.startsWith('../')
    ? path.resolve(skillFolderPath, referencePath)
    : path.resolve(projectRoot, referencePath);
}

async function readLegacyLocalRuleSource(
  projectRoot: string,
  skillFolderPath: string,
  skillMdContent: string,
): Promise<string> {
  const { rawFrontmatter, body } = parseFrontmatter(skillMdContent);
  const refCheck = isReferenceBody(body);

  if (refCheck.isReference && refCheck.referencePath) {
    const referencedPath = resolveSkillReferencePath(
      projectRoot,
      skillFolderPath,
      refCheck.referencePath,
    );
    return fs.readFile(referencedPath, 'utf8');
  }

  const flattened = flattenNestedFrontmatter(rawFrontmatter, body);
  return buildRuleSourceContent(flattened.rawFrontmatter, flattened.body);
}

async function writeFileIfChanged(
  targetPath: string,
  content: string,
  dryRun: boolean,
): Promise<boolean> {
  try {
    const existing = await fs.readFile(targetPath, 'utf8');
    if (existing === content) {
      return false;
    }
  } catch {
    // Write below.
  }

  if (!dryRun) {
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, content, 'utf8');
  }

  return true;
}

async function readNormalizedRuleSourceContent(
  rulePath: string,
): Promise<string | null> {
  try {
    return normalizeRuleSourceContent(await fs.readFile(rulePath, 'utf8'));
  } catch {
    return null;
  }
}

function getFrontmatterBlock(content: string): string | null {
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(content);
  return match ? match[1] : null;
}

function stripQuotedValue(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function extractSkillerSourceRelPathFromFrontmatter(
  content: string,
): string | null {
  const block = getFrontmatterBlock(content);
  if (!block) return null;

  let metadataIndent: number | null = null;
  let skillerIndent: number | null = null;

  for (const line of block.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const indent = line.length - line.trimStart().length;

    if (
      metadataIndent !== null &&
      indent <= metadataIndent &&
      trimmed !== 'metadata:'
    ) {
      metadataIndent = null;
      skillerIndent = null;
    }

    if (
      skillerIndent !== null &&
      indent <= skillerIndent &&
      trimmed !== 'skiller:'
    ) {
      skillerIndent = null;
    }

    if (trimmed === 'metadata:') {
      metadataIndent = indent;
      skillerIndent = null;
      continue;
    }

    if (metadataIndent !== null && trimmed === 'skiller:') {
      skillerIndent = indent;
      continue;
    }

    if (skillerIndent !== null && trimmed.startsWith('source:')) {
      return stripQuotedValue(trimmed.slice('source:'.length));
    }
  }

  return null;
}

async function pruneDuplicateClaudeAliasRules(
  projectRoot: string,
  targetSkillsDirs: string[],
  verbose: boolean,
  dryRun: boolean,
): Promise<string[]> {
  const rulesDir = path.join(projectRoot, '.agents', 'rules');
  const canonicalSkillsDir = path.join(projectRoot, '.agents', 'skills');

  let ruleEntries: Dirent[];
  try {
    ruleEntries = await fs.readdir(rulesDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const pruned: string[] = [];

  for (const entry of ruleEntries) {
    if (!entry.isFile() || !entry.name.endsWith('.mdc')) continue;

    const aliasName = path.basename(entry.name, '.mdc');
    if (!aliasName.startsWith('claude-')) continue;

    const baseName = aliasName.slice('claude-'.length);
    if (!baseName) continue;

    const aliasRulePath = path.join(rulesDir, `${aliasName}.mdc`);
    const baseRulePath = path.join(rulesDir, `${baseName}.mdc`);

    const [aliasRuleContent, baseRuleContent] = await Promise.all([
      readNormalizedRuleSourceContent(aliasRulePath),
      readNormalizedRuleSourceContent(baseRulePath),
    ]);

    if (!aliasRuleContent || !baseRuleContent) continue;
    if (aliasRuleContent !== baseRuleContent) continue;

    const deletePaths = [
      aliasRulePath,
      path.join(canonicalSkillsDir, aliasName),
      path.join(projectRoot, LEGACY_CODEX_SKILLS_PATH, aliasName),
      ...targetSkillsDirs.map((skillsDir) => path.join(skillsDir, aliasName)),
    ];

    if (!dryRun) {
      await Promise.all(
        deletePaths.map((deletePath) =>
          fs.rm(deletePath, { recursive: true, force: true }),
        ),
      );
    }

    pruned.push(aliasName);
    logVerboseInfo(
      dryRun
        ? `DRY RUN: Would prune stale claude alias '${aliasName}' because '${baseName}' already exists with identical local rule content`
        : `Pruned stale claude alias '${aliasName}' because '${baseName}' already exists with identical local rule content`,
      verbose,
      dryRun,
    );
  }

  return pruned;
}

async function pruneCompiledSkillsWithMissingRuleSources(
  projectRoot: string,
  targetSkillsDirs: string[],
  verbose: boolean,
  dryRun: boolean,
): Promise<string[]> {
  const canonicalSkillsDir = path.join(projectRoot, '.agents', 'skills');

  let skillEntries: Dirent[];
  try {
    skillEntries = await fs.readdir(canonicalSkillsDir, {
      withFileTypes: true,
    });
  } catch {
    return [];
  }

  const pruned: string[] = [];

  for (const entry of skillEntries) {
    if (!entry.isDirectory()) continue;

    const skillName = entry.name;
    const skillDir = path.join(canonicalSkillsDir, skillName);
    const skillMdPath = path.join(skillDir, SKILL_MD_FILENAME);

    let skillMdContent: string;
    try {
      skillMdContent = await fs.readFile(skillMdPath, 'utf8');
    } catch {
      continue;
    }

    const sourceRelPath =
      extractSkillerSourceRelPathFromFrontmatter(skillMdContent);

    if (!sourceRelPath?.startsWith('.agents/rules/')) continue;

    const sourcePath = path.resolve(projectRoot, sourceRelPath);
    if (await pathExists(sourcePath)) continue;

    const deletePaths = [
      skillDir,
      path.join(projectRoot, LEGACY_CODEX_SKILLS_PATH, skillName),
      ...targetSkillsDirs.map((skillsDir) => path.join(skillsDir, skillName)),
    ];

    if (!dryRun) {
      await Promise.all(
        deletePaths.map((deletePath) =>
          fs.rm(deletePath, { recursive: true, force: true }),
        ),
      );
    }

    pruned.push(skillName);
    logVerboseInfo(
      dryRun
        ? `DRY RUN: Would prune compiled skill '${skillName}' because its source rule is missing: ${sourceRelPath}`
        : `Pruned compiled skill '${skillName}' because its source rule is missing: ${sourceRelPath}`,
      verbose,
      dryRun,
    );
  }

  return pruned;
}

async function cleanupLegacyClaudeManagedSkillMirrors(
  projectRoot: string,
  targetSkillsDirs: string[],
  verbose: boolean,
  dryRun: boolean,
): Promise<string[]> {
  const cleaned: string[] = [];

  for (const targetSkillsDir of targetSkillsDirs) {
    const entries = await loadSkillsManifestEntries(
      projectRoot,
      targetSkillsDir,
    );
    if (entries.length === 0) continue;

    const legacyClaudeEntries = entries.filter(isClaudeManifestEntry);
    if (legacyClaudeEntries.length === 0) continue;

    const nextEntries: SkillsManifestEntry[] = entries.filter(
      (entry) => !isClaudeManifestEntry(entry),
    );
    const legacyDestPaths = [
      ...new Set(legacyClaudeEntries.map((entry) => entry.destRelPath)),
    ];

    if (!dryRun) {
      await Promise.all(
        legacyDestPaths.map((destRelPath) =>
          fs.rm(path.join(targetSkillsDir, destRelPath), {
            recursive: true,
            force: true,
          }),
        ),
      );
    }

    await writeSkillsManifestEntries(
      projectRoot,
      targetSkillsDir,
      nextEntries,
      dryRun,
    );

    cleaned.push(
      ...legacyDestPaths.map(
        (destRelPath) => `${targetSkillsDir}:${destRelPath}`,
      ),
    );
    for (const destRelPath of legacyDestPaths) {
      logVerboseInfo(
        dryRun
          ? `DRY RUN: Would remove legacy claude-managed skill mirror '${destRelPath}' from ${targetSkillsDir}`
          : `Removed legacy claude-managed skill mirror '${destRelPath}' from ${targetSkillsDir}`,
        verbose,
        dryRun,
      );
    }
  }

  return cleaned;
}

export async function extractLocalRulesFromCanonicalSkills(
  projectRoot: string,
  verbose: boolean,
  dryRun: boolean,
): Promise<{ extracted: string[]; warnings: string[] }> {
  const warnings: string[] = [];
  const extracted: string[] = [];
  const skillsDir = path.join(projectRoot, '.agents', 'skills');
  const rulesDir = path.join(projectRoot, '.agents', 'rules');
  const ownership = await resolveSkillOwnership(projectRoot);

  try {
    await fs.access(skillsDir);
  } catch {
    return { extracted, warnings };
  }

  const entries = await fs.readdir(skillsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const skillName = entry.name;
    if (ownership.upstreamOwned.has(skillName)) {
      continue;
    }

    const rulePath = path.join(rulesDir, `${skillName}.mdc`);
    try {
      await fs.access(rulePath);
      continue;
    } catch {
      // No explicit local rule yet; safe to extract below.
    }

    const skillFolderPath = path.join(skillsDir, skillName);
    const skillMdPath = path.join(skillFolderPath, SKILL_MD_FILENAME);

    let skillMdContent: string;
    try {
      skillMdContent = await fs.readFile(skillMdPath, 'utf8');
    } catch {
      continue;
    }

    try {
      const ruleContent = await readLegacyLocalRuleSource(
        projectRoot,
        skillFolderPath,
        skillMdContent,
      );
      const changed = await writeFileIfChanged(rulePath, ruleContent, dryRun);
      if (changed) {
        logVerboseInfo(
          dryRun
            ? `DRY RUN: Would extract local skill source ${skillName} to ${toProjectRelative(projectRoot, rulePath)}`
            : `Extracted local skill source ${skillName} to ${toProjectRelative(projectRoot, rulePath)}`,
          verbose,
          dryRun,
        );
      }
      extracted.push(skillName);
    } catch (err) {
      warnings.push(
        `Failed to extract local rule source for ${skillName}: ${(err as Error).message}`,
      );
    }
  }

  return { extracted, warnings };
}

export async function compileRulesToSkills(
  skillerDir: string,
  projectRoot: string,
  verbose: boolean,
  dryRun: boolean,
): Promise<{ compiled: string[]; warnings: string[] }> {
  const warnings: string[] = [];
  const compiled: string[] = [];
  const rulesDir = path.join(skillerDir, 'rules');
  const skillsDir = path.join(skillerDir, 'skills');
  const ownership = await resolveSkillOwnership(projectRoot);

  try {
    await fs.access(rulesDir);
  } catch {
    return { compiled, warnings };
  }

  const entries = await fs.readdir(rulesDir, { withFileTypes: true });
  const ruleFiles = entries.filter((entry) => {
    return entry.isFile() && entry.name.endsWith('.mdc');
  });
  for (const ruleFile of ruleFiles) {
    const skillName = path.basename(ruleFile.name, '.mdc');
    if (ownership.upstreamOwned.has(skillName)) {
      throw new Error(
        `Local rule '${skillName}' conflicts with upstream-managed skill '${skillName}' in skills-lock.json`,
      );
    }

    const sourcePath = path.join(rulesDir, ruleFile.name);
    const sourceContent = await fs.readFile(sourcePath, 'utf8');
    const normalizedSourceContent = normalizeRuleSourceContent(sourceContent);
    if (normalizedSourceContent !== sourceContent) {
      await writeFileIfChanged(sourcePath, normalizedSourceContent, dryRun);
    }
    const parsed = parseFrontmatter(normalizedSourceContent);
    const skillFolderPath = path.join(skillsDir, skillName);
    const compiledBodyResult = await inlineReferenceDirectives(
      parsed.body,
      projectRoot,
      sourcePath,
      {
        fallbackReferenceDir: skillFolderPath,
      },
    );
    const compiledContent = buildCanonicalSkillContent(
      skillName,
      parsed.rawFrontmatter,
      compiledBodyResult.body,
      {
        sourceRelPath: toProjectRelative(projectRoot, sourcePath),
        alwaysApply: parsed.frontmatter?.alwaysApply === true,
      },
    );
    const skillMdPath = path.join(skillFolderPath, SKILL_MD_FILENAME);
    const changed = await writeFileIfChanged(
      skillMdPath,
      compiledContent,
      dryRun,
    );

    if (!dryRun) {
      await fs.mkdir(skillFolderPath, { recursive: true });
      const skillEntries = await fs.readdir(skillFolderPath, {
        withFileTypes: true,
      });
      for (const entry of skillEntries) {
        if (entry.isFile() && entry.name.endsWith('.mdc')) {
          await fs.rm(path.join(skillFolderPath, entry.name), {
            force: true,
          });
        }
      }
    }

    if (changed) {
      logVerboseInfo(
        dryRun
          ? `DRY RUN: Would compile ${toProjectRelative(projectRoot, sourcePath)} to ${toProjectRelative(projectRoot, skillMdPath)}`
          : `Compiled ${toProjectRelative(projectRoot, sourcePath)} to ${toProjectRelative(projectRoot, skillMdPath)}`,
        verbose,
        dryRun,
      );
    }

    compiled.push(skillName);
  }

  return { compiled, warnings };
}

export async function normalizeCanonicalSkills(
  projectRoot: string,
  skillsDir: string,
  verbose: boolean,
  dryRun: boolean,
): Promise<{ normalized: string[]; warnings: string[] }> {
  const normalized: string[] = [];
  const warnings: string[] = [];

  try {
    await fs.access(skillsDir);
  } catch {
    return { normalized, warnings };
  }

  const entries = await fs.readdir(skillsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const skillName = entry.name;
    const skillFolderPath = path.join(skillsDir, skillName);
    const skillMdPath = path.join(skillFolderPath, SKILL_MD_FILENAME);

    let skillMdContent: string | null = null;
    try {
      skillMdContent = await fs.readFile(skillMdPath, 'utf8');
    } catch {
      skillMdContent = null;
    }

    let changed = false;

    if (skillMdContent) {
      const compiled = await compileSkillMdForNonClaudeAgents(
        skillMdContent,
        projectRoot,
        skillFolderPath,
        {
          baseFilePath: skillMdPath,
          fallbackReferenceDir: skillFolderPath,
        },
      );
      if (compiled !== skillMdContent) {
        if (!dryRun) {
          await fs.writeFile(skillMdPath, compiled, 'utf8');
        }
        changed = true;
      }
    }

    const folderEntries = await fs.readdir(skillFolderPath, {
      withFileTypes: true,
    });
    const mdcEntries = folderEntries.filter(
      (folderEntry) =>
        folderEntry.isFile() && folderEntry.name.endsWith('.mdc'),
    );
    const legacySingleMdcSourcePath =
      skillMdContent === null && mdcEntries.length === 1
        ? path.join(skillFolderPath, mdcEntries[0].name)
        : null;

    if (legacySingleMdcSourcePath) {
      const sourceContent = await fs.readFile(
        legacySingleMdcSourcePath,
        'utf8',
      );
      const parsed = parseFrontmatter(sourceContent);
      const compiledBodyResult = await inlineReferenceDirectives(
        parsed.body,
        projectRoot,
        legacySingleMdcSourcePath,
        {
          fallbackReferenceDir: skillFolderPath,
        },
      );
      const compiledContent = buildCanonicalSkillContent(
        skillName,
        parsed.rawFrontmatter,
        compiledBodyResult.body,
        {
          sourceRelPath: toProjectRelative(
            projectRoot,
            legacySingleMdcSourcePath,
          ),
          alwaysApply: parsed.frontmatter?.alwaysApply === true,
        },
      );
      if (!dryRun) {
        await fs.writeFile(skillMdPath, compiledContent, 'utf8');
      }
      changed = true;
    } else if (skillMdContent === null && mdcEntries.length > 1) {
      warnings.push(
        `Canonical skill '${skillName}' has multiple legacy .mdc files and no SKILL.md`,
      );
    }

    if (mdcEntries.length > 0) {
      if (!dryRun) {
        for (const mdcEntry of mdcEntries) {
          await fs.rm(path.join(skillFolderPath, mdcEntry.name), {
            force: true,
          });
        }
      }
      changed = true;
    }

    if (changed) {
      normalized.push(skillName);
      logVerboseInfo(
        dryRun
          ? `DRY RUN: Would normalize canonical skill '${skillName}'`
          : `Normalized canonical skill '${skillName}'`,
        verbose,
        dryRun,
      );
    }
  }

  return { normalized, warnings };
}

// Deprecated compatibility shim. Canonical skills are now plain SKILL.md only.
export async function syncMdcToSkillMd(
  skillsDir: string,
  verbose: boolean,
  dryRun: boolean,
): Promise<{ synced: string[]; warnings: string[] }> {
  const projectRoot = path.resolve(skillsDir, '..', '..');
  const { normalized, warnings } = await normalizeCanonicalSkills(
    projectRoot,
    skillsDir,
    verbose,
    dryRun,
  );
  return { synced: normalized, warnings };
}

/**
 * Discovers skills in the project's canonical skills directory.
 * Returns discovered skills, validation warnings, and deleted empty folders.
 */
export async function discoverSkills(
  projectRoot: string,
  skillerDir?: string,
): Promise<{ skills: SkillInfo[]; warnings: string[]; deleted: string[] }> {
  const skillsPath = await resolveProjectSkillsDir(projectRoot, skillerDir);

  // Check if skills directory exists
  try {
    await fs.access(skillsPath);
  } catch {
    // Skills directory doesn't exist - this is fine, just return empty
    return { skills: [], warnings: [], deleted: [] };
  }

  // Walk the skills tree
  return await walkSkillsTree(skillsPath);
}

/**
 * Copies skills from source directory to target agent's skills directory.
 * Validates skill structure and returns copy count and warnings.
 */
export async function copySkillsToAgent(
  sourceSkillsDir: string,
  targetSkillsDir: string,
  projectRoot: string,
  verbose: boolean,
  dryRun: boolean,
): Promise<{ copied: number; warnings: string[] }> {
  const warnings: string[] = [];
  let copied = 0;

  function sanitizeId(value: string): string {
    return value.replace(/[^A-Za-z0-9._-]+/g, '_');
  }

  function flattenRelativeSkillPath(relativeSkillPath: string): string {
    const normalized = relativeSkillPath.replace(/\\/g, '/');
    const segments = normalized.split('/').filter(Boolean);
    return segments.map(sanitizeId).join('-');
  }

  async function rewriteSkillMdName(
    skillMdPath: string,
    name: string,
  ): Promise<void> {
    let content: string;
    try {
      content = await fs.readFile(skillMdPath, 'utf8');
    } catch {
      return;
    }

    const { rawFrontmatter, body } = parseFrontmatter(content);
    const fm: Record<string, unknown> = rawFrontmatter
      ? { ...rawFrontmatter }
      : {};
    fm.name = name;

    const next = `---\n${yaml
      .dump(fm, { lineWidth: -1, noRefs: true })
      .trim()}\n---\n\n${body}\n`;

    await fs.writeFile(skillMdPath, next, 'utf8');
  }

  try {
    await fs.access(sourceSkillsDir);
  } catch {
    // Source directory doesn't exist
    return { copied: 0, warnings: [] };
  }

  // Use walkSkillsTree to discover skills
  const skillsTree = await walkSkillsTree(sourceSkillsDir);

  // Deterministic order so name collision suffixing is stable.
  const sortedSkills = [...skillsTree.skills].sort((a, b) => {
    const ar = path.relative(sourceSkillsDir, a.path).replace(/\\/g, '/');
    const br = path.relative(sourceSkillsDir, b.path).replace(/\\/g, '/');
    return ar.localeCompare(br);
  });

  const taken = new Set<string>();

  // Validate and copy each skill
  for (const skill of sortedSkills) {
    // skill.path is absolute, use it directly
    const skillPath = skill.path;
    const skillMdPath = path.join(skillPath, SKILL_MD_FILENAME);

    // Validate: skill must have SKILL.md
    try {
      await fs.access(skillMdPath);
    } catch {
      warnings.push(
        `Skill '${skill.name}' missing required SKILL.md file, skipping`,
      );
      continue;
    }

    // Flatten nested skills into root-level skill folders for other agents:
    // `category/foo` -> `category-foo`
    const relativeSkillPath = path.relative(sourceSkillsDir, skill.path);
    const baseDestName = flattenRelativeSkillPath(relativeSkillPath);
    let destName = baseDestName;
    let i = 2;
    while (taken.has(destName)) {
      destName = `${baseDestName}-${i++}`;
    }
    taken.add(destName);

    const targetSkillPath = path.join(targetSkillsDir, destName);
    const sourceLeafName = path.basename(skillPath);

    if (!dryRun) {
      const symlinkSafe =
        destName === sourceLeafName && (await skillCanBeSymlinked(skillPath));
      const symlinkCreated =
        symlinkSafe &&
        (await createRelativeDirectorySymlink(skillPath, targetSkillPath));

      if (!symlinkCreated) {
        await copySkillDirectoryForNonClaudeAgents(
          skillPath,
          targetSkillPath,
          projectRoot,
          skillPath,
        );
      }

      if (!symlinkCreated && destName !== sourceLeafName) {
        await rewriteSkillMdName(
          path.join(targetSkillPath, SKILL_MD_FILENAME),
          destName,
        );
      }
    }

    logVerboseInfo(
      dryRun
        ? `DRY RUN: Would copy skill '${skill.name}' to ${targetSkillsDir}`
        : `Copied skill '${skill.name}' to ${targetSkillsDir}`,
      verbose,
      dryRun,
    );
    copied++;
  }

  return { copied, warnings };
}

/**
 * Gets the paths that skills will generate, for gitignore purposes.
 * Collects paths from all agents with native skills support, excluding the canonical source.
 */
export function getSkillsGitignorePaths(
  projectRoot: string,
  agents: IAgent[],
): string[] {
  const paths: string[] = [];
  const sourceSkillsPath = path.join(projectRoot, CANONICAL_SKILLS_PATH);

  for (const agent of agents) {
    if (agent.supportsNativeSkills?.() && agent.getSkillsPath) {
      const skillsPath = agent.getSkillsPath(projectRoot);
      if (skillsPath && skillsPath !== sourceSkillsPath) {
        // Convert to relative path for gitignore
        const relativePath = path.relative(projectRoot, skillsPath);
        // Deduplicate paths
        if (!paths.includes(relativePath)) {
          paths.push(relativePath);
        }
      }
    }
  }

  return paths;
}

/**
 * Propagates skills for agents that need them.
 * Canonical skills live in .agents/skills, and local .mdc authoring lives in .agents/rules.
 */
export async function propagateSkills(
  projectRoot: string,
  agents: IAgent[],
  skillsEnabled: boolean,
  verbose: boolean,
  dryRun: boolean,
  skillerDir?: string,
): Promise<void> {
  async function migrateLegacyCodexSkillsDir(
    currentSourceSkillsDir: string,
    destinationPaths: Set<string>,
  ): Promise<void> {
    const universalSkillsDir = path.join(
      projectRoot,
      UNIVERSAL_AGENTS_SKILLS_PATH,
    );
    const legacyCodexSkillsDir = path.join(
      projectRoot,
      LEGACY_CODEX_SKILLS_PATH,
    );

    if (
      currentSourceSkillsDir !== universalSkillsDir &&
      !destinationPaths.has(universalSkillsDir)
    ) {
      return;
    }

    try {
      await fs.access(legacyCodexSkillsDir);
    } catch {
      return;
    }

    logVerboseInfo(
      dryRun
        ? `DRY RUN: Would migrate legacy Codex skills from ${legacyCodexSkillsDir} to ${universalSkillsDir}`
        : `Migrating legacy Codex skills from ${legacyCodexSkillsDir} to ${universalSkillsDir}`,
      verbose,
      dryRun,
    );

    if (dryRun) return;

    await fs.mkdir(path.dirname(universalSkillsDir), { recursive: true });

    try {
      await fs.access(universalSkillsDir);
      const entries = await fs.readdir(legacyCodexSkillsDir, {
        withFileTypes: true,
      });

      for (const entry of entries) {
        const sourcePath = path.join(legacyCodexSkillsDir, entry.name);
        const targetPath = path.join(universalSkillsDir, entry.name);

        try {
          await fs.access(targetPath);
          await fs.rm(sourcePath, { recursive: true, force: true });
        } catch {
          await fs.rename(sourcePath, targetPath);
        }
      }

      await fs.rmdir(legacyCodexSkillsDir).catch(() => undefined);
    } catch {
      await fs.rename(legacyCodexSkillsDir, universalSkillsDir);
    }
  }

  if (!skillsEnabled) {
    logVerboseInfo('Skills support disabled', verbose, dryRun);
    return;
  }

  // Determine canonical skills directory, with legacy fallback for migration.
  const skillsDir = await resolveProjectSkillsDir(projectRoot, skillerDir);

  // Compute destinations up-front so cleanup + legacy codex migration can de-duplicate targets.
  const destinationPaths = new Set<string>();
  for (const agent of agents) {
    if (agent.supportsNativeSkills?.() && agent.getSkillsPath) {
      const targetPath = agent.getSkillsPath(projectRoot);
      if (targetPath && targetPath !== skillsDir) {
        destinationPaths.add(targetPath);
      }
    }
  }

  if (skillerDir) {
    await scrubLegacyLocalSkillsManifest(projectRoot, dryRun);

    await pruneCompiledSkillsWithMissingRuleSources(
      projectRoot,
      [...destinationPaths],
      verbose,
      dryRun,
    );

    await pruneDuplicateClaudeAliasRules(
      projectRoot,
      [...destinationPaths],
      verbose,
      dryRun,
    );

    const compileResult = await compileRulesToSkills(
      skillerDir,
      projectRoot,
      verbose,
      dryRun,
    );
    for (const warning of compileResult.warnings) {
      logWarn(warning, dryRun);
    }
  }

  await migrateLegacyCodexSkillsDir(skillsDir, destinationPaths);

  if (destinationPaths.size > 0) {
    await cleanupLegacyClaudeManagedSkillMirrors(
      projectRoot,
      [...destinationPaths],
      verbose,
      dryRun,
    );
  }

  if (skillerDir) {
    await pruneDuplicateClaudeAliasRules(
      projectRoot,
      [...destinationPaths],
      verbose,
      dryRun,
    );
  }

  // Check if skills directory exists
  let skillsDirExists = true;
  try {
    await fs.access(skillsDir);
  } catch {
    skillsDirExists = false;
    logVerboseInfo(`No skills directory found`, verbose, dryRun);
  }

  const ownership = await resolveSkillOwnership(projectRoot);
  for (const warning of ownership.warnings) {
    logWarn(warning, dryRun);
  }

  if (skillsDirExists) {
    const normalizeResult = await normalizeCanonicalSkills(
      projectRoot,
      skillsDir,
      verbose,
      dryRun,
    );
    for (const warning of normalizeResult.warnings) {
      logWarn(warning, dryRun);
    }

    // Discover and validate skills
    const { skills, warnings, deleted } = await discoverSkills(
      projectRoot,
      skillerDir,
    );

    if (deleted.length > 0) {
      logVerboseInfo(
        `Deleted ${deleted.length} empty folder(s): ${deleted.join(', ')}`,
        verbose,
        dryRun,
      );
    }

    if (warnings.length > 0) {
      for (const warning of warnings) {
        logWarn(warning, dryRun);
      }
    }

    if (skills.length === 0) {
      logVerboseInfo(
        'No valid skills found in project skills directory',
        verbose,
        dryRun,
      );
    } else {
      logVerboseInfo(`Discovered ${skills.length} skill(s)`, verbose, dryRun);

      // Copy skills to each unique destination
      for (const targetPath of destinationPaths) {
        const result = await copySkillsToAgent(
          skillsDir,
          targetPath,
          projectRoot,
          verbose,
          dryRun,
        );

        if (result.copied > 0) {
          logVerboseInfo(
            `Copied ${result.copied} skill(s) to ${targetPath}`,
            verbose,
            dryRun,
          );
        }

        for (const warning of result.warnings) {
          logWarn(warning, dryRun);
        }
      }
    }
  }
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

      if (frontmatter?.alwaysApply === true) {
        // Only alwaysApply rules keep frontmatter (with description since no SKILL.md)
        const cleanedFrontmatter: Record<string, unknown> = {
          alwaysApply: true,
        };
        if (frontmatter.description) {
          cleanedFrontmatter.description = frontmatter.description;
        }

        cleanedContent = `---
${yaml.dump(cleanedFrontmatter, { lineWidth: -1, noRefs: true }).trim()}
---

${body}
`;
      } else {
        // Regular skills: strip all frontmatter (description goes in SKILL.md)
        cleanedContent = body;
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
