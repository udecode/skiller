import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('Skills wrapper CLI', () => {
  it('passes through unknown flags like -y to remove instead of failing yargs parsing', () => {
    const projectRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'skiller-remove-wrapper-'),
    );
    fs.writeFileSync(
      path.join(projectRoot, 'package.json'),
      JSON.stringify({ name: 'wrapper-test', private: true }, null, 2),
    );
    fs.mkdirSync(path.join(projectRoot, '.claude'), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, '.agents'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, '.agents', 'AGENTS.md'), '');
    fs.writeFileSync(path.join(projectRoot, '.agents', 'skiller.toml'), '');

    const output = execSync(
      `node dist/cli/index.js remove definitely-not-a-skill -y --project-root ${projectRoot}`,
      {
        encoding: 'utf8',
        stdio: 'pipe',
      },
    );

    expect(output).toContain('Apply completed successfully');
    expect(output).not.toContain('Unknown argument: y');
  });

  it('scrubs stale skills-lock entries even when skills remove finds no matching folders', () => {
    const projectRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'skiller-remove-stale-lock-'),
    );
    fs.writeFileSync(
      path.join(projectRoot, 'package.json'),
      JSON.stringify({ name: 'wrapper-test', private: true }, null, 2),
    );
    fs.mkdirSync(path.join(projectRoot, '.claude'), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, '.agents'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, '.agents', 'AGENTS.md'), '');
    fs.writeFileSync(path.join(projectRoot, '.agents', 'skiller.toml'), '');
    fs.writeFileSync(
      path.join(projectRoot, 'skills-lock.json'),
      JSON.stringify(
        {
          skills: {
            'ce:work-beta': {
              source: 'EveryInc/compound-engineering-plugin',
              sourceType: 'github',
            },
            keep: {
              source: 'foo/bar',
              sourceType: 'github',
            },
          },
        },
        null,
        2,
      ) + '\n',
    );

    const output = execSync(
      `node dist/cli/index.js remove ce-work-beta -y --project-root ${projectRoot}`,
      {
        encoding: 'utf8',
        stdio: 'pipe',
      },
    );

    const lock = JSON.parse(
      fs.readFileSync(path.join(projectRoot, 'skills-lock.json'), 'utf8'),
    );

    expect(output).toContain('Apply completed successfully');
    expect(lock.skills).toEqual({
      keep: {
        source: 'foo/bar',
        sourceType: 'github',
      },
    });
  });

  it('prunes removed upstream skills from skills-lock.json during install', () => {
    const projectRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'skiller-install-prune-native-'),
    );
    const sourceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'skiller-install-prune-native-src-'),
    );

    fs.writeFileSync(
      path.join(projectRoot, 'package.json'),
      JSON.stringify({ name: 'wrapper-test', private: true }, null, 2),
    );
    fs.mkdirSync(path.join(projectRoot, '.claude'), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, '.agents'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, '.agents', 'AGENTS.md'), '');
    fs.writeFileSync(path.join(projectRoot, '.agents', 'skiller.toml'), '');

    fs.mkdirSync(path.join(sourceRoot, 'skills', 'debug'), { recursive: true });
    fs.writeFileSync(
      path.join(sourceRoot, 'skills', 'debug', 'SKILL.md'),
      `---
name: debug
description: Debug things
---

Use evidence first.
`,
    );

    fs.writeFileSync(
      path.join(projectRoot, 'skills-lock.json'),
      JSON.stringify(
        {
          version: 1,
          skills: {
            debug: {
              source: sourceRoot,
              sourceType: 'local',
              computedHash: 'old-debug',
            },
            trace: {
              source: sourceRoot,
              sourceType: 'local',
              computedHash: 'old-trace',
            },
          },
        },
        null,
        2,
      ) + '\n',
    );

    fs.mkdirSync(path.join(projectRoot, '.agents', 'skills', 'trace'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(projectRoot, '.agents', 'skills', 'trace', 'SKILL.md'),
      'stale trace\n',
    );

    const output = execSync(
      `node dist/cli/index.js install --project-root ${JSON.stringify(projectRoot)}`,
      {
        encoding: 'utf8',
        stdio: 'pipe',
      },
    );

    const lock = JSON.parse(
      fs.readFileSync(path.join(projectRoot, 'skills-lock.json'), 'utf8'),
    );

    expect(output).toContain('Pruned 1 stale upstream skill(s): trace');
    expect(lock.skills).toEqual({
      debug: {
        source: sourceRoot,
        sourceType: 'local',
        computedHash: expect.any(String),
      },
    });
    expect(
      fs.existsSync(path.join(projectRoot, '.agents', 'skills', 'trace')),
    ).toBe(false);
    expect(
      fs.existsSync(path.join(projectRoot, '.agents', 'skills', 'debug', 'SKILL.md')),
    ).toBe(true);
  });
});
