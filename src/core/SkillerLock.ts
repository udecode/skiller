import * as fs from 'fs/promises';
import * as path from 'path';

export const SKILLER_LOCK_FILENAME = 'skiller-lock.json';
const SKILLER_LOCK_VERSION = 1;

export interface SkillerLockEntry {
  computedHash: string;
  ref?: string;
  source: string;
  sourceRelPath: string;
  sourceType: string;
  subpath?: string;
}

export interface SkillerLockFile {
  skills: Record<string, SkillerLockEntry>;
  version: number;
}

function createEmptyLock(): SkillerLockFile {
  return {
    version: SKILLER_LOCK_VERSION,
    skills: {},
  };
}

export function getSkillerLockPath(projectRoot: string): string {
  return path.join(projectRoot, SKILLER_LOCK_FILENAME);
}

export async function readSkillerLock(
  projectRoot: string,
): Promise<SkillerLockFile> {
  try {
    const raw = JSON.parse(
      await fs.readFile(getSkillerLockPath(projectRoot), 'utf8'),
    ) as SkillerLockFile;
    if (raw.version !== SKILLER_LOCK_VERSION || !raw.skills) {
      return createEmptyLock();
    }
    return raw;
  } catch {
    return createEmptyLock();
  }
}

export async function writeSkillerLock(
  projectRoot: string,
  lock: SkillerLockFile,
): Promise<void> {
  const lockPath = getSkillerLockPath(projectRoot);
  const sortedSkills: Record<string, SkillerLockEntry> = {};

  for (const key of Object.keys(lock.skills).sort((a, b) =>
    a.localeCompare(b),
  )) {
    sortedSkills[key] = lock.skills[key]!;
  }

  if (Object.keys(sortedSkills).length === 0) {
    await fs.rm(lockPath, { force: true });
    return;
  }

  await fs.writeFile(
    lockPath,
    JSON.stringify(
      {
        version: SKILLER_LOCK_VERSION,
        skills: sortedSkills,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
}

export async function upsertSkillerLockEntries(
  projectRoot: string,
  entries: Record<string, SkillerLockEntry>,
): Promise<void> {
  if (Object.keys(entries).length === 0) return;

  const lock = await readSkillerLock(projectRoot);
  lock.skills = {
    ...lock.skills,
    ...entries,
  };
  await writeSkillerLock(projectRoot, lock);
}

export async function removeSkillerLockEntries(
  projectRoot: string,
  skillNames: string[],
): Promise<string[]> {
  if (skillNames.length === 0) return [];

  const lock = await readSkillerLock(projectRoot);
  const removed: string[] = [];

  for (const skillName of skillNames) {
    if (!(skillName in lock.skills)) continue;
    delete lock.skills[skillName];
    removed.push(skillName);
  }

  if (removed.length > 0) {
    await writeSkillerLock(projectRoot, lock);
  }

  return removed.sort((a, b) => a.localeCompare(b));
}

export async function readSkillerLockNames(
  projectRoot: string,
): Promise<Set<string>> {
  const lock = await readSkillerLock(projectRoot);
  return new Set(Object.keys(lock.skills).sort((a, b) => a.localeCompare(b)));
}
