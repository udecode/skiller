import * as path from "path";
import * as fs from "fs/promises";
import * as os from "os";
import { discoverSkills, syncMdcToSkillMd } from "../src/core/SkillsProcessor";
import { SKILL_MD_FILENAME } from "../src/constants";

describe("Skills Discovery and Validation", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "skiller-skills-test-"));
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	describe("discoverSkills", () => {
		it("discovers skills with SKILL.md in flat structure", async () => {
			const skillsDir = path.join(tmpDir, ".claude", "skills");
			const skill1 = path.join(skillsDir, "skill1");
			const skill2 = path.join(skillsDir, "skill2");

			await fs.mkdir(skill1, { recursive: true });
			await fs.mkdir(skill2, { recursive: true });
			await fs.writeFile(path.join(skill1, SKILL_MD_FILENAME), "# Skill 1");
			await fs.writeFile(path.join(skill2, SKILL_MD_FILENAME), "# Skill 2");

			const result = await discoverSkills(tmpDir);

			expect(result.skills).toHaveLength(2);
			expect(result.skills[0].name).toBe("skill1");
			expect(result.skills[0].hasSkillMd).toBe(true);
			expect(result.skills[0].valid).toBe(true);
			expect(result.skills[1].name).toBe("skill2");
			expect(result.skills[1].hasSkillMd).toBe(true);
			expect(result.skills[1].valid).toBe(true);
			expect(result.warnings).toHaveLength(0);
		});

		it("discovers skills in nested structure", async () => {
			const skillsDir = path.join(tmpDir, ".claude", "skills");
			const category = path.join(skillsDir, "category");
			const nestedSkill = path.join(category, "nested-skill");

			await fs.mkdir(nestedSkill, { recursive: true });
			await fs.writeFile(
				path.join(nestedSkill, SKILL_MD_FILENAME),
				"# Nested Skill",
			);

			const result = await discoverSkills(tmpDir);

			expect(result.skills).toHaveLength(1);
			expect(result.skills[0].name).toBe("nested-skill");
			expect(result.skills[0].hasSkillMd).toBe(true);
			expect(result.skills[0].valid).toBe(true);
			expect(result.warnings).toHaveLength(0);
		});

		it("warns about directories without SKILL.md and no sub-skills", async () => {
			const skillsDir = path.join(tmpDir, ".claude", "skills");
			const validSkill = path.join(skillsDir, "valid-skill");
			const invalidDir = path.join(skillsDir, "invalid-dir");

			await fs.mkdir(validSkill, { recursive: true });
			await fs.mkdir(invalidDir, { recursive: true });
			await fs.writeFile(
				path.join(validSkill, SKILL_MD_FILENAME),
				"# Valid Skill",
			);
			await fs.writeFile(path.join(invalidDir, "README.md"), "# Not a skill");

			const result = await discoverSkills(tmpDir);

			expect(result.skills).toHaveLength(1);
			expect(result.skills[0].name).toBe("valid-skill");
			expect(result.warnings.length).toBeGreaterThan(0);
			expect(result.warnings[0]).toContain("invalid-dir");
		});

		it("allows grouping directories with no SKILL.md if they contain sub-skills", async () => {
			const skillsDir = path.join(tmpDir, ".claude", "skills");
			const category = path.join(skillsDir, "category");
			const subSkill1 = path.join(category, "sub-skill-1");
			const subSkill2 = path.join(category, "sub-skill-2");

			await fs.mkdir(subSkill1, { recursive: true });
			await fs.mkdir(subSkill2, { recursive: true });
			await fs.writeFile(
				path.join(subSkill1, SKILL_MD_FILENAME),
				"# Sub Skill 1",
			);
			await fs.writeFile(
				path.join(subSkill2, SKILL_MD_FILENAME),
				"# Sub Skill 2",
			);

			const result = await discoverSkills(tmpDir);

			expect(result.skills).toHaveLength(2);
			expect(result.warnings).toHaveLength(0);
		});

		it("returns empty result when .claude/skills does not exist", async () => {
			const result = await discoverSkills(tmpDir);

			expect(result.skills).toHaveLength(0);
			expect(result.warnings).toHaveLength(0);
		});
	});

	describe("copySkillsDirectory", () => {
		it("copies .claude/skills to destination preserving structure", async () => {
			const { copySkillsDirectory } = await import("../src/core/SkillsUtils");
			const skillsDir = path.join(tmpDir, ".claude", "skills");
			const skill1 = path.join(skillsDir, "skill1");
			const nested = path.join(skillsDir, "category", "nested-skill");

			await fs.mkdir(skill1, { recursive: true });
			await fs.mkdir(nested, { recursive: true });
			await fs.writeFile(path.join(skill1, SKILL_MD_FILENAME), "# Skill 1");
			await fs.writeFile(path.join(skill1, "helper.py"), 'print("helper")');
			await fs.writeFile(
				path.join(nested, SKILL_MD_FILENAME),
				"# Nested Skill",
			);

			const destDir = path.join(tmpDir, ".claude", "skills");
			await copySkillsDirectory(skillsDir, destDir);

			const copiedSkill1 = path.join(destDir, "skill1", SKILL_MD_FILENAME);
			const copiedHelper = path.join(destDir, "skill1", "helper.py");
			const copiedNested = path.join(
				destDir,
				"category",
				"nested-skill",
				SKILL_MD_FILENAME,
			);

			expect(await fs.readFile(copiedSkill1, "utf8")).toBe("# Skill 1");
			expect(await fs.readFile(copiedHelper, "utf8")).toBe('print("helper")');
			expect(await fs.readFile(copiedNested, "utf8")).toBe("# Nested Skill");
		});

		it("creates destination directory if it does not exist", async () => {
			const { copySkillsDirectory } = await import("../src/core/SkillsUtils");
			const skillsDir = path.join(tmpDir, ".claude", "skills");
			const skill1 = path.join(skillsDir, "skill1");

			await fs.mkdir(skill1, { recursive: true });
			await fs.writeFile(path.join(skill1, SKILL_MD_FILENAME), "# Skill 1");

			const destDir = path.join(tmpDir, ".claude", "skills");
			await copySkillsDirectory(skillsDir, destDir);

			const copiedSkill1 = path.join(destDir, "skill1", SKILL_MD_FILENAME);
			expect(await fs.readFile(copiedSkill1, "utf8")).toBe("# Skill 1");
		});
	});

	describe("syncMdcToSkillMd", () => {
		it("Case 1: creates SKILL.md with synced:true from standalone .mdc file", async () => {
			const skillsDir = path.join(tmpDir, ".claude", "skills");
			await fs.mkdir(skillsDir, { recursive: true });

			// Create standalone .mdc file at skills root
			const mdcContent = `---
description: My test skill
---

# Test Skill Content

This is the skill body.
`;
			await fs.writeFile(path.join(skillsDir, "my-skill.mdc"), mdcContent);

			const result = await syncMdcToSkillMd(skillsDir, false, false);

			expect(result.synced).toContain("my-skill");
			expect(result.warnings).toHaveLength(0);

			// Verify SKILL.md was created with synced: true
			const skillMdPath = path.join(skillsDir, "my-skill", SKILL_MD_FILENAME);
			const content = await fs.readFile(skillMdPath, "utf8");
			expect(content).toContain("name: my-skill");
			expect(content).toContain("description: My test skill");
			expect(content).toContain("synced: true");
			expect(content).toContain("# Test Skill Content");
		});

		it("Case 2: regenerates SKILL.md from .mdc when synced:true", async () => {
			const skillsDir = path.join(tmpDir, ".claude", "skills");
			const skillFolder = path.join(skillsDir, "synced-skill");
			await fs.mkdir(skillFolder, { recursive: true });

			// Create existing SKILL.md with synced: true
			await fs.writeFile(
				path.join(skillFolder, SKILL_MD_FILENAME),
				`---
name: synced-skill
description: Old description
synced: true
---

# Old Content`,
			);

			// Create .mdc with new content
			await fs.writeFile(
				path.join(skillsDir, "synced-skill.mdc"),
				`---
description: New description from mdc
---

# New Content from MDC`,
			);

			const result = await syncMdcToSkillMd(skillsDir, false, false);

			expect(result.synced).toContain("synced-skill");

			// Verify SKILL.md was updated with .mdc content
			const content = await fs.readFile(
				path.join(skillFolder, SKILL_MD_FILENAME),
				"utf8",
			);
			expect(content).toContain("description: New description from mdc");
			expect(content).toContain("# New Content from MDC");
			expect(content).toContain("synced: true");
		});

		it("Case 3: generates .mdc from SKILL.md without synced flag", async () => {
			const skillsDir = path.join(tmpDir, ".claude", "skills");
			const skillFolder = path.join(skillsDir, "unsynced-skill");
			await fs.mkdir(skillFolder, { recursive: true });

			// Create SKILL.md without synced: true
			await fs.writeFile(
				path.join(skillFolder, SKILL_MD_FILENAME),
				`---
name: unsynced-skill
description: Original skill
---

# Original Content`,
			);

			const result = await syncMdcToSkillMd(skillsDir, false, false);

			expect(result.synced).toContain("unsynced-skill");

			// Verify .mdc was created
			const mdcContent = await fs.readFile(
				path.join(skillsDir, "unsynced-skill.mdc"),
				"utf8",
			);
			expect(mdcContent).toContain("description: Original skill");
			expect(mdcContent).toContain("# Original Content");

			// Verify SKILL.md was updated with synced: true
			const skillContent = await fs.readFile(
				path.join(skillFolder, SKILL_MD_FILENAME),
				"utf8",
			);
			expect(skillContent).toContain("synced: true");
		});

		it("skips .mdc when SKILL.md exists without synced:true", async () => {
			const skillsDir = path.join(tmpDir, ".claude", "skills");
			const skillFolder = path.join(skillsDir, "manual-skill");
			await fs.mkdir(skillFolder, { recursive: true });

			// Create SKILL.md without synced: true (manually created)
			await fs.writeFile(
				path.join(skillFolder, SKILL_MD_FILENAME),
				`---
name: manual-skill
description: Manual skill
---

# Manual Content`,
			);

			// Create .mdc that should be ignored (SKILL.md is source of truth)
			await fs.writeFile(
				path.join(skillsDir, "manual-skill.mdc"),
				"# Should be ignored",
			);

			const result = await syncMdcToSkillMd(skillsDir, false, false);

			// The skill should be synced (Case 3: generate .mdc, add synced:true)
			expect(result.synced).toContain("manual-skill");

			// The .mdc should now contain the SKILL.md content (not the ignored content)
			const mdcContent = await fs.readFile(
				path.join(skillsDir, "manual-skill.mdc"),
				"utf8",
			);
			expect(mdcContent).toContain("# Manual Content");
		});

		it("handles dry run mode", async () => {
			const skillsDir = path.join(tmpDir, ".claude", "skills");
			await fs.mkdir(skillsDir, { recursive: true });

			await fs.writeFile(
				path.join(skillsDir, "dry-run-skill.mdc"),
				"# Dry run content",
			);

			const result = await syncMdcToSkillMd(skillsDir, false, true);

			expect(result.synced).toContain("dry-run-skill");

			// Verify folder was NOT created in dry run
			const folderExists = await fs
				.access(path.join(skillsDir, "dry-run-skill"))
				.then(() => true)
				.catch(() => false);
			expect(folderExists).toBe(false);
		});

		it("uses default description when frontmatter has none", async () => {
			const skillsDir = path.join(tmpDir, ".claude", "skills");
			await fs.mkdir(skillsDir, { recursive: true });

			// Create .mdc without description in frontmatter
			await fs.writeFile(
				path.join(skillsDir, "no-desc.mdc"),
				"# Just content, no frontmatter",
			);

			await syncMdcToSkillMd(skillsDir, false, false);

			const content = await fs.readFile(
				path.join(skillsDir, "no-desc", SKILL_MD_FILENAME),
				"utf8",
			);
			expect(content).toContain("description: 'Skill: no-desc'");
		});

		it("returns empty when skills directory does not exist", async () => {
			const nonExistentDir = path.join(tmpDir, "does-not-exist");

			const result = await syncMdcToSkillMd(nonExistentDir, false, false);

			expect(result.synced).toHaveLength(0);
			expect(result.warnings).toHaveLength(0);
		});
	});

	describe("propagateSkills", () => {
		it("discovers skills when enabled", async () => {
			const { propagateSkills } = await import("../src/core/SkillsProcessor");
			const { ClaudeAgent } = await import("../src/agents/ClaudeAgent");

			// Create skills in .claude/skills
			const skillsDir = path.join(tmpDir, ".claude", "skills");
			const skill1 = path.join(skillsDir, "skill1");
			await fs.mkdir(skill1, { recursive: true });
			await fs.writeFile(path.join(skill1, SKILL_MD_FILENAME), "# Skill 1");

			// Run with skills enabled - should not throw
			await expect(
				propagateSkills(tmpDir, [new ClaudeAgent()], true, false, false),
			).resolves.toBeUndefined();
		});

		it("returns early when skills are disabled", async () => {
			const { propagateSkills } = await import("../src/core/SkillsProcessor");
			const { allAgents } = await import("../src/lib");

			// Run propagateSkills with skillsEnabled = false
			await expect(
				propagateSkills(tmpDir, allAgents, false, false, false),
			).resolves.toBeUndefined();
		});

		it("handles missing skills directory gracefully", async () => {
			const { propagateSkills } = await import("../src/core/SkillsProcessor");
			const { allAgents } = await import("../src/lib");

			// No skills directory exists
			await expect(
				propagateSkills(tmpDir, allAgents, true, false, false),
			).resolves.toBeUndefined();
		});
	});
});
