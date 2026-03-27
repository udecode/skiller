import * as path from 'path';
import { AbstractAgent } from './AbstractAgent';
import { getAgentDisplayName, getAgentSkillsPath } from './catalog';

export class OpenHandsAgent extends AbstractAgent {
  getIdentifier(): string {
    return 'openhands';
  }

  getName(): string {
    return getAgentDisplayName('openhands');
  }

  getDefaultOutputPath(projectRoot: string): string {
    return path.join(projectRoot, '.openhands', 'microagents', 'repo.md');
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
    return getAgentSkillsPath('openhands', projectRoot);
  }
}
