import { spawn } from 'child_process';
import * as path from 'path';
import { createRequire } from 'module';

function resolveSkillsCliEntrypoint(projectRoot: string): string {
  const resolvers = [
    createRequire(path.join(projectRoot, 'package.json')),
    createRequire(path.join(__dirname, '..', '..', 'package.json')),
  ];

  for (const resolver of resolvers) {
    try {
      const skillsPackageJson = resolver.resolve('skills/package.json');
      return path.join(path.dirname(skillsPackageJson), 'bin', 'cli.mjs');
    } catch {
      // Try the next resolver.
    }
  }

  throw new Error(
    "Cannot find module 'skills/package.json' from the project root or skiller installation",
  );
}

export async function runSkillsCli(
  projectRoot: string,
  args: string[],
): Promise<void> {
  const cliEntrypoint = resolveSkillsCliEntrypoint(projectRoot);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [cliEntrypoint, ...args], {
      cwd: projectRoot,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `skills ${args[0] ?? ''} failed with exit code ${code}`.trim(),
        ),
      );
    });
  });
}
