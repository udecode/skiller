import { setupTestProject, teardownTestProject } from '../../harness';
import { ClaudeAgent } from '../../../src/agents/ClaudeAgent';
import { CodexCliAgent } from '../../../src/agents/CodexCliAgent';
import { CursorAgent } from '../../../src/agents/CursorAgent';

describe('Skills Gitignore Paths', () => {
  let testProject: { projectRoot: string };

  beforeEach(async () => {
    testProject = await setupTestProject();
  });

  afterEach(async () => {
    await teardownTestProject(testProject.projectRoot);
  });

  it('returns empty array when no agents have skills support', async () => {
    const { projectRoot } = testProject;
    const { getSkillsGitignorePaths } = await import(
      '../../../src/core/SkillsProcessor'
    );

    // No agents = no skills paths
    const paths = getSkillsGitignorePaths(projectRoot, []);

    expect(paths).toEqual([]);
  });

  it('returns deduped agent skills paths but excludes source (.claude/skills)', async () => {
    const { projectRoot } = testProject;
    const { getSkillsGitignorePaths } = await import(
      '../../../src/core/SkillsProcessor'
    );

    const agents = [new ClaudeAgent(), new CodexCliAgent(), new CursorAgent()];

    // .claude/skills is the source (should NOT be in gitignore)
    // Cursor now follows the shared .agents/skills project convention.
    const paths = getSkillsGitignorePaths(projectRoot, agents);

    expect(paths).toContain('.agents/skills');
    expect(paths).not.toContain('.cursor/skills');
    expect(paths).not.toContain('.claude/skills');
  });
});
