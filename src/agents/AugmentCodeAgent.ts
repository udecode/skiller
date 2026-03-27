import * as path from 'path';
import { IAgent, IAgentConfig } from './IAgent';
import { backupFile, writeGeneratedFile } from '../core/FileSystemUtils';
import { getAgentDisplayName, getAgentSkillsPath } from './catalog';

/**
 * AugmentCode agent adapter.
 * Generates skiller_augment_instructions.md configuration file and updates VSCode settings.json with MCP server configuration.
 */
export class AugmentCodeAgent implements IAgent {
  getIdentifier(): string {
    return 'augment';
  }

  getName(): string {
    return getAgentDisplayName('augment');
  }

  async applySkillerConfig(
    concatenatedRules: string,
    projectRoot: string,
    _skillerMcpJson: Record<string, unknown> | null,
    agentConfig?: IAgentConfig,
    backup = true,
  ): Promise<void> {
    const output =
      agentConfig?.outputPath ?? this.getDefaultOutputPath(projectRoot);
    if (backup) {
      await backupFile(output);
    }
    await writeGeneratedFile(output, concatenatedRules);

    // AugmentCode does not support MCP servers
    // MCP configuration is ignored for this agent
  }

  getDefaultOutputPath(projectRoot: string): string {
    return path.join(
      projectRoot,
      '.augment',
      'rules',
      'skiller_augment_instructions.md',
    );
  }

  // AugmentCode does not support MCP servers
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
    return getAgentSkillsPath('augment', projectRoot);
  }
}
