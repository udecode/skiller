import { IAgent } from './IAgent';
import { AbstractAgent } from './AbstractAgent';
import { CopilotAgent } from './CopilotAgent';
import { ClaudeAgent } from './ClaudeAgent';
import { CodexCliAgent } from './CodexCliAgent';
import { CursorAgent } from './CursorAgent';
import { WindsurfAgent } from './WindsurfAgent';
import { ClineAgent } from './ClineAgent';
import { OpenHandsAgent } from './OpenHandsAgent';
import { GeminiCliAgent } from './GeminiCliAgent';
import { JunieAgent } from './JunieAgent';
import { AugmentCodeAgent } from './AugmentCodeAgent';
import { KiloCodeAgent } from './KiloCodeAgent';
import { OpenCodeAgent } from './OpenCodeAgent';
import { CrushAgent } from './CrushAgent';
import { GooseAgent } from './GooseAgent';
import { AmpAgent } from './AmpAgent';
import { QwenCodeAgent } from './QwenCodeAgent';
import { KiroAgent } from './KiroAgent';
import { WarpAgent } from './WarpAgent';
import { RooCodeAgent } from './RooCodeAgent';
import { TraeAgent } from './TraeAgent';
import {
  PUBLIC_AGENT_IDENTIFIERS,
  type PublicAgentIdentifier,
  getAgentIdentifiersForCliHelp as getCatalogAgentIdentifiersForCliHelp,
} from './catalog';

export { AbstractAgent };

const publicAgentFactories: Record<PublicAgentIdentifier, () => IAgent> = {
  amp: () => new AmpAgent(),
  augment: () => new AugmentCodeAgent(),
  'claude-code': () => new ClaudeAgent(),
  cline: () => new ClineAgent(),
  codex: () => new CodexCliAgent(),
  crush: () => new CrushAgent(),
  cursor: () => new CursorAgent(),
  'gemini-cli': () => new GeminiCliAgent(),
  'github-copilot': () => new CopilotAgent(),
  goose: () => new GooseAgent(),
  junie: () => new JunieAgent(),
  kilo: () => new KiloCodeAgent(),
  'kiro-cli': () => new KiroAgent(),
  opencode: () => new OpenCodeAgent(),
  openhands: () => new OpenHandsAgent(),
  'qwen-code': () => new QwenCodeAgent(),
  roo: () => new RooCodeAgent(),
  trae: () => new TraeAgent(),
  warp: () => new WarpAgent(),
  windsurf: () => new WindsurfAgent(),
};

export const allAgents: IAgent[] = PUBLIC_AGENT_IDENTIFIERS.map((agentId) =>
  publicAgentFactories[agentId](),
);

/**
 * Generates a comma-separated list of agent identifiers for CLI help text.
 */
export function getAgentIdentifiersForCliHelp(): string {
  return getCatalogAgentIdentifiersForCliHelp();
}
