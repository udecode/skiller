import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import {
  CANONICAL_SKILLER_DIR,
  LEGACY_SKILLER_DIR,
  PROJECT_AGENTS_FILE,
  SKILLER_CONFIG_FILE,
} from './project-paths';
import { loadLocalSkillNames, writeLocalSkillNames } from './SkillsManifest';
import { parseFrontmatter } from './FrontmatterParser';

export interface ResolvedSkillOwnership {
  upstreamOwned: Set<string>;
  localOwned: Set<string>;
  orphaned: Set<string>;
  conflicts: string[];
  warnings: string[];
}

function normalizeSkillNameForFilesystem(name: string): string {
  return name.replace(/:/g, '-');
}

function getSkillsLockPath(projectRoot: string): string {
  return path.join(projectRoot, 'skills-lock.json');
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function buffersEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && a.equals(b);
}

const LEGACY_AGENT_ID_MAP: Record<string, string> = {
  claude: 'claude-code',
  copilot: 'github-copilot',
  augmentcode: 'augment',
  kilocode: 'kilo',
  kiro: 'kiro-cli',
  qwen: 'qwen-code',
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function rewriteLegacyAgentIdsInToml(content: string): string {
  let rewritten = content;

  rewritten = rewritten.replace(
    /^(default_agents\s*=\s*\[)([\s\S]*?)(\])/m,
    (_match, prefix: string, body: string, suffix: string) => {
      const rewrittenBody = body.replace(/"([^"]+)"/g, (quoted, id: string) => {
        const mapped = LEGACY_AGENT_ID_MAP[id];
        return mapped ? `"${mapped}"` : quoted;
      });
      return `${prefix}${rewrittenBody}${suffix}`;
    },
  );

  for (const [legacyId, canonicalId] of Object.entries(LEGACY_AGENT_ID_MAP)) {
    const pattern = new RegExp(
      `^(\\[agents\\.)${escapeRegExp(legacyId)}(?=(?:\\.|\\]))`,
      'gm',
    );
    rewritten = rewritten.replace(pattern, `$1${canonicalId}`);
  }

  return rewritten;
}

function isReferenceBody(body: string): string | null {
  const lines = body.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length !== 1) return null;
  const line = lines[0].trim();
  return line.startsWith('@') ? line.slice(1) : null;
}

function inferProjectRootFromSkillFile(filePath: string): string {
  let current = path.dirname(filePath);
  while (true) {
    const base = path.basename(current);
    if (base === CANONICAL_SKILLER_DIR || base === LEGACY_SKILLER_DIR) {
      return path.dirname(current);
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return path.dirname(path.dirname(filePath));
    }
    current = parent;
  }
}

async function normalizeSkillDocumentContent(
  filePath: string,
  content: Buffer,
): Promise<Buffer> {
  if (path.basename(filePath) !== 'SKILL.md') {
    return content;
  }

  const text = content.toString('utf8');
  const { frontmatter, rawFrontmatter, body } = parseFrontmatter(text);
  const referencePath = isReferenceBody(body);
  let normalizedBody = body;

  if (referencePath) {
    const skillFolderPath = path.dirname(filePath);
    const projectRoot = inferProjectRootFromSkillFile(filePath);
    const absoluteRefPath =
      referencePath.startsWith('./') || referencePath.startsWith('../')
        ? path.resolve(skillFolderPath, referencePath)
        : path.resolve(projectRoot, referencePath);

    try {
      const referencedContent = await fs.readFile(absoluteRefPath, 'utf8');
      normalizedBody = parseFrontmatter(referencedContent).body;
    } catch {
      return content;
    }
  }

  const frontmatterData =
    rawFrontmatter && Object.keys(rawFrontmatter).length > 0
      ? rawFrontmatter
      : frontmatter && Object.keys(frontmatter).length > 0
        ? frontmatter
        : null;

  if (!frontmatterData) {
    return Buffer.from(`${normalizedBody.trimEnd()}\n`);
  }

  return Buffer.from(`---
${yaml.dump(frontmatterData, { lineWidth: -1, noRefs: true }).trim()}
---

${normalizedBody.trimEnd()}
`);
}

