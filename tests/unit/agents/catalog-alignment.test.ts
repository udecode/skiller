import { allAgents } from '../../../src/agents';
import {
  SKILLS_AGENT_CATALOG,
  SKILLS_PACKAGE_VERSION,
  type SkillsAgentIdentifier,
} from '../../../src/generated/skills-agent-catalog';

describe('public agent catalog alignment', () => {
  it('tracks the pinned skills package version in the generated snapshot', () => {
    expect(SKILLS_PACKAGE_VERSION).toBe('1.4.6');
  });

  it('contains no duplicate public agent identifiers', () => {
    const identifiers = allAgents.map((agent) => agent.getIdentifier());
    expect(new Set(identifiers).size).toBe(identifiers.length);
  });

  it('only exposes public agents that exist in the canonical skills catalog', () => {
    for (const agent of allAgents) {
      expect(
        SKILLS_AGENT_CATALOG[agent.getIdentifier() as SkillsAgentIdentifier],
      ).toBeDefined();
    }
  });

  it('uses canonical display names for public agents', () => {
    for (const agent of allAgents) {
      const catalogEntry =
        SKILLS_AGENT_CATALOG[agent.getIdentifier() as SkillsAgentIdentifier];
      expect(agent.getName()).toBe(catalogEntry.displayName);
    }
  });

  it('uses canonical skills paths for public agents with native skills', () => {
    const projectRoot = '/test/project';

    for (const agent of allAgents) {
      if (!agent.supportsNativeSkills?.()) continue;

      const catalogEntry =
        SKILLS_AGENT_CATALOG[agent.getIdentifier() as SkillsAgentIdentifier];
      expect(agent.getSkillsPath?.(projectRoot)).toBe(
        `${projectRoot}/${catalogEntry.skillsDir}`,
      );
    }
  });
});
