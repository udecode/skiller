import { AgentsMdAgent } from './AgentsMdAgent';
import { getAgentDisplayName, getAgentSkillsPath } from './catalog';

export class AmpAgent extends AgentsMdAgent {
  getIdentifier(): string {
    return 'amp';
  }

  getName(): string {
    return getAgentDisplayName('amp');
  }

  supportsNativeSkills(): boolean {
    return true;
  }

  getSkillsPath(projectRoot: string): string | null {
    return getAgentSkillsPath('amp', projectRoot);
  }
}
