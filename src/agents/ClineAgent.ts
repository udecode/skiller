import * as path from 'path';
import { AbstractAgent } from './AbstractAgent';
import { getAgentDisplayName, getAgentSkillsPath } from './catalog';

/**
 * Cline agent adapter.
 */
export class ClineAgent extends AbstractAgent {
  getIdentifier(): string {
    return 'cline';
  }

  getName(): string {
    return getAgentDisplayName('cline');
  }

  getDefaultOutputPath(projectRoot: string): string {
    return path.join(projectRoot, '.clinerules');
  }

  supportsNativeSkills(): boolean {
    return true;
  }

  getSkillsPath(projectRoot: string): string | null {
    return getAgentSkillsPath('cline', projectRoot);
  }
}
