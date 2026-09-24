import * as path from 'path';
import { AbstractAgent } from './AbstractAgent';
import type { IAgentConfig } from './IAgent';

/**
 * Agents that read the authored root AGENTS.md directly.
 */
export class AgentsMdAgent extends AbstractAgent {
  getIdentifier(): string {
    return 'agentsmd';
  }

  getName(): string {
    return 'AgentsMd';
  }

  getDefaultOutputPath(projectRoot: string): string {
    return path.join(projectRoot, 'AGENTS.md');
  }

  /* eslint-disable @typescript-eslint/no-unused-vars */
  async applySkillerConfig(
    _concatenatedRules: string,
    _projectRoot: string,
    _skillerMcpJson: Record<string, unknown> | null,
    _agentConfig?: IAgentConfig,
    _backup?: boolean,
    _ruleFiles?: { path: string; content: string }[],
    _skillerDir?: string,
    _mergeStrategy?: 'all' | 'cursor',
  ): Promise<void> {
    // Shared instructions are authored in place and need no projection.
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */

  getMcpServerKey(): string {
    // No MCP configuration for this pseudo-agent
    return '';
  }
}
