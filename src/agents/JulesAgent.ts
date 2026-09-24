import { AgentsMdAgent } from './AgentsMdAgent';

export class JulesAgent extends AgentsMdAgent {
  getIdentifier(): string {
    return 'jules';
  }
  getName(): string {
    return 'Jules';
  }
}
