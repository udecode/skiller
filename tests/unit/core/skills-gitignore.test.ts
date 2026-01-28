import { setupTestProject, teardownTestProject } from "../../harness";

describe("Skills Gitignore Paths", () => {
	let testProject: { projectRoot: string };

	beforeEach(async () => {
		testProject = await setupTestProject();
	});

	afterEach(async () => {
		await teardownTestProject(testProject.projectRoot);
	});

	it("returns empty array - skills are now committed source of truth", async () => {
		const { projectRoot } = testProject;
		const { getSkillsGitignorePaths } = await import(
			"../../../src/core/SkillsProcessor"
		);

		const paths = await getSkillsGitignorePaths(projectRoot);

		// In the new architecture, .claude/skills is the source of truth
		// and should NOT be gitignored - function returns empty array
		expect(paths).toEqual([]);
	});

	it("returns empty array regardless of how called", async () => {
		const { projectRoot } = testProject;
		const { getSkillsGitignorePaths } = await import(
			"../../../src/core/SkillsProcessor"
		);

		// Skills are now committed, so no paths need to be gitignored
		const paths = await getSkillsGitignorePaths(projectRoot);

		expect(paths).toEqual([]);
	});
});
