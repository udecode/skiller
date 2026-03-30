import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  inspectCompatibleSource,
  parseCompatibleSource,
} from '../../../src/core/AgentSourceCompatibility';

function writeFile(targetPath: string, content: string): void {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content);
}

describe('AgentSourceCompatibility', () => {
  it('parses GitHub blob URLs into repo metadata plus file subpath', () => {
    expect(
      parseCompatibleSource(
        'https://github.com/EveryInc/compound-engineering-plugin/blob/main/plugins/compound-engineering/agents/research/learnings-researcher.md',
      ),
    ).toMatchObject({
      ref: 'main',
      source: 'EveryInc/compound-engineering-plugin',
      subpath:
        'plugins/compound-engineering/agents/research/learnings-researcher.md',
      type: 'github',
      url: 'https://github.com/EveryInc/compound-engineering-plugin.git',
    });
  });

  it('discovers a single agent skill when the source points at a direct markdown file', async () => {
    const sourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'skiller-agent-file-source-'),
    );
    const sourceFile = path.join(
      sourceRoot,
      'agents',
      'research',
      'learnings-researcher.md',
    );

    writeFile(
      sourceFile,
      `---
name: learnings-researcher
description: Search docs/solutions first
---

Find previous solutions before coding.
`,
    );

    const inspection = await inspectCompatibleSource(sourceFile);

    expect(inspection.nativeSkillNames).toEqual([]);
    expect(inspection.agentSkills.map((skill) => skill.installName)).toEqual([
      'learnings-researcher',
    ]);
    expect(inspection.agentSkills[0]?.sourceRelPath).toBe(
      'agents/research/learnings-researcher.md',
    );

    await inspection.workspace.cleanup();
  });
});
