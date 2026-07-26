import type { UserInteraction } from './interface.js';

/** Thrown by MCPInteraction.ask() when user input is needed */
export class ClarificationNeeded extends Error {
  constructor(public readonly question: string) {
    super(`Clarification needed: ${question}`);
    this.name = 'ClarificationNeeded';
  }
}

/**
 * MCP-aware interaction — interrupts on ask() if no pending answer,
 * auto-confirms everything else.
 */
export class MCPInteraction implements UserInteraction {
  private pendingAnswer: string | undefined;

  constructor(pendingAnswer?: string) {
    this.pendingAnswer = pendingAnswer;
  }

  async ask(question: string): Promise<string> {
    if (this.pendingAnswer !== undefined) {
      const answer = this.pendingAnswer;
      this.pendingAnswer = undefined;
      return answer;
    }
    throw new ClarificationNeeded(question);
  }

  async choose(_question: string, options: string[]): Promise<string> {
    return options[0];
  }

  async confirm(_question: string): Promise<boolean> {
    return true;
  }

  display(_message: string): void {}
  close(): void {}
}
