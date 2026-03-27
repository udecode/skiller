import { IAgent } from '../agents/IAgent';
import { LoadedConfig } from './ConfigLoader';
import { createSkillerError } from '../constants';

/**
 * Resolves which agents should be selected based on configuration.
 * Handles precedence: CLI agents > default_agents > per-agent enabled flags > all agents
 *
 * @param config Loaded configuration containing CLI agents, default agents, and per-agent configs
 * @param allAgents Array of all available agents
 * @returns Array of agents that should be processed
 */
export function resolveSelectedAgents(
  config: LoadedConfig,
  allAgents: IAgent[],
): IAgent[] {
  // CLI --agents > config.default_agents > per-agent.enabled flags > default all
  let selected = allAgents;
  const validAgentIdentifiers = new Set(
    allAgents.map((agent) => agent.getIdentifier()),
  );
  const validAgentsText = [...validAgentIdentifiers].join(', ');

  if (config.cliAgents && config.cliAgents.length > 0) {
    const invalidAgents = config.cliAgents.filter(
      (agentId) => !validAgentIdentifiers.has(agentId),
    );

    if (invalidAgents.length > 0) {
      throw createSkillerError(
        `Invalid agent specified: ${invalidAgents.join(', ')}`,
        `Valid agents are: ${validAgentsText}`,
      );
    }

    selected = allAgents.filter((agent) =>
      config.cliAgents?.includes(agent.getIdentifier()),
    );
  } else if (config.defaultAgents && config.defaultAgents.length > 0) {
    const invalidAgents = config.defaultAgents.filter(
      (agentId) => !validAgentIdentifiers.has(agentId),
    );

    if (invalidAgents.length > 0) {
      throw createSkillerError(
        `Invalid agent specified in default_agents: ${invalidAgents.join(', ')}`,
        `Valid agents are: ${validAgentsText}`,
      );
    }

    selected = allAgents.filter((agent) => {
      const identifier = agent.getIdentifier();
      const override = config.agentConfigs[identifier]?.enabled;
      if (override !== undefined) {
        return override;
      }
      return config.defaultAgents?.includes(identifier) ?? false;
    });
  } else {
    selected = allAgents.filter(
      (agent) => config.agentConfigs[agent.getIdentifier()]?.enabled !== false,
    );
  }

  return selected;
}
