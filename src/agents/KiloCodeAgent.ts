import * as path from 'path';
import { AbstractAgent } from './AbstractAgent';
import { getAgentDisplayName, getAgentSkillsPath } from './catalog';

/**
 * Kilo Code agent adapter.
 * Generates skiller_kilocode_instructions.md configuration file in .kilocode/rules/ directory.
 */
export class KiloCodeAgent extends AbstractAgent {
  getIdentifier(): string {
    return 'kilo';
  }

  getName(): string {
    return getAgentDisplayName('kilo');
  }

  getDefaultOutputPath(projectRoot: string): string {
    return path.join(
      projectRoot,
      '.kilocode',
      'rules',
      'skiller_kilocode_instructions.md',
    );
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
    return getAgentSkillsPath('kilo', projectRoot);
  }
}
