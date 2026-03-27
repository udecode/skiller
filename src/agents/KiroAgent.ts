import * as path from 'path';
import { AbstractAgent } from './AbstractAgent';
import { getAgentDisplayName, getAgentSkillsPath } from './catalog';

export class KiroAgent extends AbstractAgent {
  getIdentifier(): string {
    return 'kiro-cli';
  }

  getName(): string {
    return getAgentDisplayName('kiro-cli');
  }

  getDefaultOutputPath(projectRoot: string): string {
    return path.join(
      projectRoot,
      '.kiro',
      'steering',
      'skiller_kiro_instructions.md',
    );
  }

  supportsNativeSkills(): boolean {
    return true;
  }

  getSkillsPath(projectRoot: string): string | null {
    return getAgentSkillsPath('kiro-cli', projectRoot);
  }
}
