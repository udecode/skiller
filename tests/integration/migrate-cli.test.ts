import { execSync } from 'child_process';

describe('Migrate CLI Integration', () => {
  it('shows help for migrate claude-plugins instead of resolving to rules-to-skills', () => {
    const output = execSync(`node dist/cli/index.js migrate claude-plugins --help`, {
      encoding: 'utf8',
      stdio: 'pipe',
    });

    expect(output).toContain('legacy Claude plugins');
    expect(output).toContain('--execute');
    expect(output).not.toContain('Detect local .agents/rules .mdc files');
    expect(output).not.toContain('rules-to-skills');
  });
});
