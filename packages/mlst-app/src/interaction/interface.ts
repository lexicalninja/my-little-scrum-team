/**
 * Abstract user interaction interface.
 * Enables CLI (readline) and future MCP/webhook implementations.
 */

export interface UserInteraction {
  /** Ask the user a question and wait for their response */
  ask(question: string): Promise<string>;

  /** Ask the user to choose from options */
  choose(question: string, options: string[]): Promise<string>;

  /** Ask for confirmation (yes/no) */
  confirm(question: string): Promise<boolean>;

  /** Display information to the user (non-blocking) */
  display(message: string): void;

  /** Clean up resources */
  close(): void;
}
