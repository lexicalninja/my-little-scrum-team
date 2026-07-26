import { tool } from 'ai';
import { z } from 'zod';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export const grepTool = tool({
  description: 'Search file contents using ripgrep (rg). Supports regex patterns and file type filters.',
  parameters: z.object({
    pattern: z.string().describe('Regex pattern to search for'),
    path: z.string().optional().describe('File or directory to search in (defaults to cwd)'),
    glob: z.string().optional().describe('Glob to filter files (e.g., "*.ts", "*.{ts,tsx}")'),
    context: z.number().optional().describe('Number of context lines before and after each match'),
    case_insensitive: z.boolean().optional().default(false).describe('Case-insensitive search'),
    files_only: z.boolean().optional().default(false).describe('Only show file paths, not matching lines'),
  }),
  execute: async ({ pattern, path, glob: fileGlob, context, case_insensitive, files_only }) => {
    const searchPath = path ?? process.cwd();
    const args: string[] = ['rg', '--no-heading'];

    if (files_only) args.push('-l');
    if (case_insensitive) args.push('-i');
    if (context !== undefined) args.push(`-C${context}`);
    if (fileGlob) args.push(`--glob=${fileGlob}`);
    args.push('--', pattern, searchPath);

    try {
      const { stdout } = await execAsync(args.join(' '), {
        timeout: 30_000,
        maxBuffer: 10 * 1024 * 1024,
      });
      return stdout.trim() || 'No matches found.';
    } catch (err: unknown) {
      const execErr = err as { code?: number; stdout?: string };
      // rg exits with code 1 when no matches found
      if (execErr.code === 1) {
        return 'No matches found.';
      }
      const message = err instanceof Error ? err.message : String(err);
      return `Error searching: ${message}`;
    }
  },
});
