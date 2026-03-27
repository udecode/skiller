import * as path from 'path';
import { AbstractAgent } from './AbstractAgent';
import { getAgentDisplayName, getAgentSkillsPath } from './catalog';

/**
 * Trae AI agent adapter.
 * Generates project_rules.md configuration file.
 */
export class TraeAgent extends AbstractAgent {
  getIdentifier(): string {
    return 'trae';
  }

  getName(): string {
    return getAgentDisplayName('trae');
  }

  getDefaultOutputPath(projectRoot: string): string {
    return path.join(projectRoot, '.trae', 'rules', 'project_rules.md');
  }

  supportsNativeSkills(): boolean {
    return true;
  }

  getSkillsPath(projectRoot: string): string | null {
    return getAgentSkillsPath('trae', projectRoot);
  }
}
