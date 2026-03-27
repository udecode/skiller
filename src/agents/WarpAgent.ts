import * as path from 'path';
import { AbstractAgent } from './AbstractAgent';
import { getAgentDisplayName, getAgentSkillsPath } from './catalog';

/**
 * Warp Agent Mode adapter.
 * Generates WARP.md configuration file in the project root.
 */
export class WarpAgent extends AbstractAgent {
  getIdentifier(): string {
    return 'warp';
  }

  getName(): string {
    return getAgentDisplayName('warp');
  }

  getDefaultOutputPath(projectRoot: string): string {
    return path.join(projectRoot, 'WARP.md');
  }

  // Warp does not support MCP servers
  supportsMcpStdio(): boolean {
    return false;
  }

  supportsMcpRemote(): boolean {
    return false;
  }

  supportsNativeSkills(): boolean {
    return true;
  }

  getSkillsPath(projectRoot: string): string | null {
    return getAgentSkillsPath('warp', projectRoot);
  }
}
