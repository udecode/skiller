import {
  getAgentIdentifiersForCliHelp,
  allAgents,
} from '../../../src/agents/index';

describe('Dynamic CLI Help Agent List', () => {
  it('generates comma-separated list of all agent identifiers', () => {
    const result = getAgentIdentifiersForCliHelp();

    // Should be a comma-separated string
    expect(typeof result).toBe('string');
    expect(result).toContain(',');

    // Split into array for analysis
    const identifiers = result.split(', ');

    // Should contain all agent identifiers
    expect(identifiers.length).toBe(allAgents.length);

    // Should contain all actual agent identifiers
    const actualIdentifiers = allAgents.map((agent) => agent.getIdentifier());
    for (const identifier of actualIdentifiers) {
      expect(identifiers).toContain(identifier);
    }
  });

  it('lists the supported public agents in alphabetical order', () => {
    const result = getAgentIdentifiersForCliHelp();
    const identifiers = result.split(', ');
    expect(identifiers).toEqual([...identifiers].sort());
  });

  it('contains canonical ids and excludes removed public agents', () => {
    const result = getAgentIdentifiersForCliHelp();

    const supportedAgents = [
      'claude-code',
      'github-copilot',
      'kilo',
      'kiro-cli',
      'qwen-code',
      'warp',
      'roo',
      'junie',
      'goose',
      'openhands',
    ];

    for (const agent of supportedAgents) {
      expect(result).toContain(agent);
    }

    expect(result).not.toContain('agentsmd');
    expect(result).not.toContain('aider');
    expect(result).not.toContain('firebase');
    expect(result).not.toContain('jules');
    expect(result).not.toContain('zed');
  });

  it('does not contain duplicate identifiers', () => {
    const result = getAgentIdentifiersForCliHelp();
    const identifiers = result.split(', ');

    const uniqueIdentifiers = [...new Set(identifiers)];
    expect(identifiers.length).toBe(uniqueIdentifiers.length);
  });
});
