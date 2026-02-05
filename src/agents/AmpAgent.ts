import * as path from 'path';
import { AgentsMdAgent } from './AgentsMdAgent';

export class AmpAgent extends AgentsMdAgent {
  getIdentifier(): string {
    return 'amp';
  }

  getName(): string {
    return 'Amp';
  }

  supportsNativeSkills(): boolean {
    return true;
  }

  getSkillsPath(projectRoot: string): string | null {
    return path.join(projectRoot, '.agents/skills');
  }
}
