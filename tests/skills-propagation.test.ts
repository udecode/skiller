import * as path from "path";
import * as fs from "fs/promises";
import * as os from "os";
import {
	discoverSkills,
	syncMdcToSkillMd,
	isReferenceBody,
} from "../src/core/SkillsProcessor";
import { SKILL_MD_FILENAME } from "../src/constants";

describe("isReferenceBody", () => {
	it("detects single line starting with @ as reference", () => {
		const result = isReferenceBody("@./my-skill.mdc");
		expect(result.isReference).toBe(true);
		expect(result.referencePath).toBe("./my-skill.mdc");
	});

	it("detects reference with surrounding whitespace", () => {
		const result = isReferenceBody("  @./my-skill.mdc  \n\n");
		expect(result.isReference).toBe(true);
		expect(result.referencePath).toBe("./my-skill.mdc");
	});

	it("detects pre-0.7 pattern reference", () => {
		const result = isReferenceBody("@.claude/rules/my-skill.mdc");
		expect(result.isReference).toBe(true);
		expect(result.referencePath).toBe(".claude/rules/my-skill.mdc");
	});

	it("returns false for multiple lines", () => {
		const result = isReferenceBody("@./my-skill.mdc\n# Some content");
		expect(result.isReference).toBe(false);
		expect(result.referencePath).toBeUndefined();
	});

	it("returns false for content not starting with @", () => {
		const result = isReferenceBody("# My Skill Content");
		expect(result.isReference).toBe(false);
		expect(result.referencePath).toBeUndefined();
	});

	it("returns false for empty body", () => {
		const result = isReferenceBody("");
		expect(result.isReference).toBe(false);
	});

	it("returns false for body with only whitespace", () => {
		const result = isReferenceBody("   \n\n   ");
		expect(result.isReference).toBe(false);
	});
});

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
		it("Case 1: creates SKILL.md with @reference from sibling .mdc file", async () => {
			const skillsDir = path.join(tmpDir, ".claude", "skills");
			const skillFolder = path.join(skillsDir, "my-skill");
			await fs.mkdir(skillFolder, { recursive: true });

			// Create sibling .mdc file inside skill folder
			const mdcContent = `---
description: My test skill
---

# Test Skill Content

This is the skill body.
`;
			await fs.writeFile(path.join(skillFolder, "my-skill.mdc"), mdcContent);

			const result = await syncMdcToSkillMd(skillsDir, false, false);

			expect(result.synced).toContain("my-skill");
			expect(result.warnings).toHaveLength(0);

			// Verify SKILL.md was created with @reference body (absolute path)
			const skillMdPath = path.join(skillFolder, SKILL_MD_FILENAME);
			const content = await fs.readFile(skillMdPath, "utf8");
			expect(content).toContain("name: my-skill");
			expect(content).toContain("description: My test skill");
			expect(content).toContain("@.claude/skills/my-skill/my-skill.mdc");
			expect(content).not.toContain("synced:");
		});

		it("Case 2: recognizes @reference body as synced (sibling .mdc is source)", async () => {
			const skillsDir = path.join(tmpDir, ".claude", "skills");
			const skillFolder = path.join(skillsDir, "synced-skill");
			await fs.mkdir(skillFolder, { recursive: true });

			// Create existing SKILL.md with @reference body (old relative path - should be migrated)
			await fs.writeFile(
				path.join(skillFolder, SKILL_MD_FILENAME),
				`---
name: synced-skill
description: Old description
---

@./synced-skill.mdc`,
			);

			// Create sibling .mdc with new description
			await fs.writeFile(
				path.join(skillFolder, "synced-skill.mdc"),
				`---
description: New description from mdc
---

# Content from MDC`,
			);

			const result = await syncMdcToSkillMd(skillsDir, false, false);

			expect(result.synced).toContain("synced-skill");

			// Verify SKILL.md frontmatter was updated from .mdc and path migrated to absolute
			const content = await fs.readFile(
				path.join(skillFolder, SKILL_MD_FILENAME),
				"utf8",
			);
			expect(content).toContain("description: New description from mdc");
			expect(content).toContain(
				"@.claude/skills/synced-skill/synced-skill.mdc",
			);
			expect(content).not.toContain("synced:");
		});

		it("Case 3: generates sibling .mdc from SKILL.md with full content", async () => {
			const skillsDir = path.join(tmpDir, ".claude", "skills");
			const skillFolder = path.join(skillsDir, "unsynced-skill");
			await fs.mkdir(skillFolder, { recursive: true });

			// Create SKILL.md with full content (not @reference)
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

			// Verify sibling .mdc was created
			const mdcContent = await fs.readFile(
				path.join(skillFolder, "unsynced-skill.mdc"),
				"utf8",
			);
			expect(mdcContent).toContain("description: Original skill");
			expect(mdcContent).toContain("# Original Content");

			// Verify SKILL.md was updated to @reference (absolute path)
			const skillContent = await fs.readFile(
				path.join(skillFolder, SKILL_MD_FILENAME),
				"utf8",
			);
			expect(skillContent).toContain(
				"@.claude/skills/unsynced-skill/unsynced-skill.mdc",
			);
			expect(skillContent).not.toContain("synced:");
		});

		it("migrates root .mdc files to sibling pattern", async () => {
			const skillsDir = path.join(tmpDir, ".claude", "skills");
			await fs.mkdir(skillsDir, { recursive: true });

			// Create .mdc at skills root (old pattern)
			await fs.writeFile(
				path.join(skillsDir, "migrate-skill.mdc"),
				`---
description: Skill to migrate
---

# Migrate Content`,
			);

			const result = await syncMdcToSkillMd(skillsDir, false, false);

			expect(result.synced).toContain("migrate-skill");

			// Verify .mdc was moved to sibling location
			const siblingMdcExists = await fs
				.access(path.join(skillsDir, "migrate-skill", "migrate-skill.mdc"))
				.then(() => true)
				.catch(() => false);
			expect(siblingMdcExists).toBe(true);

			// Verify root .mdc was removed
			const rootMdcExists = await fs
				.access(path.join(skillsDir, "migrate-skill.mdc"))
				.then(() => true)
				.catch(() => false);
			expect(rootMdcExists).toBe(false);

			// Verify SKILL.md was created with @reference (absolute path)
			const skillMdContent = await fs.readFile(
				path.join(skillsDir, "migrate-skill", SKILL_MD_FILENAME),
				"utf8",
			);
			expect(skillMdContent).toContain(
				"@.claude/skills/migrate-skill/migrate-skill.mdc",
			);
		});

		it("handles dry run mode", async () => {
			const skillsDir = path.join(tmpDir, ".claude", "skills");
			const skillFolder = path.join(skillsDir, "dry-run-skill");
			await fs.mkdir(skillFolder, { recursive: true });

			await fs.writeFile(
				path.join(skillFolder, "dry-run-skill.mdc"),
				"# Dry run content",
			);

			const result = await syncMdcToSkillMd(skillsDir, false, true);

			expect(result.synced).toContain("dry-run-skill");

			// Verify SKILL.md was NOT created in dry run
			const skillMdExists = await fs
				.access(path.join(skillFolder, SKILL_MD_FILENAME))
				.then(() => true)
				.catch(() => false);
			expect(skillMdExists).toBe(false);
		});

		it("uses default description when frontmatter has none", async () => {
			const skillsDir = path.join(tmpDir, ".claude", "skills");
			const skillFolder = path.join(skillsDir, "no-desc");
			await fs.mkdir(skillFolder, { recursive: true });

			// Create sibling .mdc without description in frontmatter
			await fs.writeFile(
				path.join(skillFolder, "no-desc.mdc"),
				"# Just content, no frontmatter",
			);

			await syncMdcToSkillMd(skillsDir, false, false);

			const content = await fs.readFile(
				path.join(skillFolder, SKILL_MD_FILENAME),
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

		it("migrates pre-0.7 pattern (@.claude/rules/name.mdc) to sibling pattern", async () => {
			const skillsDir = path.join(tmpDir, ".claude", "skills");
			const rulesDir = path.join(tmpDir, ".claude", "rules");
			const skillFolder = path.join(skillsDir, "my-skill");

			await fs.mkdir(skillFolder, { recursive: true });
			await fs.mkdir(rulesDir, { recursive: true });

			// Create the rule source file (pre-0.7 location)
			await fs.writeFile(
				path.join(rulesDir, "my-skill.mdc"),
				`---
description: My skill description
---

# My Skill Content`,
			);

			// Create SKILL.md with @reference (pre-0.7 pattern)
			await fs.writeFile(
				path.join(skillFolder, SKILL_MD_FILENAME),
				`---
name: my-skill
description: My skill description
---

@.claude/rules/my-skill.mdc`,
			);

			const result = await syncMdcToSkillMd(skillsDir, false, false);

			// Should migrate successfully
			expect(result.warnings).toHaveLength(0);
			expect(result.synced).toContain("my-skill");

			// SKILL.md should now point to sibling .mdc (absolute path)
			const skillMdContent = await fs.readFile(
				path.join(skillFolder, SKILL_MD_FILENAME),
				"utf8",
			);
			expect(skillMdContent).toContain(
				"@.claude/skills/my-skill/my-skill.mdc",
			);
			expect(skillMdContent).not.toContain("@.claude/rules");

			// Sibling .mdc should be created with content from rules
			const siblingMdcContent = await fs.readFile(
				path.join(skillFolder, "my-skill.mdc"),
				"utf8",
			);
			expect(siblingMdcContent).toContain("# My Skill Content");
			expect(siblingMdcContent).toContain("description: My skill description");
		});

		it("skips SKILL.md generation for .mdc files with alwaysApply: true", async () => {
			const skillsDir = path.join(tmpDir, ".claude", "skills");
			const skillFolder = path.join(skillsDir, "always-apply-rule");
			await fs.mkdir(skillFolder, { recursive: true });

			// Create .mdc with alwaysApply: true (this is a Cursor rule, not a skill)
			await fs.writeFile(
				path.join(skillFolder, "always-apply-rule.mdc"),
				`---
description: A Cursor-style rule
alwaysApply: true
---

# This is a rule, not a skill`,
			);

			const result = await syncMdcToSkillMd(skillsDir, false, false);

			// Should NOT be synced (alwaysApply rules skip SKILL.md generation)
			expect(result.synced).not.toContain("always-apply-rule");

			// SKILL.md should NOT exist
			const skillMdExists = await fs
				.access(path.join(skillFolder, SKILL_MD_FILENAME))
				.then(() => true)
				.catch(() => false);
			expect(skillMdExists).toBe(false);
		});
	});

	describe("copyMdcFilesFromRules", () => {
		it("copies .mdc files from rules to skills/name/name.mdc", async () => {
			const { copyMdcFilesFromRules } = await import(
				"../src/core/SkillsProcessor"
			);

			const skillerDir = path.join(tmpDir, ".claude");
			const rulesDir = path.join(skillerDir, "rules");
			const skillsDir = path.join(skillerDir, "skills");

			await fs.mkdir(rulesDir, { recursive: true });
			await fs.mkdir(skillsDir, { recursive: true });

			// Create .mdc file in rules
			await fs.writeFile(
				path.join(rulesDir, "my-rule.mdc"),
				`---
description: My rule
alwaysApply: true
---

# Rule Content`,
			);

			const result = await copyMdcFilesFromRules(skillerDir, false, false);

			expect(result).toContain("my-rule");

			// Verify .mdc was copied to skills/my-rule/my-rule.mdc
			const copiedMdc = await fs.readFile(
				path.join(skillsDir, "my-rule", "my-rule.mdc"),
				"utf8",
			);
			expect(copiedMdc).toContain("alwaysApply: true");
			expect(copiedMdc).toContain("# Rule Content");
		});

		it("does not create SKILL.md for copied .mdc files", async () => {
			const { copyMdcFilesFromRules, syncMdcToSkillMd } = await import(
				"../src/core/SkillsProcessor"
			);

			const skillerDir = path.join(tmpDir, ".claude");
			const rulesDir = path.join(skillerDir, "rules");
			const skillsDir = path.join(skillerDir, "skills");

			await fs.mkdir(rulesDir, { recursive: true });
			await fs.mkdir(skillsDir, { recursive: true });

			// Create .mdc file in rules with alwaysApply
			await fs.writeFile(
				path.join(rulesDir, "cursor-rule.mdc"),
				`---
description: A Cursor rule
alwaysApply: true
---

# Rule content`,
			);

			// Copy from rules to skills
			await copyMdcFilesFromRules(skillerDir, false, false);

			// Run sync - should NOT generate SKILL.md for alwaysApply rules
			await syncMdcToSkillMd(skillsDir, false, false);

			// SKILL.md should NOT exist
			const skillMdExists = await fs
				.access(path.join(skillsDir, "cursor-rule", SKILL_MD_FILENAME))
				.then(() => true)
				.catch(() => false);
			expect(skillMdExists).toBe(false);

			// But the .mdc should exist
			const mdcExists = await fs
				.access(path.join(skillsDir, "cursor-rule", "cursor-rule.mdc"))
				.then(() => true)
				.catch(() => false);
			expect(mdcExists).toBe(true);
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
