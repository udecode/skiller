import * as path from 'path';
import { promises as fs } from 'fs';
import { loadUnifiedConfig } from '../../src/core/UnifiedConfigLoader';

describe('UnifiedConfigLoader integration', () => {
  const projectRoot = path.join(__dirname, 'fixtures', 'unified');
  test('loads config and rules (MCP normalization pending)', async () => {
    const unified = await loadUnifiedConfig({ projectRoot });
    expect(unified.toml.defaultAgents).toEqual(['github-copilot']);
    expect(unified.rules.files.map((f) => f.relativePath)).toEqual([
      'AGENTS.md',
      'extra.md',
    ]);
  });

  test('loads nested configuration option', async () => {
    const unified = await loadUnifiedConfig({ projectRoot });
    expect(unified.toml.nested).toBe(false); // Default should be false

    // Test with nested = true in TOML
    const tomlPath = path.join(projectRoot, '.agents', 'skiller.toml');
    const originalToml = await fs.readFile(tomlPath, 'utf8');
    const modifiedToml = `default_agents = ["github-copilot"]
nested = true

[agents.github-copilot]
output_path = "AGENTS.md"
`;
    await fs.writeFile(tomlPath, modifiedToml, 'utf8');

    try {
      const unifiedWithNested = await loadUnifiedConfig({ projectRoot });
      expect(unifiedWithNested.toml.nested).toBe(true);
    } finally {
      // Restore original TOML
      await fs.writeFile(tomlPath, originalToml, 'utf8');
    }
  });

  test('prefers canonical .agents inputs over legacy .claude inputs', async () => {
    await fs.mkdir(path.join(projectRoot, '.claude'), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, '.claude', 'skiller.toml'),
      'default_agents=["claude-code"]\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(projectRoot, '.claude', 'AGENTS.md'),
      '# Legacy Rules\nLegacy Line\n',
      'utf8',
    );

    const unified = await loadUnifiedConfig({ projectRoot });
    expect(unified.toml.defaultAgents).toEqual(['github-copilot']);
    expect(unified.rules.concatenated).toContain('Primary Rules');
    expect(unified.rules.concatenated).not.toContain('Legacy Rules');
  });
});

// Separate test for MCP once implemented
