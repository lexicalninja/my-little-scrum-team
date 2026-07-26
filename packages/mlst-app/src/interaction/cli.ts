/**
 * CLI interaction implementation using readline.
 */
import { createInterface, type Interface } from 'node:readline';
import chalk from 'chalk';
import type { UserInteraction } from './interface.js';

export class CLIInteraction implements UserInteraction {
  private rl: Interface;

  constructor() {
    this.rl = createInterface({
      input: process.stdin,
      output: process.stderr, // Use stderr so stdout stays clean for piping
    });
  }

  async ask(question: string): Promise<string> {
    return new Promise((resolve) => {
      this.rl.question(chalk.yellow(`  ? ${question}\n  > `), (answer) => {
        resolve(answer.trim());
      });
    });
  }

  async choose(question: string, options: string[]): Promise<string> {
    const optionList = options.map((opt, i) => `    ${i + 1}. ${opt}`).join('\n');
    const prompt = `${question}\n${optionList}`;

    return new Promise((resolve) => {
      this.rl.question(chalk.yellow(`  ? ${prompt}\n  > `), (answer) => {
        const trimmed = answer.trim();
        // Accept number or text
        const num = parseInt(trimmed, 10);
        if (num >= 1 && num <= options.length) {
          resolve(options[num - 1]);
        } else {
          // Try matching by text
          const match = options.find(
            (opt) => opt.toLowerCase() === trimmed.toLowerCase()
          );
          resolve(match ?? trimmed);
        }
      });
    });
  }

  async confirm(question: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.rl.question(chalk.yellow(`  ? ${question} (y/n) > `), (answer) => {
        resolve(answer.trim().toLowerCase().startsWith('y'));
      });
    });
  }

  display(message: string): void {
    console.error(message);
  }

  close(): void {
    this.rl.close();
  }
}

/**
 * Non-interactive interaction — auto-accepts all prompts.
 * Used with --yes flag or when stdin is not a TTY.
 */
export class AutoInteraction implements UserInteraction {
  async ask(question: string): Promise<string> {
    console.error(chalk.gray(`  ? ${question}`));
    console.error(chalk.gray(`  > (auto-accepted)`));
    return '';
  }

  async choose(_question: string, options: string[]): Promise<string> {
    console.error(chalk.gray(`  ? ${_question}`));
    console.error(chalk.gray(`  > (auto-selected: ${options[0]})`));
    return options[0];
  }

  async confirm(question: string): Promise<boolean> {
    console.error(chalk.gray(`  ? ${question} (auto: yes)`));
    return true;
  }

  display(message: string): void {
    console.error(message);
  }

  close(): void {
    // Nothing to close
  }
}
