/**
 * Structured logging utility for MLST operations.
 */
import chalk from 'chalk';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

let currentLevel: LogLevel = 'info';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export function setLogLevel(level: LogLevel) {
  currentLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel];
}

export const logger = {
  debug(message: string, ...args: unknown[]) {
    if (shouldLog('debug')) {
      console.error(chalk.gray(`[debug] ${message}`), ...args);
    }
  },

  info(message: string, ...args: unknown[]) {
    if (shouldLog('info')) {
      console.error(chalk.blue(`[info] ${message}`), ...args);
    }
  },

  warn(message: string, ...args: unknown[]) {
    if (shouldLog('warn')) {
      console.error(chalk.yellow(`[warn] ${message}`), ...args);
    }
  },

  error(message: string, ...args: unknown[]) {
    if (shouldLog('error')) {
      console.error(chalk.red(`[error] ${message}`), ...args);
    }
  },

  /** Structured log for agent activity — debug-only to avoid duplicating event output */
  agent(agentName: string, message: string) {
    if (shouldLog('debug')) {
      console.error(chalk.cyan(`  [${agentName}]`) + ` ${message}`);
    }
  },

  /** Phase header — debug-only to avoid duplicating event output */
  phase(name: string, description: string) {
    if (shouldLog('debug')) {
      console.error(chalk.bold.white(`\n[${name}]`) + ` ${description}`);
    }
  },

  /** Quality gate result — debug-only to avoid duplicating event output */
  gate(name: string, passed: boolean, reason?: string) {
    const status = passed ? chalk.green('PASS') : chalk.red('FAIL');
    if (shouldLog('debug')) {
      console.error(`  ${name}: ${status}${reason ? ` — ${reason}` : ''}`);
    }
  },
};
