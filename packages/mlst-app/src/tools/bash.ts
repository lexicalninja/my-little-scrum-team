import { tool } from 'ai';
import { z } from 'zod';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

const DEFAULT_TIMEOUT = 120_000; // 2 minutes
const MAX_TIMEOUT = 600_000; // 10 minutes

export const bashTool = tool({
  description: 'Execute a shell command and return its output. Use for git, npm, build tools, and other CLI operations.',
  parameters: z.object({
    command: z.string().describe('The shell command to execute'),
    timeout: z.number().optional().describe('Timeout in milliseconds (default 120000, max 600000)'),
    cwd: z.string().optional().describe('Working directory for the command'),
  }),
  execute: async ({ command, timeout, cwd }) => {
    const timeoutMs = Math.min(timeout ?? DEFAULT_TIMEOUT, MAX_TIMEOUT);

    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: timeoutMs,
        cwd: cwd ?? process.cwd(),
        maxBuffer: 10 * 1024 * 1024, // 10MB
        env: { ...process.env },
      });

      const output = [stdout, stderr].filter(Boolean).join('\n');
      return output || '(no output)';
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'killed' in err && err.killed) {
        return `Error: Command timed out after ${timeoutMs}ms`;
      }
      const message = err instanceof Error ? err.message : String(err);
      // Include stdout/stderr from failed commands
      const execErr = err as { stdout?: string; stderr?: string };
      const output = [execErr.stdout, execErr.stderr, message].filter(Boolean).join('\n');
      return `Command failed:\n${output}`;
    }
  },
});
