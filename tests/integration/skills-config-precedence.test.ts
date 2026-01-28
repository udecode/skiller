import * as path from "path";
import * as fs from "fs/promises";
import * as os from "os";
import { applyAllAgentConfigs } from "../../src/lib";
import { SKILL_MD_FILENAME } from "../../src/constants";

describe("Skills Configuration Precedence", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "skiller-skills-config-test-"),
		);
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	it("honors skills.enabled = false in skiller.toml (skips propagation)", async () => {
		// Setup .claude directory with skills
		const skillerDir = path.join(tmpDir, ".claude");
		const skillsDir = path.join(skillerDir, "skills");
		const skill1 = path.join(skillsDir, "test-skill");

		await fs.mkdir(skill1, { recursive: true });
		await fs.writeFile(path.join(skill1, SKILL_MD_FILENAME), "# Test Skill");
		await fs.writeFile(path.join(skillerDir, "AGENTS.md"), "# Test Rules");

		// Create skiller.toml with skills.enabled = false
		await fs.writeFile(
			path.join(skillerDir, "skiller.toml"),
			`
[skills]
enabled = false
`,
		);

		// Apply without CLI flag (should respect TOML config)
		// In the new architecture, skills.enabled = false just skips propagation
		// but does NOT delete .claude/skills since it's the source of truth
		await applyAllAgentConfigs(
			tmpDir,
			["claude"], // Just test with one agent
			undefined,
			true,
			undefined,
			undefined,
			false,
			false,
			false,
			false,
			true,
			undefined, // No CLI skills flag
		);

		// Skills directory should STILL exist (source of truth is never deleted)
		const claudeSkillsDir = path.join(tmpDir, ".claude", "skills");
		await expect(fs.access(claudeSkillsDir)).resolves.toBeUndefined();
	});

	it("honors skills.enabled = true in skiller.toml", async () => {
		// Setup .claude directory with skills
		const skillerDir = path.join(tmpDir, ".claude");
		const skillsDir = path.join(skillerDir, "skills");
		const skill1 = path.join(skillsDir, "test-skill");

		await fs.mkdir(skill1, { recursive: true });
		await fs.writeFile(path.join(skill1, SKILL_MD_FILENAME), "# Test Skill");
		await fs.writeFile(path.join(skillerDir, "AGENTS.md"), "# Test Rules");

		// Create skiller.toml with skills.enabled = true
		await fs.writeFile(
			path.join(skillerDir, "skiller.toml"),
			`
[skills]
enabled = true
`,
		);

		// Apply without CLI flag (should respect TOML config)
		await applyAllAgentConfigs(
			tmpDir,
			["claude"], // Just test with one agent
			undefined,
			true,
			undefined,
			undefined,
			false,
			false,
			false,
			false,
			true,
			undefined, // No CLI skills flag
		);

		// Skills SHOULD be in place
		const claudeSkillsDir = path.join(tmpDir, ".claude", "skills");
		const copiedSkill = path.join(
			claudeSkillsDir,
			"test-skill",
			SKILL_MD_FILENAME,
		);
		// Content may have @reference body added by sync process
		expect(await fs.readFile(copiedSkill, "utf8")).toContain("test-skill");
	});

	it("CLI flag overrides skiller.toml setting (skips propagation when disabled)", async () => {
		// Setup .claude directory with skills
		const skillerDir = path.join(tmpDir, ".claude");
		const skillsDir = path.join(skillerDir, "skills");
		const skill1 = path.join(skillsDir, "test-skill");

		await fs.mkdir(skill1, { recursive: true });
		await fs.writeFile(path.join(skill1, SKILL_MD_FILENAME), "# Test Skill");
		await fs.writeFile(path.join(skillerDir, "AGENTS.md"), "# Test Rules");

		// Create skiller.toml with skills.enabled = true
		await fs.writeFile(
			path.join(skillerDir, "skiller.toml"),
			`
[skills]
enabled = true
`,
		);

		// Apply with CLI flag = false (should override TOML)
		// In the new architecture, this just skips propagation
		// but does NOT delete .claude/skills since it's the source of truth
		await applyAllAgentConfigs(
			tmpDir,
			["claude"], // Just test with one agent
			undefined,
			true,
			undefined,
			undefined,
			false,
			false,
			false,
			false,
			true,
			false, // CLI: --no-skills
		);

		// Skills directory should STILL exist (source of truth is never deleted)
		const claudeSkillsDir = path.join(tmpDir, ".claude", "skills");
		await expect(fs.access(claudeSkillsDir)).resolves.toBeUndefined();
	});

	it("defaults to enabled when no config is set", async () => {
		// Setup .claude directory with skills
		const skillerDir = path.join(tmpDir, ".claude");
		const skillsDir = path.join(skillerDir, "skills");
		const skill1 = path.join(skillsDir, "test-skill");

		await fs.mkdir(skill1, { recursive: true });
		await fs.writeFile(path.join(skill1, SKILL_MD_FILENAME), "# Test Skill");
		await fs.writeFile(path.join(skillerDir, "AGENTS.md"), "# Test Rules");

		// Create skiller.toml WITHOUT skills section
		await fs.writeFile(path.join(skillerDir, "skiller.toml"), "");

		// Apply without CLI flag
		await applyAllAgentConfigs(
			tmpDir,
			["claude"], // Just test with one agent
			undefined,
			true,
			undefined,
			undefined,
			false,
			false,
			false,
			false,
			true,
			undefined, // No CLI skills flag
		);

		// Skills SHOULD be in place because default is enabled
		const claudeSkillsDir = path.join(tmpDir, ".claude", "skills");
		const copiedSkill = path.join(
			claudeSkillsDir,
			"test-skill",
			SKILL_MD_FILENAME,
		);
		// Content may have @reference body added by sync process
		expect(await fs.readFile(copiedSkill, "utf8")).toContain("test-skill");
	});
});
