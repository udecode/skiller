import { mapRawAgentConfigs } from '../../../src/core/config-utils';
import { IAgent, IAgentConfig } from '../../../src/agents/IAgent';

// Mock agents for testing
class MockAgent implements IAgent {
  constructor(
    private identifier: string,
    private name: string,
  ) {}

  getIdentifier(): string {
    return this.identifier;
  }

  getName(): string {
    return this.name;
  }

  applySkillerConfig(): Promise<void> {
    return Promise.resolve();
  }

  getDefaultOutputPath(): string {
    return '';
  }
}

describe('config-utils', () => {
  describe('mapRawAgentConfigs', () => {
    let mockAgents: IAgent[];

    beforeEach(() => {
      mockAgents = [
        new MockAgent('github-copilot', 'GitHub Copilot'),
        new MockAgent('claude-code', 'Claude Code'),
        new MockAgent('cursor', 'Cursor'),
        new MockAgent('augment', 'Augment'),
      ];
    });

    it('should map exact canonical identifier matches only', () => {
      const rawConfigs = {
        'github-copilot': { enabled: true },
        'claude-code': { enabled: false },
        cursor: { outputPath: '/custom/path' },
      };

      const result = mapRawAgentConfigs(rawConfigs, mockAgents);

      expect(result).toEqual({
        'github-copilot': { enabled: true },
        'claude-code': { enabled: false },
        cursor: { outputPath: '/custom/path' },
      });
    });

    it('should fail hard on legacy ids and fuzzy matches', () => {
      const rawConfigs = {
        copilot: { enabled: true },
        github: { enabled: false },
        'CLAUDE-CODE': { outputPath: '/path' },
      };

      expect(() => mapRawAgentConfigs(rawConfigs, mockAgents)).toThrow(
        'Invalid agent config section: copilot, github, CLAUDE-CODE',
      );
    });

    it('should preserve exact canonical config keys', () => {
      const rawConfigs = {
        'github-copilot': { enabled: true },
        'claude-code': { outputPath: '/claude' },
        augment: { outputPath: '/augment' },
      };

      const result = mapRawAgentConfigs(rawConfigs, mockAgents);

      expect(result).toEqual(rawConfigs);
    });

    it('should throw when any config key does not match an exact canonical agent id', () => {
      const rawConfigs = {
        'github-copilot': { enabled: true },
        nonexistent: { enabled: false },
        invalid_agent: { outputPath: '/path' },
      };

      expect(() => mapRawAgentConfigs(rawConfigs, mockAgents)).toThrow(
        'Invalid agent config section: nonexistent, invalid_agent',
      );
    });

    it('should handle empty raw configs', () => {
      const rawConfigs = {};

      const result = mapRawAgentConfigs(rawConfigs, mockAgents);

      expect(result).toEqual({});
    });

    it('should throw when agents array is empty but config keys are present', () => {
      const rawConfigs = {
        'github-copilot': { enabled: true },
        'claude-code': { enabled: false },
      };

      expect(() => mapRawAgentConfigs(rawConfigs, [])).toThrow(
        'Invalid agent config section: github-copilot, claude-code',
      );
    });

    it('should reject non-exact casing', () => {
      const rawConfigs = {
        'GITHUB-COPILOT': { enabled: true },
      };

      expect(() => mapRawAgentConfigs(rawConfigs, mockAgents)).toThrow(
        'Invalid agent config section: GITHUB-COPILOT',
      );
    });

    it('should preserve all config properties', () => {
      const rawConfigs = {
        'github-copilot': {
          enabled: true,
          outputPath: '/custom/path',
          outputPathInstructions: '/instructions',
          outputPathConfig: '/config',
          mcp: { enabled: false },
        },
      };

      const result = mapRawAgentConfigs(rawConfigs, mockAgents);

      expect(result['github-copilot']).toEqual({
        enabled: true,
        outputPath: '/custom/path',
        outputPathInstructions: '/instructions',
        outputPathConfig: '/config',
        mcp: { enabled: false },
      });
    });

    it('should preserve exact keys for arbitrary canonical ids', () => {
      const agents = [new MockAgent('test-agent', 'Test Agent With Long Name')];
      const rawConfigs = {
        'test-agent': { enabled: true },
      };

      expect(mapRawAgentConfigs(rawConfigs, agents)).toEqual(rawConfigs);
    });
  });
});