async function filesAreEquivalent(
  leftPath: string,
  leftContent: Buffer,
  rightPath: string,
  rightContent: Buffer,
): Promise<boolean> {
  if (buffersEqual(leftContent, rightContent)) return true;

  const [normalizedLeft, normalizedRight] = await Promise.all([
    normalizeSkillDocumentContent(leftPath, leftContent),
    normalizeSkillDocumentContent(rightPath, rightContent),
  ]);

  return buffersEqual(normalizedLeft, normalizedRight);
}

async function collectFilesRecursive(
  dir: string,
  prefix: string = '',
): Promise<Array<{ relativePath: string; content: Buffer }>> {
  const collected: Array<{ relativePath: string; content: Buffer }> = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const relativePath = prefix ? path.join(prefix, entry.name) : entry.name;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      collected.push(...(await collectFilesRecursive(fullPath, relativePath)));
      continue;
    }

    if (entry.isFile()) {
      collected.push({
        relativePath,
        content: await fs.readFile(fullPath),
      });
    }
  }

  return collected;
}

async function planBufferWrite(
  destinationPath: string,
  content: Buffer,
  sourceLabel: string,
  plannedWrites: Map<string, Buffer>,
  conflicts: string[],
): Promise<void> {
  const planned = plannedWrites.get(destinationPath);
  if (planned) {
    if (!buffersEqual(planned, content)) {
      conflicts.push(
        `${sourceLabel} conflicts with planned write ${destinationPath}`,
      );
    }
    return;
  }

  try {
    const stat = await fs.stat(destinationPath);
    if (!stat.isFile()) {
      conflicts.push(
        `${sourceLabel} conflicts with existing directory ${destinationPath}`,
      );
      return;
    }

    const existing = await fs.readFile(destinationPath);
    if (
      !(await filesAreEquivalent(
        sourceLabel,
        content,
        destinationPath,
        existing,
      ))
    ) {
      conflicts.push(
        `${sourceLabel} conflicts with existing file ${destinationPath}`,
      );
    }
    return;
  } catch {
    plannedWrites.set(destinationPath, content);
  }
}

async function planFileMigration(
  sourcePath: string,
  destinationPath: string,
  plannedWrites: Map<string, Buffer>,
  deletePaths: Set<string>,
  conflicts: string[],
): Promise<void> {
  if (!(await pathExists(sourcePath))) return;

  await planBufferWrite(
    destinationPath,
    await fs.readFile(sourcePath),
    sourcePath,
    plannedWrites,
    conflicts,
  );

  if (conflicts.length === 0) {
    deletePaths.add(sourcePath);
  }
}

async function planDirectoryMigration(
  sourceDir: string,
  destinationDir: string,
  plannedWrites: Map<string, Buffer>,
  deletePaths: Set<string>,
  conflicts: string[],
): Promise<void> {
  if (!(await pathExists(sourceDir))) return;

  for (const entry of await collectFilesRecursive(sourceDir)) {
    await planBufferWrite(
      path.join(destinationDir, entry.relativePath),
      entry.content,
      path.join(sourceDir, entry.relativePath),
      plannedWrites,
      conflicts,
    );
  }

  if (conflicts.length === 0) {
    deletePaths.add(sourceDir);
  }
}

async function findRuleSkillFolders(dir: string): Promise<string[]> {
  const folders: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const fullPath = path.join(dir, entry.name);
    if (await pathExists(path.join(fullPath, 'SKILL.md'))) {
      folders.push(fullPath);
      continue;
    }

    folders.push(...(await findRuleSkillFolders(fullPath)));
  }

  return folders;
}

