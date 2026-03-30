import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function writeFile(targetPath: string, content: string): void {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content);
}

function createProjectRoot(prefix: string): string {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  writeFile(
    path.join(projectRoot, 'package.json'),
    JSON.stringify({ name: 'agent-source-test', private: true }, null, 2),
  );
  writeFile(path.join(projectRoot, '.agents', 'AGENTS.md'), '# Test\n');
  writeFile(path.join(projectRoot, '.agents', 'skiller.toml'), '');
  writeFile(
    path.join(projectRoot, 'skills-lock.json'),
    JSON.stringify({ version: 1, skills: {} }, null, 2) + '\n',
  );
  return projectRoot;
}

function runSkiller(command: string, projectRoot: string): string {
  return execSync(
    `node dist/cli/index.js ${command} --project-root ${JSON.stringify(projectRoot)}`,
    {
      encoding: 'utf8',
      stdio: 'pipe',
    },
  );
}

describe('Agent source compatibility', () => {
  it('adds agent-only plugin sources into canonical .agents/skills and skiller-lock.json', () => {
    const projectRoot = createProjectRoot('skiller-agent-add-');
    const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skiller-agent-src-'));

    writeFile(
      path.join(sourceRoot, '.claude-plugin', 'marketplace.json'),
      JSON.stringify(
        {
          metadata: { pluginRoot: './plugins' },
          plugins: [{ name: 'compound-engineering', source: './compound-engineering' }],
        },
        null,
        2,
      ),
    );
    writeFile(
      path.join(
        sourceRoot,
        'plugins',
        'compound-engineering',
        'agents',
        'research',
        'learnings-researcher.md',
      ),
      `---
name: learnings-researcher
description: Search docs/solutions first
---

Find previous solutions before coding.
`,
    );

    const output = runSkiller(
      `add ${JSON.stringify(sourceRoot)} --skill learnings-researcher -y`,
      projectRoot,
    );

    const skillMd = fs.readFileSync(
      path.join(
        projectRoot,
        '.agents',
        'skills',
        'learnings-researcher',
        'SKILL.md',
      ),
      'utf8',
    );
    const lock = JSON.parse(
      fs.readFileSync(path.join(projectRoot, 'skiller-lock.json'), 'utf8'),
    );

    expect(output).toContain('Installed 1 agent-derived skill');
    expect(skillMd).toContain('name: learnings-researcher');
    expect(skillMd).toContain('Find previous solutions before coding.');
    expect(lock.skills['learnings-researcher']).toMatchObject({
      source: sourceRoot,
      sourceRelPath:
        'plugins/compound-engineering/agents/research/learnings-researcher.md',
      sourceType: 'local',
    });
  });

  it('restores agent-derived skills from skiller-lock.json during install', () => {
    const projectRoot = createProjectRoot('skiller-agent-install-');
    const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skiller-agent-restore-src-'));

    writeFile(
      path.join(sourceRoot, 'agents', 'framework-docs-researcher.md'),
      `---
name: framework-docs-researcher
description: Read framework docs
---

Use the official docs first.
`,
    );
    writeFile(
      path.join(projectRoot, 'skiller-lock.json'),
      JSON.stringify(
        {
          version: 1,
          skills: {
            'framework-docs-researcher': {
              source: sourceRoot,
              sourceType: 'local',
              sourceRelPath: 'agents/framework-docs-researcher.md',
              computedHash: 'stale',
            },
          },
        },
        null,
        2,
      ) + '\n',
    );

    const output = runSkiller('install', projectRoot);
    const restored = fs.readFileSync(
      path.join(
        projectRoot,
        '.agents',
        'skills',
        'framework-docs-researcher',
        'SKILL.md',
      ),
      'utf8',
    );

    expect(output).toContain('Restored 1 agent-derived skill');
    expect(restored).toContain('Use the official docs first.');
  });

  it('reports and updates changed local agent-derived sources', () => {
    const projectRoot = createProjectRoot('skiller-agent-update-');
    const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skiller-agent-update-src-'));

    writeFile(
      path.join(sourceRoot, 'agents', 'coherence-reviewer.md'),
      `---
name: coherence-reviewer
description: Review docs for internal consistency
---

First version.
`,
    );

    runSkiller(`add ${JSON.stringify(sourceRoot)} --skill coherence-reviewer -y`, projectRoot);

    writeFile(
      path.join(sourceRoot, 'agents', 'coherence-reviewer.md'),
      `---
name: coherence-reviewer
description: Review docs for internal consistency
---

Second version.
`,
    );

    const outdatedOutput = runSkiller('outdated', projectRoot);
    const updateOutput = runSkiller('update', projectRoot);
    const updated = fs.readFileSync(
      path.join(projectRoot, '.agents', 'skills', 'coherence-reviewer', 'SKILL.md'),
      'utf8',
    );

    expect(outdatedOutput).toContain('Agent-derived updates available');
    expect(outdatedOutput).toContain('coherence-reviewer');
    expect(updateOutput).toContain('Updated 1 agent-derived skill');
    expect(updated).toContain('Second version.');
  });
});
