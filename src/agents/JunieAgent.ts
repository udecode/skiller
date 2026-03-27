import * as path from 'path';
import { AbstractAgent } from './AbstractAgent';
import { getAgentDisplayName, getAgentSkillsPath } from './catalog';

/**
 * JetBrains Junie agent adapter.
 */
export class JunieAgent extends AbstractAgent {
  getIdentifier(): string {
    return 'junie';
  }

  getName(): string {
    return getAgentDisplayName('junie');
  }

  getDefaultOutputPath(projectRoot: string): string {
    return path.join(projectRoot, '.junie', 'guidelines.md');
  }

  supportsNativeSkills(): boolean {
    return true;
  }

  getSkillsPath(projectRoot: string): string | null {
    return getAgentSkillsPath('junie', projectRoot);
  }
}
