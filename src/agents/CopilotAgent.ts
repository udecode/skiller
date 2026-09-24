import { AgentsMdAgent } from './AgentsMdAgent';
import { getAgentDisplayName, getAgentSkillsPath } from './catalog';

/**
 * GitHub Copilot agent adapter.
 * Uses the authored AGENTS.md for both web-based GitHub Copilot and VS Code.
 */
export class CopilotAgent extends AgentsMdAgent {
  getIdentifier(): string {
    return 'github-copilot';
  }

  getName(): string {
    return getAgentDisplayName('github-copilot');
  }

  getMcpServerKey(): string {
    return 'servers';
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
    return getAgentSkillsPath('github-copilot', projectRoot);
  }
}
