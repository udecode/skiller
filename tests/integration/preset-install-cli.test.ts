import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function writeFile(targetPath: string, content: string): void {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content);
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

describe('Preset install CLI', () => {
  it('materializes a preset from a repo root and writes a standalone merged config', () => {
    const projectRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'skiller-preset-project-'),
    );
    const sourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'skiller-preset-source-'),
    );
    const skillSourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'skiller-preset-skills-'),
    );

    writeFile(
      path.join(projectRoot, 'package.json'),
      JSON.stringify({ name: 'preset-install-test', private: true }, null, 2),
    );
    writeFile(
      path.join(projectRoot, '.agents', 'skiller.toml'),
      `default_agents = ["claude-code"]\n`,
    );

    writeFile(
      path.join(skillSourceRoot, 'skills', 'debug', 'SKILL.md'),
      `---
name: debug
description: Debug things
---

Debug carefully.
`,
    );

    writeFile(
      path.join(sourceRoot, 'presets', 'default', '.agents', 'AGENTS.md'),
      '# Preset\n',
    );
    writeFile(
      path.join(sourceRoot, '.agents', 'rules', 'react.mdc'),
      '# Shared React\n',
    );
    writeFile(
      path.join(sourceRoot, '.claude', 'prompt.yml'),
      'hooks:\n  - base\n',
    );
    writeFile(
      path.join(sourceRoot, 'presets', 'default', '.agents', 'skiller.toml'),
      `default_agents = ["codex"]

[skills]
enabled = false
`,
    );
    writeFile(
      path.join(sourceRoot, 'presets', 'default', 'preset.toml'),
      `version = 1

include = [
  "../../.agents/rules/react.mdc",
  "../../.claude/prompt.yml",
  "../../skills-lock.json",
]
`,
    );
    writeFile(
      path.join(sourceRoot, 'presets', 'default', '.claude', 'prompt.yml'),
      'hooks: []\n',
    );
    writeFile(
      path.join(sourceRoot, 'skills-lock.json'),
      JSON.stringify(
        {
          version: 1,
          skills: {
            debug: {
              source: skillSourceRoot,
              sourceType: 'local',
              computedHash: 'debug-hash',
            },
          },
        },
        null,
        2,
      ) + '\n',
    );

    const output = runSkiller(
      `install ${JSON.stringify(sourceRoot)} --preset default`,
      projectRoot,
    );

    expect(output).toContain("Materialized preset 'default'");
    expect(
      fs.existsSync(path.join(projectRoot, '.claude', 'prompt.yml')),
    ).toBe(true);
    expect(
      fs.readFileSync(path.join(projectRoot, '.claude', 'prompt.yml'), 'utf8'),
    ).toBe('hooks: []\n');
    expect(
      fs.readFileSync(
        path.join(projectRoot, '.agents', 'rules', 'react.mdc'),
        'utf8',
      ),
    ).toBe('# Shared React\n');
    expect(
      fs.existsSync(
        path.join(projectRoot, '.agents', 'skills', 'debug', 'SKILL.md'),
      ),
    ).toBe(true);

    const configText = fs.readFileSync(
      path.join(projectRoot, '.agents', 'skiller.toml'),
      'utf8',
    );
    expect(configText).toContain('default_agents = [ "claude-code" ]');
    expect(configText).toContain('[skills]');
    expect(configText).toContain('enabled = false');
    expect(configText).not.toContain('[sync]');
  });

  it('auto-selects the default preset and prunes lock-backed outputs removed by a preset refresh', () => {
    const projectRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'skiller-preset-refresh-project-'),
    );
    const sourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'skiller-preset-refresh-source-'),
    );
    const skillSourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'skiller-preset-refresh-skills-'),
    );

    writeFile(
      path.join(projectRoot, 'package.json'),
      JSON.stringify(
        { name: 'preset-refresh-test', private: true },
        null,
        2,
      ),
    );
    writeFile(path.join(projectRoot, '.agents', 'AGENTS.md'), '# Local\n');
    writeFile(path.join(projectRoot, '.agents', 'skiller.toml'), '');

    writeFile(
      path.join(skillSourceRoot, 'skills', 'debug', 'SKILL.md'),
      `---
name: debug
description: Debug things
---

Debug carefully.
`,
    );
    writeFile(
      path.join(skillSourceRoot, 'skills', 'trace', 'SKILL.md'),
      `---
name: trace
description: Trace things
---

Trace carefully.
`,
    );

    writeFile(
      path.join(sourceRoot, 'presets', 'default', '.agents', 'AGENTS.md'),
      '# Preset\n',
    );
    writeFile(
      path.join(sourceRoot, 'presets', 'default', 'skills-lock.json'),
      JSON.stringify(
        {
          version: 1,
          skills: {
            debug: {
              source: skillSourceRoot,
              sourceType: 'local',
              computedHash: 'debug-hash',
            },
            trace: {
              source: skillSourceRoot,
              sourceType: 'local',
              computedHash: 'trace-hash',
            },
          },
        },
        null,
        2,
      ) + '\n',
    );

    runSkiller(`install ${JSON.stringify(sourceRoot)}`, projectRoot);
    expect(
      fs.existsSync(
        path.join(projectRoot, '.agents', 'skills', 'trace', 'SKILL.md'),
      ),
    ).toBe(true);

    writeFile(
      path.join(sourceRoot, 'presets', 'default', 'skills-lock.json'),
      JSON.stringify(
        {
          version: 1,
          skills: {
            debug: {
              source: skillSourceRoot,
              sourceType: 'local',
              computedHash: 'debug-hash-2',
            },
          },
        },
        null,
        2,
      ) + '\n',
    );

    const secondOutput = runSkiller(
      `install ${JSON.stringify(sourceRoot)}`,
      projectRoot,
    );

    expect(secondOutput).toContain('removed by source update: trace');
    expect(
      fs.existsSync(
        path.join(projectRoot, '.agents', 'skills', 'trace', 'SKILL.md'),
      ),
    ).toBe(false);
  });

  it('rejects preset include entries that resolve to directories', () => {
    const projectRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'skiller-preset-dir-project-'),
    );
    const sourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'skiller-preset-dir-source-'),
    );

    writeFile(
      path.join(projectRoot, 'package.json'),
      JSON.stringify({ name: 'preset-dir-test', private: true }, null, 2),
    );
    writeFile(path.join(projectRoot, '.agents', 'skiller.toml'), '');
    writeFile(
      path.join(sourceRoot, 'presets', 'default', '.agents', 'AGENTS.md'),
      '# Preset\n',
    );
    writeFile(
      path.join(sourceRoot, 'presets', 'default', 'preset.toml'),
      `version = 1

include = [
  "../../.agents/rules",
]
`,
    );
    writeFile(
      path.join(sourceRoot, '.agents', 'rules', 'react.mdc'),
      '# Shared React\n',
    );

    expect(() =>
      runSkiller(
        `install ${JSON.stringify(sourceRoot)} --preset default`,
        projectRoot,
      ),
    ).toThrow('must resolve to a file, not a directory');
  });
});