async function planLegacyRulesMigration(
  legacyRulesDir: string,
  canonicalRulesDir: string,
  canonicalSkillsDir: string,
  plannedWrites: Map<string, Buffer>,
  deletePaths: Set<string>,
  conflicts: string[],
): Promise<void> {
  if (!(await pathExists(legacyRulesDir))) return;

  const entries = await fs.readdir(legacyRulesDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.mdc')) continue;

    const sourcePath = path.join(legacyRulesDir, entry.name);
    const ruleDestination = path.join(canonicalRulesDir, entry.name);

    await planBufferWrite(
      ruleDestination,
      await fs.readFile(sourcePath),
      sourcePath,
      plannedWrites,
      conflicts,
    );
  }

  const skillFolders = await findRuleSkillFolders(legacyRulesDir);
  for (const folder of skillFolders) {
    const folderName = path.basename(folder);
    await planDirectoryMigration(
      folder,
      path.join(canonicalSkillsDir, folderName),
      plannedWrites,
      deletePaths,
      conflicts,
    );
  }

  if (conflicts.length === 0) {
    deletePaths.add(legacyRulesDir);
  }
}

export function getCanonicalSkillsDir(projectRoot: string): string {
  return path.join(projectRoot, CANONICAL_SKILLER_DIR, 'skills');
}

export function getCanonicalRulesDir(projectRoot: string): string {
  return path.join(projectRoot, CANONICAL_SKILLER_DIR, 'rules');
}

async function readLocalRuleSkillNames(
  projectRoot: string,
): Promise<Set<string>> {
  try {
    const entries = await fs.readdir(getCanonicalRulesDir(projectRoot), {
      withFileTypes: true,
    });
    return new Set(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.mdc'))
        .map((entry) => path.basename(entry.name, '.mdc'))
        .sort((a, b) => a.localeCompare(b)),
    );
  } catch {
    return new Set();
  }
}

async function readCanonicalSkillNames(
  projectRoot: string,
): Promise<Set<string>> {
  try {
    const entries = await fs.readdir(getCanonicalSkillsDir(projectRoot), {
      withFileTypes: true,
    });
    return new Set(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b)),
    );
  } catch {
    return new Set();
  }
}

export async function readUpstreamOwnedSkillNames(
  projectRoot: string,
): Promise<Set<string>> {
  try {
    const raw = JSON.parse(
      await fs.readFile(getSkillsLockPath(projectRoot), 'utf8'),
    ) as { skills?: Record<string, unknown> };
    return new Set(
      Object.keys(raw.skills ?? {})
        .map(normalizeSkillNameForFilesystem)
        .sort((a, b) => a.localeCompare(b)),
    );
  } catch {
    return new Set();
  }
}

export async function resolveSkillOwnership(
  projectRoot: string,
): Promise<ResolvedSkillOwnership> {
  const upstreamOwned = await readUpstreamOwnedSkillNames(projectRoot);
  const localOwned = new Set([
    ...(await loadLocalSkillNames(projectRoot)),
    ...(await readLocalRuleSkillNames(projectRoot)),
  ]);
  const canonicalSkillNames = await readCanonicalSkillNames(projectRoot);

  const allExplicitNames = new Set<string>([...upstreamOwned, ...localOwned]);
  const orphaned = new Set(
    [...canonicalSkillNames]
      .filter((name) => !allExplicitNames.has(name))
      .sort((a, b) => a.localeCompare(b)),
  );

  const conflicts = [...allExplicitNames]
    .filter((name) => {
      let owners = 0;
      if (upstreamOwned.has(name)) owners += 1;
      if (localOwned.has(name)) owners += 1;
      return owners > 1;
    })
    .sort((a, b) => a.localeCompare(b));

  const warnings = [
    ...conflicts.map((name) => {
      const owners: string[] = [];
      if (upstreamOwned.has(name)) owners.push('skills-lock.json');
      if (localOwned.has(name))
        owners.push('local rules/.agents/.skiller.json');
      return `Skill '${name}' has mixed ownership: ${owners.join(', ')}`;
    }),
    ...[...orphaned].map((name) => {
      return `Canonical skill '${name}' is unmanaged; leaving it untouched because it is not in skills-lock.json, .agents/rules/${name}.mdc, or .agents/.skiller.json localSkills.`;
    }),
  ];

  return {
    upstreamOwned,
    localOwned,
    orphaned,
    conflicts,
    warnings,
  };
}

export async function adoptSkillerOwnedSkillNames(
  projectRoot: string,
  skillNames: string[],
  dryRun: boolean,
): Promise<void> {
  if (skillNames.length === 0) return;

  const ownership = await resolveSkillOwnership(projectRoot);
  const next = new Set(ownership.localOwned);

  for (const name of skillNames) {
    if (ownership.upstreamOwned.has(name)) continue;
    next.add(name);
  }

  await writeLocalSkillNames(projectRoot, [...next], dryRun);
}

