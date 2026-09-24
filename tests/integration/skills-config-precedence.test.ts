import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { applyAllAgentConfigs } from '../../src/lib';
import { SKILL_MD_FILENAME } from '../../src/constants';

describe('Skills Configuration Precedence', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'skiller-skills-config-test-'),
    );
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('honors skills.enabled = false in skiller.toml (skips propagation)', async () => {
    // Set up canonical skills.
    const skillerDir = path.join(tmpDir, '.agents');
    const skillsDir = path.join(skillerDir, 'skills');
    const skill1 = path.join(skillsDir, 'test-skill');

    await fs.mkdir(skill1, { recursive: true });
    await fs.writeFile(path.join(skill1, SKILL_MD_FILENAME), '# Test Skill');
    await fs.writeFile(
      path.join(path.dirname(skillerDir), 'AGENTS.md'),
      '# Test Rules',
    );

    // Create skiller.toml with skills.enabled = false
    await fs.writeFile(
      path.join(skillerDir, 'skiller.toml'),
      `
[skills]
enabled = false
`,
    );

    // Apply without CLI flag (should respect TOML config)
    // skills.enabled = false skips propagation without deleting canonical skills.
    await applyAllAgentConfigs(
      tmpDir,
      ['claude-code'], // Just test with one agent
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

    // Claude's projection is absent, while the canonical source remains.
    const claudeSkillsDir = path.join(tmpDir, '.claude', 'skills');
    await expect(fs.access(claudeSkillsDir)).rejects.toThrow();
    await expect(fs.access(skillsDir)).resolves.toBeUndefined();
  });

  it('honors skills.enabled = true in skiller.toml', async () => {
    // Set up canonical skills.
    const skillerDir = path.join(tmpDir, '.agents');
    const skillsDir = path.join(skillerDir, 'skills');
    const skill1 = path.join(skillsDir, 'test-skill');

    await fs.mkdir(skill1, { recursive: true });
    await fs.writeFile(path.join(skill1, SKILL_MD_FILENAME), '# Test Skill');
    await fs.writeFile(
      path.join(path.dirname(skillerDir), 'AGENTS.md'),
      '# Test Rules',
    );

    // Create skiller.toml with skills.enabled = true
    await fs.writeFile(
      path.join(skillerDir, 'skiller.toml'),
      `
[skills]
enabled = true
`,
    );

    // Apply without CLI flag (should respect TOML config)
    await applyAllAgentConfigs(
      tmpDir,
      ['claude-code'], // Just test with one agent
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
    const claudeSkillsDir = path.join(tmpDir, '.claude', 'skills');
    const copiedSkill = path.join(
      claudeSkillsDir,
      'test-skill',
      SKILL_MD_FILENAME,
    );
    expect(await fs.readFile(copiedSkill, 'utf8')).toContain('# Test Skill');
  });

  it('CLI flag overrides skiller.toml setting (skips propagation when disabled)', async () => {
    // Set up canonical skills.
    const skillerDir = path.join(tmpDir, '.agents');
    const skillsDir = path.join(skillerDir, 'skills');
    const skill1 = path.join(skillsDir, 'test-skill');

    await fs.mkdir(skill1, { recursive: true });
    await fs.writeFile(path.join(skill1, SKILL_MD_FILENAME), '# Test Skill');
    await fs.writeFile(
      path.join(path.dirname(skillerDir), 'AGENTS.md'),
      '# Test Rules',
    );

    // Create skiller.toml with skills.enabled = true
    await fs.writeFile(
      path.join(skillerDir, 'skiller.toml'),
      `
[skills]
enabled = true
`,
    );

    // Apply with CLI flag = false (should override TOML)
    // The CLI override skips propagation without deleting canonical skills.
    await applyAllAgentConfigs(
      tmpDir,
      ['claude-code'], // Just test with one agent
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

    // Claude's projection is absent, while the canonical source remains.
    const claudeSkillsDir = path.join(tmpDir, '.claude', 'skills');
    await expect(fs.access(claudeSkillsDir)).rejects.toThrow();
    await expect(fs.access(skillsDir)).resolves.toBeUndefined();
  });

  it('defaults to enabled when no config is set', async () => {
    // Set up canonical skills.
    const skillerDir = path.join(tmpDir, '.agents');
    const skillsDir = path.join(skillerDir, 'skills');
    const skill1 = path.join(skillsDir, 'test-skill');

    await fs.mkdir(skill1, { recursive: true });
    await fs.writeFile(path.join(skill1, SKILL_MD_FILENAME), '# Test Skill');
    await fs.writeFile(
      path.join(path.dirname(skillerDir), 'AGENTS.md'),
      '# Test Rules',
    );

    // Create skiller.toml WITHOUT skills section
    await fs.writeFile(path.join(skillerDir, 'skiller.toml'), '');

    // Apply without CLI flag
    await applyAllAgentConfigs(
      tmpDir,
      ['claude-code'], // Just test with one agent
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
    const claudeSkillsDir = path.join(tmpDir, '.claude', 'skills');
    const copiedSkill = path.join(
      claudeSkillsDir,
      'test-skill',
      SKILL_MD_FILENAME,
    );
    expect(await fs.readFile(copiedSkill, 'utf8')).toContain('# Test Skill');
  });
});
