import { AgentsMdAgent } from './AgentsMdAgent';
import { getAgentDisplayName, getAgentSkillsPath } from './catalog';

/**
 * Antigravity agent adapter.
 * Uses root AGENTS.md, .agents/skills, and .agents/mcp_config.json.
 */
export class AntigravityAgent extends AgentsMdAgent {
  getIdentifier(): string {
    return 'antigravity';
  }

  getName(): string {
    return getAgentDisplayName('antigravity');
  }

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
    return getAgentSkillsPath('antigravity', projectRoot);
  }
}
