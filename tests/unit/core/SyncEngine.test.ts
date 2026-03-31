import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { syncProjectFiles } from '../../../src/core/SyncEngine';

async function writeFile(targetPath: string, content: string): Promise<void> {
	await fs.mkdir(path.dirname(targetPath), { recursive: true });
	await fs.writeFile(targetPath, content);
}

describe('SyncEngine', () => {
	let projectRoot: string;

	beforeEach(async () => {
		projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'skiller-sync-'));
		await writeFile(
			path.join(projectRoot, '.agents', 'AGENTS.md'),
			'# Local AGENTS\n',
		);
	});

	afterEach(async () => {
		await fs.rm(projectRoot, { recursive: true, force: true });
	});

	it('syncs preset-mode sources, skips source skiller.toml, and reports removed lock entries', async () => {
		const presetRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'skiller-preset-'));
		try {
			await writeFile(
				path.join(projectRoot, '.agents', 'skiller.toml'),
				`[sync]
source = ${JSON.stringify(presetRoot)}
mode = "preset"
`,
			);
			await writeFile(
				path.join(presetRoot, '.agents', 'AGENTS.md'),
				'# Preset AGENTS\n',
			);
			await writeFile(
				path.join(presetRoot, '.agents', 'skiller.toml'),
				`default_agents = ["codex"]`,
			);
			await writeFile(path.join(presetRoot, '.claude', 'prompt.yml'), 'hook: 1\n');
			await writeFile(
				path.join(presetRoot, 'skills-lock.json'),
				JSON.stringify(
					{
						skills: {
							debug: { source: 'foo/bar', sourceType: 'github' },
							trace: { source: 'foo/bar', sourceType: 'github' },
						},
					},
					null,
					2,
				) + '\n',
			);
			await writeFile(path.join(presetRoot, 'package.json'), '{}\n');

			await writeFile(
				path.join(projectRoot, '.agents', 'old.md'),
				'stale\n',
			);
			await writeFile(
				path.join(projectRoot, '.agents', '.skiller-sync-manifest.json'),
				JSON.stringify(
					{
						version: 1,
						source: presetRoot,
						mode: 'preset',
						files: {
							'.agents/old.md': 'old-hash',
							'skills-lock.json': 'old-lock',
						},
						mergedConfigSourceHash: null,
					},
					null,
					2,
				) + '\n',
			);
			await writeFile(
				path.join(projectRoot, 'skills-lock.json'),
				JSON.stringify(
					{
						skills: {
							trace: { source: 'foo/bar', sourceType: 'github' },
						},
					},
					null,
					2,
				) + '\n',
			);

			const firstResult = await syncProjectFiles(projectRoot);
			expect(firstResult.applied).toBe(true);
			expect(firstResult.mode).toBe('preset');
			expect(firstResult.synced).toEqual(
				expect.arrayContaining(['.agents/AGENTS.md', '.claude/prompt.yml', 'skills-lock.json']),
			);
			expect(firstResult.removed).toContain('.agents/old.md');
			expect(
				await fs.readFile(path.join(projectRoot, '.agents', 'AGENTS.md'), 'utf8'),
			).toContain('Preset AGENTS');
			expect(
				await fs.readFile(path.join(projectRoot, '.agents', 'skiller.toml'), 'utf8'),
			).toContain(`[sync]`);
			await expect(fs.stat(path.join(projectRoot, 'package.json'))).rejects.toThrow();

			await writeFile(
				path.join(presetRoot, 'skills-lock.json'),
				JSON.stringify(
					{
						skills: {
							debug: { source: 'foo/bar', sourceType: 'github' },
						},
					},
					null,
					2,
				) + '\n',
			);

			const secondResult = await syncProjectFiles(projectRoot);
			expect(secondResult.removedNativeLockSkills).toEqual(['trace']);
		} finally {
			await fs.rm(presetRoot, { recursive: true, force: true });
		}
	});

	it('syncs repo-mode sources with explicit include and exclude rules', async () => {
		const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'skiller-sync-repo-'));
		try {
			await writeFile(
				path.join(projectRoot, '.agents', 'skiller.toml'),
				`[sync]
source = ${JSON.stringify(repoRoot)}
mode = "repo"
include = [".agents/rules/**", ".claude/scripts/**"]
exclude = [".agents/rules/private/**"]
`,
			);
			await writeFile(
				path.join(repoRoot, '.agents', 'rules', 'task.mdc'),
				'# task\n',
			);
			await writeFile(
				path.join(repoRoot, '.agents', 'rules', 'private', 'secret.mdc'),
				'# secret\n',
			);
			await writeFile(
				path.join(repoRoot, '.claude', 'scripts', 'hook.sh'),
				'echo hi\n',
			);
			await writeFile(path.join(repoRoot, 'README.md'), '# nope\n');

			const result = await syncProjectFiles(projectRoot);

			expect(result.mode).toBe('repo');
			expect(result.synced).toEqual(
				expect.arrayContaining([
					'.agents/rules/task.mdc',
					'.claude/scripts/hook.sh',
				]),
			);
			await expect(
				fs.readFile(path.join(projectRoot, '.agents', 'rules', 'task.mdc'), 'utf8'),
			).resolves.toContain('# task');
			await expect(
				fs.stat(path.join(projectRoot, '.agents', 'rules', 'private', 'secret.mdc')),
			).rejects.toThrow();
			await expect(fs.stat(path.join(projectRoot, 'README.md'))).rejects.toThrow();
		} finally {
			await fs.rm(repoRoot, { recursive: true, force: true });
		}
	});
});
