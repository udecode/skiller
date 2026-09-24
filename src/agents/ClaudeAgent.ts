import { AgentsMdAgent } from './AgentsMdAgent';
import { getAgentDisplayName, getAgentSkillsPath } from './catalog';

export class ClaudeAgent extends AgentsMdAgent {
  getIdentifier(): string {
    return 'claude-code';
  }

  getName(): string {
    return getAgentDisplayName('claude-code');
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
    return getAgentSkillsPath('claude-code', projectRoot);
  }
}