export async function syncSkillerOwnedSkillNamesFromRules(
  projectRoot: string,
  dryRun: boolean,
): Promise<string[]> {
  const rulesDir = path.join(projectRoot, CANONICAL_SKILLER_DIR, 'rules');
  let ruleNames: string[] = [];

  try {
    const entries = await fs.readdir(rulesDir, { withFileTypes: true });
    ruleNames = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.mdc'))
      .map((entry) => path.basename(entry.name, '.mdc'))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    ruleNames = [];
  }

  const upstreamOwned = await readUpstreamOwnedSkillNames(projectRoot);
  const nextLocalSkillNames = ruleNames.filter((name) => {
    return !upstreamOwned.has(name);
  });

  await writeLocalSkillNames(projectRoot, nextLocalSkillNames, dryRun);

  return nextLocalSkillNames;
}

export async function migrateLegacyProjectState(
  projectRoot: string,
  dryRun: boolean,
): Promise<void> {
  const legacyDir = path.join(projectRoot, LEGACY_SKILLER_DIR);
  const canonicalDir = path.join(projectRoot, CANONICAL_SKILLER_DIR);
  const canonicalSkillsDir = path.join(canonicalDir, 'skills');
  const canonicalRulesDir = path.join(canonicalDir, 'rules');

  try {
    await fs.access(legacyDir);
  } catch {
    return;
  }

  const plannedWrites = new Map<string, Buffer>();
  const deletePaths = new Set<string>();
  const conflicts: string[] = [];

  await planFileMigration(
    path.join(legacyDir, '.skiller.json'),
    path.join(canonicalDir, '.skiller.json'),
    plannedWrites,
    deletePaths,
    conflicts,
  );
  const legacyConfigPath = path.join(legacyDir, SKILLER_CONFIG_FILE);
  if (await pathExists(legacyConfigPath)) {
    await planBufferWrite(
      path.join(canonicalDir, SKILLER_CONFIG_FILE),
      Buffer.from(
        rewriteLegacyAgentIdsInToml(
          await fs.readFile(legacyConfigPath, 'utf8'),
        ),
      ),
      legacyConfigPath,
      plannedWrites,
      conflicts,
    );
    if (conflicts.length === 0) {
      deletePaths.add(legacyConfigPath);
    }
  }
  await planFileMigration(
    path.join(legacyDir, PROJECT_AGENTS_FILE),
    path.join(canonicalDir, PROJECT_AGENTS_FILE),
    plannedWrites,
    deletePaths,
    conflicts,
  );
  await planDirectoryMigration(
    path.join(legacyDir, 'skills'),
    canonicalSkillsDir,
    plannedWrites,
    deletePaths,
    conflicts,
  );
  await planLegacyRulesMigration(
    path.join(legacyDir, 'rules'),
    canonicalRulesDir,
    canonicalSkillsDir,
    plannedWrites,
    deletePaths,
    conflicts,
  );

  if (conflicts.length > 0) {
    throw new Error(
      `Legacy .claude migration conflicts:\n- ${conflicts.join('\n- ')}`,
    );
  }

  if (dryRun) return;

  for (const [destinationPath, content] of plannedWrites.entries()) {
    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    await fs.writeFile(destinationPath, content);
  }

  for (const deletePath of [...deletePaths].sort(
    (a, b) => b.length - a.length,
  )) {
    await fs.rm(deletePath, { recursive: true, force: true });
  }

  if (await pathExists(canonicalSkillsDir)) {
    const {
      compileRulesToSkills,
      extractLocalRulesFromCanonicalSkills,
      normalizeCanonicalSkills,
    } = await import('./SkillsProcessor');
    await extractLocalRulesFromCanonicalSkills(projectRoot, false, false);
    await compileRulesToSkills(canonicalDir, projectRoot, false, false);
    await normalizeCanonicalSkills(
      projectRoot,
      canonicalSkillsDir,
      false,
      false,
    );
  }
}
