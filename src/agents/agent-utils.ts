import * as path from 'path';
import { IAgent, IAgentConfig } from './IAgent';

/**
 * Gets all output paths for an agent, taking into account any config overrides.
 */
export function getAgentOutputPaths(
  agent: IAgent,
  projectRoot: string,
  agentConfig?: IAgentConfig,
): string[] {
  const paths: string[] = [];
  const defaults = agent.getDefaultOutputPath(projectRoot);
  const rootAgentsPath = path.resolve(projectRoot, 'AGENTS.md');
  const authoredInstructions = (candidate: string): boolean =>
    path.resolve(candidate) === rootAgentsPath;

  if (typeof defaults === 'string') {
    // Single output path (most agents)
    const actualPath = agentConfig?.outputPath ?? defaults;
    if (!authoredInstructions(defaults)) paths.push(actualPath);
  } else {
    // Multiple output paths (e.g., AiderAgent)
    const defaultPaths = defaults as Record<string, string>;

    // Handle instructions path
    if (
      'instructions' in defaultPaths &&
      !authoredInstructions(defaultPaths.instructions)
    ) {
      const instructionsPath =
        agentConfig?.outputPathInstructions ?? defaultPaths.instructions;
      paths.push(instructionsPath);
    }

    // Handle config path
    if ('config' in defaultPaths) {
      const configPath = agentConfig?.outputPathConfig ?? defaultPaths.config;
      paths.push(configPath);
    }

    // Handle any other paths in the default paths record
    for (const [key, defaultPath] of Object.entries(defaultPaths)) {
      if (key !== 'instructions' && key !== 'config') {
        // For unknown path types, use the default since we don't have specific config overrides
        paths.push(defaultPath);
      }
    }
  }

  return paths;
}
