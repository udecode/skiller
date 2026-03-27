import { AgentsMdAgent } from './AgentsMdAgent';
import { getAgentDisplayName, getAgentSkillsPath } from './catalog';

/**
 * Windsurf agent adapter.
 * Now uses AGENTS.md format like other agents.
 */
export class WindsurfAgent extends AgentsMdAgent {
  getIdentifier(): string {
    return 'windsurf';
  }

  getName(): string {
    return getAgentDisplayName('windsurf');
  }

  // Windsurf supports MCP configuration
  getMcpServerKey(): string {
    return 'mcpServers';
  }

  supportsMcpStdio(): boolean {
    return true;
  }

  supportsMcpRemote(): boolean {
    return true;
  }

  supportsNativeSkills(): boolean {
    return true;
  }

  getSkillsPath(projectRoot: string): string | null {
    return getAgentSkillsPath('windsurf', projectRoot);
  }
}
