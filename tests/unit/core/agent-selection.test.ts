import { resolveSelectedAgents } from '../../../src/core/agent-selection';
import { LoadedConfig } from '../../../src/core/ConfigLoader';
import { IAgent } from '../../../src/agents/IAgent';

// Mock agent implementation for testing
class MockAgent implements IAgent {
  constructor(
    private name: string,
    private identifier: string,
  ) {}

  getIdentifier(): string {
    return this.identifier;
  }

  getName(): string {
    return this.name;
  }

  async applySkillerConfig(): Promise<void> {
    // Mock implementation
  }

  getDefaultOutputPath(): string {
    return `.${this.identifier}/config.json`;
  }
}

describe('resolveSelectedAgents', () => {
  const mockAgents = [
    new MockAgent('Claude Code', 'claude-code'),
    new MockAgent('GitHub Copilot', 'github-copilot'),
    new MockAgent('Cursor', 'cursor'),
  ];

  it('should select agents based on CLI filters', () => {
    const config: LoadedConfig = {
      cliAgents: ['claude-code', 'cursor'],
      agentConfigs: {},
    };

    const result = resolveSelectedAgents(config, mockAgents);

    expect(result).toHaveLength(2);
    expect(result.map((a) => a.getIdentifier())).toEqual([
      'claude-code',
      'cursor',
    ]);
  });

  it('should select agents based on exact canonical CLI filters', () => {
    const config: LoadedConfig = {
      cliAgents: ['github-copilot'],
      agentConfigs: {},
    };

    const result = resolveSelectedAgents(config, mockAgents);

    expect(result).toHaveLength(1);
    expect(result[0].getIdentifier()).toBe('github-copilot');
  });

  it('should throw error for invalid CLI agent identifiers', () => {
    const config: LoadedConfig = {
      cliAgents: ['invalid-agent'],
      agentConfigs: {},
    };

    expect(() => resolveSelectedAgents(config, mockAgents)).toThrow(
      'Invalid agent specified: invalid-agent',
    );
  });

  it('should select agents based on default_agents when no CLI filters', () => {
    const config: LoadedConfig = {
      defaultAgents: ['github-copilot'],
      agentConfigs: {},
    };

    const result = resolveSelectedAgents(config, mockAgents);

    expect(result).toHaveLength(1);
    expect(result[0].getIdentifier()).toBe('github-copilot');
  });

  it('should respect enabled flag in agent configs when using default_agents', () => {
    const config: LoadedConfig = {
      defaultAgents: ['claude-code', 'github-copilot'],
      agentConfigs: {
        'claude-code': { enabled: false },
        'github-copilot': { enabled: true },
      },
    };

    const result = resolveSelectedAgents(config, mockAgents);

    expect(result).toHaveLength(1);
    expect(result[0].getIdentifier()).toBe('github-copilot');
  });

  it('should throw error for invalid default_agents', () => {
    const config: LoadedConfig = {
      defaultAgents: ['invalid-default'],
      agentConfigs: {},
    };

    expect(() => resolveSelectedAgents(config, mockAgents)).toThrow(
      'Invalid agent specified in default_agents: invalid-default',
    );
  });

  it('should select all enabled agents when no filters or defaults', () => {
    const config: LoadedConfig = {
      agentConfigs: {
        'claude-code': { enabled: false },
      },
    };

    const result = resolveSelectedAgents(config, mockAgents);

    expect(result).toHaveLength(2);
    expect(result.map((a) => a.getIdentifier()).sort()).toEqual([
      'cursor',
      'github-copilot',
    ]);
  });

  it('should select all agents when no configuration is provided', () => {
    const config: LoadedConfig = {
      agentConfigs: {},
    };

    const result = resolveSelectedAgents(config, mockAgents);

    expect(result).toHaveLength(3);
    expect(result.map((a) => a.getIdentifier()).sort()).toEqual([
      'claude-code',
      'cursor',
      'github-copilot',
    ]);
  });

  it('should handle CLI agents precedence over default_agents', () => {
    const config: LoadedConfig = {
      cliAgents: ['claude-code'],
      defaultAgents: ['github-copilot', 'cursor'],
      agentConfigs: {},
    };

    const result = resolveSelectedAgents(config, mockAgents);

    expect(result).toHaveLength(1);
    expect(result[0].getIdentifier()).toBe('claude-code');
  });

  it('should reject legacy CLI aliases', () => {
    const config: LoadedConfig = {
      cliAgents: ['claude'],
      agentConfigs: {},
    };

    expect(() => resolveSelectedAgents(config, mockAgents)).toThrow(
      'Invalid agent specified: claude',
    );
  });

  it('should reject legacy default_agents aliases', () => {
    const config: LoadedConfig = {
      defaultAgents: ['copilot'],
      agentConfigs: {},
    };

    expect(() => resolveSelectedAgents(config, mockAgents)).toThrow(
      'Invalid agent specified in default_agents: copilot',
    );
  });

  it('should include agents with explicit enabled=true even when not in default_agents', () => {
    const config: LoadedConfig = {
      defaultAgents: ['claude-code'],
      agentConfigs: {
        'github-copilot': { enabled: true },
        'claude-code': { enabled: true },
      },
    };

    const result = resolveSelectedAgents(config, mockAgents);

    expect(result).toHaveLength(2);
    expect(result.map((a) => a.getIdentifier()).sort()).toEqual([
      'claude-code',
      'github-copilot',
    ]);
  });

  it('should exclude agents with explicit enabled=false even when in default_agents', () => {
    const config: LoadedConfig = {
      defaultAgents: ['claude-code', 'github-copilot'],
      agentConfigs: {
        'github-copilot': { enabled: false },
      },
    };

    const result = resolveSelectedAgents(config, mockAgents);

    expect(result).toHaveLength(1);
    expect(result[0].getIdentifier()).toBe('claude-code');
  });

  it('should handle explicit disable override in default_agents', () => {
    const config: LoadedConfig = {
      defaultAgents: ['claude-code', 'github-copilot'],
      agentConfigs: {
        'claude-code': { enabled: false },
        'github-copilot': { enabled: undefined },
      },
    };

    const result = resolveSelectedAgents(config, mockAgents);

    expect(result).toHaveLength(1);
    expect(result[0].getIdentifier()).toBe('github-copilot');
  });

  it('should reject non-exact casing for CLI agents', () => {
    const config: LoadedConfig = {
      cliAgents: ['CLAUDE-CODE', 'cursor'],
      agentConfigs: {},
    };

    expect(() => resolveSelectedAgents(config, mockAgents)).toThrow(
      'Invalid agent specified: CLAUDE-CODE',
    );
  });

  it('should handle empty CLI agents array', () => {
    const config: LoadedConfig = {
      cliAgents: [],
      agentConfigs: {},
    };

    const result = resolveSelectedAgents(config, mockAgents);

    expect(result).toHaveLength(3);
    expect(result.map((a) => a.getIdentifier()).sort()).toEqual([
      'claude-code',
      'cursor',
      'github-copilot',
    ]);
  });

  it('should handle empty default agents array', () => {
    const config: LoadedConfig = {
      defaultAgents: [],
      agentConfigs: {},
    };

    const result = resolveSelectedAgents(config, mockAgents);

    expect(result).toHaveLength(3);
    expect(result.map((a) => a.getIdentifier()).sort()).toEqual([
      'claude-code',
      'cursor',
      'github-copilot',
    ]);
  });
});
