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

		it("deletes directories without SKILL.md and no .mdc files", async () => {
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
			expect(result.deleted).toHaveLength(1);
			expect(result.deleted[0]).toBe("invalid-dir");
			// Verify the directory was actually deleted
			await expect(fs.access(invalidDir)).rejects.toThrow();
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

		it("Case 2: migrates relative path to absolute, preserves existing frontmatter", async () => {
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

			// Create sibling .mdc with different description (should NOT update SKILL.md)
			await fs.writeFile(
				path.join(skillFolder, "synced-skill.mdc"),
				`---
description: New description from mdc
---

# Content from MDC`,
			);

			const result = await syncMdcToSkillMd(skillsDir, false, false);

			expect(result.synced).toContain("synced-skill");

			// Verify SKILL.md path migrated to absolute BUT frontmatter preserved (not updated from .mdc)
			const content = await fs.readFile(
				path.join(skillFolder, SKILL_MD_FILENAME),
				"utf8",
			);
			expect(content).toContain("description: Old description");
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

			// Verify sibling .mdc was created (no frontmatter - description is in SKILL.md)
			const mdcContent = await fs.readFile(
				path.join(skillFolder, "unsynced-skill.mdc"),
				"utf8",
			);
			expect(mdcContent).not.toContain("description");
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

		it("Case 3: preserves ALL custom frontmatter fields (user-invocable, etc)", async () => {
			const skillsDir = path.join(tmpDir, ".claude", "skills");
			const skillFolder = path.join(skillsDir, "custom-frontmatter-skill");
			await fs.mkdir(skillFolder, { recursive: true });

			// Create SKILL.md with full content AND custom frontmatter fields
			await fs.writeFile(
				path.join(skillFolder, SKILL_MD_FILENAME),
				`---
name: custom-frontmatter-skill
description: A skill with custom frontmatter
user-invocable: false
some-other-field: custom-value
---

# Skill Content`,
			);

			const result = await syncMdcToSkillMd(skillsDir, false, false);

			expect(result.synced).toContain("custom-frontmatter-skill");

			// Verify SKILL.md preserves ALL custom frontmatter fields
			const skillContent = await fs.readFile(
				path.join(skillFolder, SKILL_MD_FILENAME),
				"utf8",
			);
			expect(skillContent).toContain("name: custom-frontmatter-skill");
			expect(skillContent).toContain(
				"description: A skill with custom frontmatter",
			);
			expect(skillContent).toContain("user-invocable: false");
			expect(skillContent).toContain("some-other-field: custom-value");
			expect(skillContent).toContain(
				"@.claude/skills/custom-frontmatter-skill/custom-frontmatter-skill.mdc",
			);
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

			// Sibling .mdc should be created with body only (description is in SKILL.md)
			const siblingMdcContent = await fs.readFile(
				path.join(skillFolder, "my-skill.mdc"),
				"utf8",
			);
			expect(siblingMdcContent).toContain("# My Skill Content");
			expect(siblingMdcContent).not.toContain("description");
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

		it("deletes existing SKILL.md when .mdc is updated to alwaysApply: true", async () => {
			const skillsDir = path.join(tmpDir, ".claude", "skills");
			const skillFolder = path.join(skillsDir, "converted-to-rule");
			await fs.mkdir(skillFolder, { recursive: true });

			// Create existing SKILL.md (was a skill before)
			await fs.writeFile(
				path.join(skillFolder, SKILL_MD_FILENAME),
				`---
name: converted-to-rule
description: Was a skill
---

@.claude/skills/converted-to-rule/converted-to-rule.mdc`,
			);

			// Create .mdc that was updated to alwaysApply: true
			await fs.writeFile(
				path.join(skillFolder, "converted-to-rule.mdc"),
				`---
description: Now a Cursor rule
alwaysApply: true
---

# This is now a rule, not a skill`,
			);

			// Verify SKILL.md exists before sync
			const skillMdExistsBefore = await fs
				.access(path.join(skillFolder, SKILL_MD_FILENAME))
				.then(() => true)
				.catch(() => false);
			expect(skillMdExistsBefore).toBe(true);

			const result = await syncMdcToSkillMd(skillsDir, false, false);

			// Should be synced (deletion counts as sync)
			expect(result.synced).toContain("converted-to-rule");

			// SKILL.md should be DELETED
			const skillMdExistsAfter = await fs
				.access(path.join(skillFolder, SKILL_MD_FILENAME))
				.then(() => true)
				.catch(() => false);
			expect(skillMdExistsAfter).toBe(false);

			// .mdc should still exist
			const mdcExists = await fs
				.access(path.join(skillFolder, "converted-to-rule.mdc"))
				.then(() => true)
				.catch(() => false);
			expect(mdcExists).toBe(true);
		});
	});

	describe("copyMdcFilesFromRules", () => {
		it("copies .mdc files from rules to skills/name/name.mdc and strips globs/alwaysApply:false", async () => {
			const { copyMdcFilesFromRules } = await import(
				"../src/core/SkillsProcessor"
			);

			const skillerDir = path.join(tmpDir, ".claude");
			const rulesDir = path.join(skillerDir, "rules");
			const skillsDir = path.join(skillerDir, "skills");

			await fs.mkdir(rulesDir, { recursive: true });
			await fs.mkdir(skillsDir, { recursive: true });

			// Create .mdc file in rules with globs and alwaysApply: true
			await fs.writeFile(
				path.join(rulesDir, "my-rule.mdc"),
				`---
description: My rule
alwaysApply: true
globs:
  - "**/*.ts"
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
			// alwaysApply: true should be kept
			expect(copiedMdc).toContain("alwaysApply: true");
			expect(copiedMdc).toContain("description: My rule");
			expect(copiedMdc).toContain("# Rule Content");
			// globs should be stripped (not useful in skills)
			expect(copiedMdc).not.toContain("globs");
		});

		it("strips alwaysApply: false from frontmatter when copying", async () => {
			const { copyMdcFilesFromRules } = await import(
				"../src/core/SkillsProcessor"
			);

			const skillerDir = path.join(tmpDir, ".claude");
			const rulesDir = path.join(skillerDir, "rules");
			const skillsDir = path.join(skillerDir, "skills");

			await fs.mkdir(rulesDir, { recursive: true });
			await fs.mkdir(skillsDir, { recursive: true });

			// Create .mdc file with alwaysApply: false (should be stripped)
			await fs.writeFile(
				path.join(rulesDir, "conditional-rule.mdc"),
				`---
description: A conditional rule
alwaysApply: false
globs:
  - "src/**/*.ts"
---

# Conditional Content`,
			);

			await copyMdcFilesFromRules(skillerDir, false, false);

			const copiedMdc = await fs.readFile(
				path.join(skillsDir, "conditional-rule", "conditional-rule.mdc"),
				"utf8",
			);
			// alwaysApply: false should be stripped
			expect(copiedMdc).not.toContain("alwaysApply");
			// globs should be stripped
			expect(copiedMdc).not.toContain("globs");
			// description should be stripped (goes in SKILL.md, not .mdc)
			expect(copiedMdc).not.toContain("description");
			expect(copiedMdc).toContain("# Conditional Content");
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

	describe("copySkillFoldersFromRules", () => {
		it("copies skill folders from rules to skills and generates .mdc from SKILL.md", async () => {
			const { copySkillFoldersFromRules, syncMdcToSkillMd } = await import(
				"../src/core/SkillsProcessor"
			);

			const skillerDir = path.join(tmpDir, ".claude");
			const rulesDir = path.join(skillerDir, "rules");
			const skillsDir = path.join(skillerDir, "skills");

			// Create skill folder with SKILL.md in rules
			const ruleSkillFolder = path.join(rulesDir, "my-skill");
			await fs.mkdir(ruleSkillFolder, { recursive: true });
			await fs.mkdir(skillsDir, { recursive: true });

			await fs.writeFile(
				path.join(ruleSkillFolder, SKILL_MD_FILENAME),
				`---
name: my-skill
description: A skill from rules
---

# My Skill Content

This is the full skill content.`,
			);

			// Copy skill folders from rules
			await copySkillFoldersFromRules(skillerDir, false, false);

			// Verify skill folder was copied
			const copiedSkillMd = await fs.readFile(
				path.join(skillsDir, "my-skill", SKILL_MD_FILENAME),
				"utf8",
			);
			expect(copiedSkillMd).toContain("# My Skill Content");

			// Run sync - should generate .mdc from SKILL.md
			const result = await syncMdcToSkillMd(skillsDir, false, false);

			expect(result.synced).toContain("my-skill");

			// Verify .mdc was generated (no frontmatter - description is in SKILL.md)
			const mdcContent = await fs.readFile(
				path.join(skillsDir, "my-skill", "my-skill.mdc"),
				"utf8",
			);
			expect(mdcContent).not.toContain("description");
			expect(mdcContent).toContain("# My Skill Content");

			// Verify SKILL.md was updated to @reference
			const updatedSkillMd = await fs.readFile(
				path.join(skillsDir, "my-skill", SKILL_MD_FILENAME),
				"utf8",
			);
			expect(updatedSkillMd).toContain(
				"@.claude/skills/my-skill/my-skill.mdc",
			);
		});

		it("copies skill folders with helper files", async () => {
			const { copySkillFoldersFromRules } = await import(
				"../src/core/SkillsProcessor"
			);

			const skillerDir = path.join(tmpDir, ".claude");
			const rulesDir = path.join(skillerDir, "rules");
			const skillsDir = path.join(skillerDir, "skills");

			// Create skill folder with SKILL.md and helper files in rules
			const ruleSkillFolder = path.join(rulesDir, "complex-skill");
			await fs.mkdir(ruleSkillFolder, { recursive: true });
			await fs.mkdir(skillsDir, { recursive: true });

			await fs.writeFile(
				path.join(ruleSkillFolder, SKILL_MD_FILENAME),
				"# Complex Skill",
			);
			await fs.writeFile(
				path.join(ruleSkillFolder, "helper.sh"),
				"#!/bin/bash\necho 'helper'",
			);

			// Copy skill folders from rules
			await copySkillFoldersFromRules(skillerDir, false, false);

			// Verify skill folder and helper file were copied
			expect(
				await fs
					.access(path.join(skillsDir, "complex-skill", SKILL_MD_FILENAME))
					.then(() => true)
					.catch(() => false),
			).toBe(true);
			expect(
				await fs
					.access(path.join(skillsDir, "complex-skill", "helper.sh"))
					.then(() => true)
					.catch(() => false),
			).toBe(true);
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

	describe("deleteRulesDir", () => {
		it("deletes .claude/rules directory after migration", async () => {
			const { deleteRulesDir } = await import("../src/core/SkillsProcessor");

			const skillerDir = path.join(tmpDir, ".claude");
			const rulesDir = path.join(skillerDir, "rules");

			// Create rules directory with content
			await fs.mkdir(rulesDir, { recursive: true });
			await fs.writeFile(path.join(rulesDir, "test.mdc"), "# Test");

			// Verify rules directory exists
			expect(
				await fs
					.access(rulesDir)
					.then(() => true)
					.catch(() => false),
			).toBe(true);

			// Delete rules directory
			const result = await deleteRulesDir(skillerDir, false, false);

			expect(result).toBe(true);
			// Verify rules directory is deleted
			expect(
				await fs
					.access(rulesDir)
					.then(() => true)
					.catch(() => false),
			).toBe(false);
		});

		it("returns false when no rules directory exists", async () => {
			const { deleteRulesDir } = await import("../src/core/SkillsProcessor");

			const skillerDir = path.join(tmpDir, ".claude");
			await fs.mkdir(skillerDir, { recursive: true });

			// No rules directory exists
			const result = await deleteRulesDir(skillerDir, false, false);

			expect(result).toBe(false);
		});

		it("respects dry-run mode", async () => {
			const { deleteRulesDir } = await import("../src/core/SkillsProcessor");

			const skillerDir = path.join(tmpDir, ".claude");
			const rulesDir = path.join(skillerDir, "rules");

			// Create rules directory
			await fs.mkdir(rulesDir, { recursive: true });
			await fs.writeFile(path.join(rulesDir, "test.mdc"), "# Test");

			// Delete in dry-run mode
			const result = await deleteRulesDir(skillerDir, false, true);

			expect(result).toBe(true);
			// Verify rules directory still exists (dry-run)
			expect(
				await fs
					.access(rulesDir)
					.then(() => true)
					.catch(() => false),
			).toBe(true);
		});
	});

	describe("migrateRulesToSkills", () => {
		it("migrates all content from rules to skills and deletes rules", async () => {
			const { migrateRulesToSkills } = await import(
				"../src/core/SkillsProcessor"
			);

			const skillerDir = path.join(tmpDir, ".claude");
			const rulesDir = path.join(skillerDir, "rules");
			const skillsDir = path.join(skillerDir, "skills");

			// Create rules with both .mdc file and skill folder
			await fs.mkdir(rulesDir, { recursive: true });
			await fs.writeFile(
				path.join(rulesDir, "standalone.mdc"),
				"---\ndescription: Test\n---\n\n# Standalone",
			);

			const ruleSkillFolder = path.join(rulesDir, "test-skill");
			await fs.mkdir(ruleSkillFolder, { recursive: true });
			await fs.writeFile(
				path.join(ruleSkillFolder, SKILL_MD_FILENAME),
				"# Test Skill",
			);

			// Run migration
			await migrateRulesToSkills(skillerDir, false, false);

			// Verify .mdc file was copied
			expect(
				await fs
					.access(path.join(skillsDir, "standalone", "standalone.mdc"))
					.then(() => true)
					.catch(() => false),
			).toBe(true);

			// Verify skill folder was copied
			expect(
				await fs
					.access(path.join(skillsDir, "test-skill", SKILL_MD_FILENAME))
					.then(() => true)
					.catch(() => false),
			).toBe(true);

			// Verify rules directory was deleted
			expect(
				await fs
					.access(rulesDir)
					.then(() => true)
					.catch(() => false),
			).toBe(false);
		});

		it("does nothing when rules directory does not exist", async () => {
			const { migrateRulesToSkills } = await import(
				"../src/core/SkillsProcessor"
			);

			const skillerDir = path.join(tmpDir, ".claude");
			await fs.mkdir(skillerDir, { recursive: true });

			// Should not throw when rules directory doesn't exist
			await expect(
				migrateRulesToSkills(skillerDir, false, false),
			).resolves.toBeUndefined();
		});
	});

	describe("Rules migration edge cases", () => {
		it("correctly migrates .mdc files from rules without path corruption", async () => {
			const { copyMdcFilesFromRules, syncMdcToSkillMd } = await import(
				"../src/core/SkillsProcessor"
			);

			const skillerDir = path.join(tmpDir, ".claude");
			const rulesDir = path.join(skillerDir, "rules");
			const skillsDir = path.join(skillerDir, "skills");

			await fs.mkdir(rulesDir, { recursive: true });
			await fs.mkdir(skillsDir, { recursive: true });

			// Create .mdc file in rules with frontmatter (realistic scenario)
			const mdcContent = `---
description: Use when working with Jotai X stores (createAtomStore)
globs:
  - "**/*.ts"
---

# Jotai X Usage

Use createAtomStore for state management.`;

			await fs.writeFile(path.join(rulesDir, "jotai-x.mdc"), mdcContent);

			// Step 1: Copy .mdc files from rules to skills
			const copyResult = await copyMdcFilesFromRules(skillerDir, false, false);
			expect(copyResult).toContain("jotai-x");

			// Verify .mdc was copied to correct path (not corrupted)
			const copiedMdcPath = path.join(skillsDir, "jotai-x", "jotai-x.mdc");
			const copiedMdc = await fs.readFile(copiedMdcPath, "utf8");

			// Path should be valid - file exists and contains expected content
			expect(copiedMdc).toContain("# Jotai X Usage");
			expect(copiedMdc).not.toContain("globs"); // Should be stripped

			// Step 2: Sync to generate SKILL.md
			const syncResult = await syncMdcToSkillMd(skillsDir, false, false);
			expect(syncResult.synced).toContain("jotai-x");

			// Verify SKILL.md was created with correct @reference path
			const skillMdPath = path.join(skillsDir, "jotai-x", SKILL_MD_FILENAME);
			const skillMdContent = await fs.readFile(skillMdPath, "utf8");

			// SKILL.md should have proper structure
			expect(skillMdContent).toContain("name: jotai-x");
			expect(skillMdContent).toContain("description:");
			expect(skillMdContent).toContain(
				"@.claude/skills/jotai-x/jotai-x.mdc",
			);

			// Verify the paths are valid filesystem paths, not file content
			const skillFolder = path.join(skillsDir, "jotai-x");
			const entries = await fs.readdir(skillFolder);

			// Should only contain SKILL.md and jotai-x.mdc - no corrupted filenames
			expect(entries.sort()).toEqual(["SKILL.md", "jotai-x.mdc"]);

			// Verify no file has been created with SKILL.md content as filename
			for (const entry of entries) {
				expect(entry).not.toContain("---");
				expect(entry).not.toContain("name:");
				expect(entry).not.toContain("description:");
			}
		});

		it("handles existing SKILL.md with pre-0.7 rules reference during migration", async () => {
			const { copyMdcFilesFromRules, syncMdcToSkillMd } = await import(
				"../src/core/SkillsProcessor"
			);

			const skillerDir = path.join(tmpDir, ".claude");
			const rulesDir = path.join(skillerDir, "rules");
			const skillsDir = path.join(skillerDir, "skills");

			await fs.mkdir(rulesDir, { recursive: true });

			// Create .mdc file in rules
			await fs.writeFile(
				path.join(rulesDir, "my-rule.mdc"),
				`---
description: My rule description
---

# My Rule Content`,
			);

			// Create skill folder with SKILL.md that references the rules file
			const skillFolder = path.join(skillsDir, "my-rule");
			await fs.mkdir(skillFolder, { recursive: true });
			await fs.writeFile(
				path.join(skillFolder, SKILL_MD_FILENAME),
				`---
name: my-rule
description: My rule description
---

@.claude/rules/my-rule.mdc`,
			);

			// Step 1: Copy .mdc files from rules
			await copyMdcFilesFromRules(skillerDir, false, false);

			// Step 2: Sync - should migrate from rules reference to sibling pattern
			const result = await syncMdcToSkillMd(skillsDir, false, false);

			expect(result.warnings).toHaveLength(0);
			expect(result.synced).toContain("my-rule");

			// Verify SKILL.md now points to sibling .mdc
			const skillMdContent = await fs.readFile(
				path.join(skillFolder, SKILL_MD_FILENAME),
				"utf8",
			);
			expect(skillMdContent).toContain(
				"@.claude/skills/my-rule/my-rule.mdc",
			);
			expect(skillMdContent).not.toContain("@.claude/rules");

			// Verify only valid files exist (no corrupted paths)
			const entries = await fs.readdir(skillFolder);
			expect(entries.sort()).toEqual(["SKILL.md", "my-rule.mdc"]);
		});

		it("migrates SKILL.md when rules file was already migrated to different skill folder", async () => {
			const { copyMdcFilesFromRules, deleteRulesDir, syncMdcToSkillMd } =
				await import("../src/core/SkillsProcessor");

			const skillerDir = path.join(tmpDir, ".claude");
			const rulesDir = path.join(skillerDir, "rules");
			const skillsDir = path.join(skillerDir, "skills");

			await fs.mkdir(rulesDir, { recursive: true });

			// Create .mdc file in rules (jotai-x.mdc)
			await fs.writeFile(
				path.join(rulesDir, "jotai-x.mdc"),
				`---
description: Use when working with Jotai X stores
---

# Jotai X Usage`,
			);

			// Create skill folder with SKILL.md that references the rules file
			// BUT the skill folder has a DIFFERENT name than the .mdc file
			const skillFolder = path.join(skillsDir, "name");
			await fs.mkdir(skillFolder, { recursive: true });
			await fs.writeFile(
				path.join(skillFolder, SKILL_MD_FILENAME),
				`---
name: name
description: Name skill
---

@.claude/rules/jotai-x.mdc`,
			);

			// Step 1: Copy .mdc files from rules (creates skills/jotai-x/jotai-x.mdc)
			await copyMdcFilesFromRules(skillerDir, false, false);

			// Step 2: Delete rules directory (simulating full migration)
			await deleteRulesDir(skillerDir, false, false);

			// Step 3: Sync - should find the migrated file at skills/jotai-x/jotai-x.mdc
			const result = await syncMdcToSkillMd(skillsDir, false, false);

			// Should NOT have warnings about missing file
			expect(result.warnings).toHaveLength(0);
			expect(result.synced).toContain("name");

			// The name skill's SKILL.md should now point to the migrated location
			const skillMdContent = await fs.readFile(
				path.join(skillFolder, SKILL_MD_FILENAME),
				"utf8",
			);
			// Should point to the sibling .mdc in the name folder (copied from jotai-x)
			expect(skillMdContent).toContain("@.claude/skills/name/name.mdc");
			expect(skillMdContent).not.toContain("@.claude/rules");

			// Verify name/name.mdc was created with the content from jotai-x
			const mdcContent = await fs.readFile(
				path.join(skillFolder, "name.mdc"),
				"utf8",
			);
			expect(mdcContent).toContain("# Jotai X Usage");
		});

		it("includes migrated alwaysApply .mdc files in cursor mode readMarkdownFiles", async () => {
			const { copyMdcFilesFromRules, deleteRulesDir } = await import(
				"../src/core/SkillsProcessor"
			);
			const { readMarkdownFiles } = await import(
				"../src/core/FileSystemUtils"
			);

			const skillerDir = path.join(tmpDir, ".claude");
			const rulesDir = path.join(skillerDir, "rules");

			await fs.mkdir(rulesDir, { recursive: true });

			// Create .mdc file in rules with alwaysApply: true
			await fs.writeFile(
				path.join(rulesDir, "always-rule.mdc"),
				`---
description: A cursor-style rule
alwaysApply: true
---

# Always Applied Rule Content`,
			);

			// Step 1: Copy .mdc files from rules to skills
			await copyMdcFilesFromRules(skillerDir, false, false);

			// Step 2: Delete rules directory
			await deleteRulesDir(skillerDir, false, false);

			// Step 3: Read files with cursor mode - should include the migrated alwaysApply file
			const files = await readMarkdownFiles(skillerDir, {
				merge_strategy: "cursor",
			});

			// Should find the migrated .mdc file with alwaysApply: true
			const alwaysRuleFile = files.find((f) =>
				f.path.includes("always-rule.mdc"),
			);
			expect(alwaysRuleFile).toBeDefined();
			if (alwaysRuleFile) {
				expect(alwaysRuleFile.path).toContain("skills/always-rule/always-rule.mdc");
				// Content should have frontmatter stripped
				expect(alwaysRuleFile.content).toContain("# Always Applied Rule Content");
				expect(alwaysRuleFile.content).not.toContain("alwaysApply:");
			}
		});
	});
});
