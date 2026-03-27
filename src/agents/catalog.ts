import * as path from 'path';
import { createSkillerError } from '../constants';
import {
  SKILLS_AGENT_CATALOG,
  type SkillsAgentIdentifier,
} from '../generated/skills-agent-catalog';

export const PUBLIC_AGENT_IDENTIFIERS = [
  'amp',
  'augment',
  'claude-code',
  'cline',
  'codex',
  'crush',
  'cursor',
  'gemini-cli',
  'github-copilot',
  'goose',
  'junie',
  'kilo',
  'kiro-cli',
  'opencode',
  'openhands',
  'qwen-code',
  'roo',
  'trae',
  'warp',
  'windsurf',
] as const satisfies readonly SkillsAgentIdentifier[];

export type PublicAgentIdentifier = (typeof PUBLIC_AGENT_IDENTIFIERS)[number];

export function getSkillsCatalogEntry(
  agentId: string,
): (typeof SKILLS_AGENT_CATALOG)[SkillsAgentIdentifier] {
  const entry = SKILLS_AGENT_CATALOG[agentId as SkillsAgentIdentifier];
  if (!entry) {
    throw createSkillerError(
      `Unknown canonical skills agent: ${agentId}`,
      `Known agents: ${Object.keys(SKILLS_AGENT_CATALOG).join(', ')}`,
    );
  }
  return entry;
}

export function getAgentDisplayName(agentId: string): string {
  return getSkillsCatalogEntry(agentId).displayName;
}

export function getAgentSkillsPath(
  agentId: string,
  projectRoot: string,
): string {
  return path.join(projectRoot, getSkillsCatalogEntry(agentId).skillsDir);
}

export function getAgentIdentifiersForCliHelp(): string {
  return [...PUBLIC_AGENT_IDENTIFIERS].join(', ');
}
