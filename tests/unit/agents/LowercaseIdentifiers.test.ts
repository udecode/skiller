import { CopilotAgent } from '../../../src/agents/CopilotAgent';
import { ClaudeAgent } from '../../../src/agents/ClaudeAgent';
import { CodexCliAgent } from '../../../src/agents/CodexCliAgent';
import { CursorAgent } from '../../../src/agents/CursorAgent';
import { WindsurfAgent } from '../../../src/agents/WindsurfAgent';
import { ClineAgent } from '../../../src/agents/ClineAgent';
import { KiloCodeAgent } from '../../../src/agents/KiloCodeAgent';

describe('Agent Lowercase Identifiers', () => {
  const expectedIdentifiers = {
    'github-copilot': CopilotAgent,
    'claude-code': ClaudeAgent,
    codex: CodexCliAgent,
    cursor: CursorAgent,
    windsurf: WindsurfAgent,
    cline: ClineAgent,
    kilo: KiloCodeAgent,
  };

  describe('Agent.getIdentifier() returns lowercase identifiers', () => {
    Object.entries(expectedIdentifiers).forEach(([expectedId, AgentClass]) => {
      it(`${AgentClass.name} returns "${expectedId}"`, () => {
        const agent = new AgentClass();
        expect(agent.getIdentifier()).toBe(expectedId);
      });
    });
  });

  describe('Agent.getName() returns display names', () => {
    const expectedDisplayNames = {
      'github-copilot': 'GitHub Copilot',
      'claude-code': 'Claude Code',
      codex: 'Codex',
      cursor: 'Cursor',
      windsurf: 'Windsurf',
      cline: 'Cline',
      kilo: 'Kilo Code',
    };

    Object.entries(expectedIdentifiers).forEach(([identifier, AgentClass]) => {
      it(`${AgentClass.name} returns "${expectedDisplayNames[identifier as keyof typeof expectedDisplayNames]}"`, () => {
        const agent = new AgentClass();
        expect(agent.getName()).toBe(
          expectedDisplayNames[identifier as keyof typeof expectedDisplayNames],
        );
      });
    });
  });
});
