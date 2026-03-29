import * as fs from 'fs/promises';
import * as path from 'path';
import { scrubLegacyLocalSkillsManifest } from './SkillsManifest';
import { CANONICAL_SKILLER_DIR } from './project-paths';

const SEARCH_API_BASE = process.env.SKILLS_API_URL || 'https://skills.sh';

export interface SkillsRegistryMatch {
  installs: number;
  name: string;
  slug: string;
  source: string;
}

export interface RuleReplacementCandidate {
  alreadyInstalled: boolean;
  matches: SkillsRegistryMatch[];
  ruleName: string;
}

export interface RulesToSkillsMigrationPlan {
  candidates: RuleReplacementCandidate[];
  missingRequested: string[];
  scannedRules: string[];
  unmatched: string[];
}

function normalizeRuleName(value: string): string {
  return value.endsWith('.mdc') ? path.basename(value, '.mdc') : value;
}

function normalizeInstalledSkillName(value: string): string {
  return value.replace(/:/g, '-');
}

function getRulesDir(projectRoot: string): string {
  return path.join(projectRoot, CANONICAL_SKILLER_DIR, 'rules');
}

async function listRuleNames(projectRoot: string): Promise<string[]> {
  const rulesDir = getRulesDir(projectRoot);

  try {
    const entries = await fs.readdir(rulesDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.mdc'))
      .map((entry) => path.basename(entry.name, '.mdc'))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

async function loadInstalledSkillNames(
  projectRoot: string,
): Promise<Set<string>> {
  const skillsLockPath = path.join(projectRoot, 'skills-lock.json');

  try {
    const raw = JSON.parse(await fs.readFile(skillsLockPath, 'utf8')) as {
      skills?: Record<string, unknown>;
    };
    return new Set(
      Object.keys(raw.skills ?? {}).map(normalizeInstalledSkillName),
    );
  } catch {
    return new Set<string>();
  }
}

function mapRegistrySkill(raw: unknown): SkillsRegistryMatch | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;

  if (
    typeof record.name !== 'string' ||
    typeof record.id !== 'string' ||
    (record.source !== undefined && typeof record.source !== 'string') ||
    (record.installs !== undefined && typeof record.installs !== 'number')
  ) {
    return null;
  }

  return {
    installs: typeof record.installs === 'number' ? record.installs : 0,
    name: record.name,
    slug: record.id,
    source: typeof record.source === 'string' ? record.source : '',
  };
}

async function searchSkillsApi(query: string): Promise<SkillsRegistryMatch[]> {
  try {
    const url = `${SEARCH_API_BASE}/api/search?q=${encodeURIComponent(query)}&limit=10`;
    const response = await fetch(url);
    if (!response.ok) return [];

    const payload = (await response.json()) as {
      skills?: unknown[];
    };

    return (payload.skills ?? [])
      .map(mapRegistrySkill)
      .filter((skill): skill is SkillsRegistryMatch => skill !== null)
      .sort((a, b) => b.installs - a.installs);
  } catch {
    return [];
  }
}

function isExactRuleMatch(
  ruleName: string,
  match: SkillsRegistryMatch,
): boolean {
  const normalizedRuleName = ruleName.toLowerCase();
  const normalizedSkillName = match.name.toLowerCase();
  const slugParts = match.slug.split('/').filter(Boolean);
  const normalizedSlugName = (
    slugParts.length > 0 ? slugParts[slugParts.length - 1] : ''
  ).toLowerCase();

  return (
    normalizedSkillName === normalizedRuleName ||
    normalizedSlugName === normalizedRuleName
  );
}

function dedupeNames(values: string[]): string[] {
  return [...new Set(values.map(normalizeRuleName))].sort((a, b) =>
    a.localeCompare(b),
  );
}

function sourceFromSlug(slug: string): string {
  const parts = slug.split('/').filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]}/${parts[1]}`;
  }

  return slug;
}

export function buildRulesReplacementInstallArgs(
  match: SkillsRegistryMatch,
): string[] {
  const source = match.source || sourceFromSlug(match.slug);
  return ['add', source, '--agent', 'universal', '--skill', match.name, '-y'];
}

export async function removeLocalRuleReplacementState(
  projectRoot: string,
  ruleName: string,
  dryRun: boolean,
): Promise<void> {
  const rulesDir = getRulesDir(projectRoot);
  const rulePath = path.join(rulesDir, `${ruleName}.mdc`);

  if (!dryRun) {
    await fs.rm(rulePath, { force: true });
  }
  await scrubLegacyLocalSkillsManifest(projectRoot, dryRun);
}

export async function planRulesToSkillsMigration(
  projectRoot: string,
  requestedRuleNames?: string[],
): Promise<RulesToSkillsMigrationPlan> {
  const availableRuleNames = await listRuleNames(projectRoot);
  const selectedRuleNames =
    requestedRuleNames && requestedRuleNames.length > 0
      ? dedupeNames(requestedRuleNames)
      : availableRuleNames;

  const availableRuleSet = new Set(availableRuleNames);
  const missingRequested = selectedRuleNames.filter(
    (ruleName) => !availableRuleSet.has(ruleName),
  );
  const installedSkillNames = await loadInstalledSkillNames(projectRoot);

  const candidates: RuleReplacementCandidate[] = [];
  const unmatched: string[] = [];

  for (const ruleName of selectedRuleNames) {
    if (!availableRuleSet.has(ruleName)) continue;

    const exactMatches = (await searchSkillsApi(ruleName)).filter((match) =>
      isExactRuleMatch(ruleName, match),
    );

    if (exactMatches.length === 0) {
      unmatched.push(ruleName);
      continue;
    }

    candidates.push({
      alreadyInstalled: installedSkillNames.has(ruleName),
      matches: exactMatches,
      ruleName,
    });
  }

  return {
    candidates,
    missingRequested,
    scannedRules: selectedRuleNames.filter((ruleName) =>
      availableRuleSet.has(ruleName),
    ),
    unmatched,
  };
}
