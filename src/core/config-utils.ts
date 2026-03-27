import { IAgent, IAgentConfig } from '../agents/IAgent';
import { createSkillerError } from '../constants';

/**
 * Maps raw agent configuration keys to their corresponding agent identifiers.
 *
 * This function validates that raw configuration keys are already exact canonical
 * agent identifiers. Any unknown or legacy keys fail hard.
 *
 * @param raw Raw agent configurations with user-provided keys
 * @param agents Array of all available agents
 * @returns Record with agent identifiers as keys and their configurations as values
 */
export function mapRawAgentConfigs(
  raw: Record<string, IAgentConfig>,
  agents: IAgent[],
): Record<string, IAgentConfig> {
  const mappedConfigs: Record<string, IAgentConfig> = {};
  const validAgentIdentifiers = new Set(
    agents.map((agent) => agent.getIdentifier()),
  );
  const invalidKeys: string[] = [];

  for (const [key, cfg] of Object.entries(raw)) {
    if (!validAgentIdentifiers.has(key)) {
      invalidKeys.push(key);
      continue;
    }

    mappedConfigs[key] = cfg;
  }

  if (invalidKeys.length > 0) {
    throw createSkillerError(
      `Invalid agent config section: ${invalidKeys.join(', ')}`,
      `Valid agents are: ${[...validAgentIdentifiers].join(', ')}`,
    );
  }

  return mappedConfigs;
}
