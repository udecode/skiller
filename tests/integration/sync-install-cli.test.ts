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

describe('Sync lifecycle CLI', () => {
  it('syncs preset sources before install and prunes outputs removed from synced skills-lock.json on update', () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skiller-sync-install-'));
    const presetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skiller-preset-root-'));
    const skillSourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skiller-skill-source-'));

    writeFile(
      path.join(projectRoot, 'package.json'),
      JSON.stringify({ name: 'sync-install-test', private: true }, null, 2),
    );
    writeFile(path.join(projectRoot, '.agents', 'AGENTS.md'), '# Local\n');
    writeFile(
      path.join(projectRoot, '.agents', 'skiller.toml'),
      `[sync]
source = ${JSON.stringify(presetRoot)}
`,
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
      path.join(skillSourceRoot, 'skills', 'trace', 'SKILL.md'),
      `---
name: trace
description: Trace carefully
---

Trace deeply.
`,
    );

    writeFile(
      path.join(presetRoot, '.agents', 'AGENTS.md'),
      '# Preset\n',
    );
    writeFile(
      path.join(presetRoot, '.agents', 'skiller.toml'),
      `default_agents = ["codex"]`,
    );
    writeFile(path.join(presetRoot, '.claude', 'prompt.yml'), 'hooks: []\n');
    writeFile(
      path.join(presetRoot, 'skills-lock.json'),
      JSON.stringify(
        {
          version: 1,
          skills: {
            debug: {
              source: skillSourceRoot,
              sourceType: 'local',
              computedHash: 'old-debug',
            },
            trace: {
              source: skillSourceRoot,
              sourceType: 'local',
              computedHash: 'old-trace',
            },
          },
        },
        null,
        2,
      ) + '\n',
    );

    const installOutput = runSkiller('install', projectRoot);
    expect(installOutput).toContain('Synced');
    expect(
      fs.existsSync(path.join(projectRoot, '.claude', 'prompt.yml')),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(projectRoot, '.agents', 'skills', 'debug', 'SKILL.md')),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(projectRoot, '.agents', 'skills', 'trace', 'SKILL.md')),
    ).toBe(true);
    expect(
      fs.readFileSync(path.join(projectRoot, '.agents', 'skiller.toml'), 'utf8'),
    ).toContain('[sync]');

    writeFile(
      path.join(presetRoot, 'skills-lock.json'),
      JSON.stringify(
        {
          version: 1,
          skills: {
            debug: {
              source: skillSourceRoot,
              sourceType: 'local',
              computedHash: 'new-debug',
            },
          },
        },
        null,
        2,
      ) + '\n',
    );

    const updateOutput = runSkiller('update', projectRoot);
    expect(updateOutput).toContain('removed by source update: trace');
    expect(
      fs.existsSync(path.join(projectRoot, '.agents', 'skills', 'trace', 'SKILL.md')),
    ).toBe(false);
  });

  it('supports repo-mode sync-only with include and exclude rules', () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skiller-sync-repo-'));
    const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skiller-sync-repo-src-'));

    writeFile(
      path.join(projectRoot, 'package.json'),
      JSON.stringify({ name: 'sync-repo-test', private: true }, null, 2),
    );
    writeFile(path.join(projectRoot, '.agents', 'AGENTS.md'), '# Local\n');
    writeFile(
      path.join(projectRoot, '.agents', 'skiller.toml'),
      `[sync]
source = ${JSON.stringify(sourceRoot)}
mode = "repo"
include = [".agents/rules/**", ".claude/scripts/**"]
exclude = [".agents/rules/private/**"]
`,
    );

    writeFile(path.join(sourceRoot, '.agents', 'rules', 'task.mdc'), '# task\n');
    writeFile(
      path.join(sourceRoot, '.agents', 'rules', 'private', 'secret.mdc'),
      '# secret\n',
    );
    writeFile(path.join(sourceRoot, '.claude', 'scripts', 'hook.sh'), 'echo hi\n');
    writeFile(path.join(sourceRoot, 'README.md'), '# nope\n');

    const output = runSkiller('install --sync-only', projectRoot);

    expect(output).toContain('Synced 2 file(s)');
    expect(
      fs.existsSync(path.join(projectRoot, '.agents', 'rules', 'task.mdc')),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(projectRoot, '.agents', 'rules', 'private', 'secret.mdc'),
      ),
    ).toBe(false);
    expect(fs.existsSync(path.join(projectRoot, 'README.md'))).toBe(false);
  });

  it('runs sync across nested project roots', () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skiller-sync-nested-'));
    const presetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skiller-sync-nested-preset-'));

    writeFile(
      path.join(projectRoot, 'package.json'),
      JSON.stringify({ name: 'sync-nested-test', private: true }, null, 2),
    );
    writeFile(path.join(projectRoot, '.agents', 'AGENTS.md'), '# Root\n');
    writeFile(
      path.join(projectRoot, '.agents', 'skiller.toml'),
      `[sync]
source = ${JSON.stringify(presetRoot)}
`,
    );
    writeFile(
      path.join(projectRoot, 'templates', 'child', 'package.json'),
      JSON.stringify({ name: 'sync-child-test', private: true }, null, 2),
    );
    writeFile(
      path.join(projectRoot, 'templates', 'child', '.agents', 'AGENTS.md'),
      '# Child\n',
    );
    writeFile(
      path.join(projectRoot, 'templates', 'child', '.agents', 'skiller.toml'),
      `[sync]
source = ${JSON.stringify(presetRoot)}
`,
    );

    writeFile(path.join(presetRoot, '.claude', 'prompt.yml'), 'hooks: []\n');

    const output = runSkiller('install --nested --sync-only', projectRoot);

    expect(output).toContain('Synced 1 file(s)');
    expect(
      fs.existsSync(path.join(projectRoot, '.claude', 'prompt.yml')),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(projectRoot, 'templates', 'child', '.claude', 'prompt.yml'),
      ),
    ).toBe(true);
  });
});
