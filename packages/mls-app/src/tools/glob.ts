import { tool } from 'ai';
import { z } from 'zod';
import { glob as globFn } from 'glob';

export const globTool = tool({
  description: 'Find files matching a glob pattern. Returns matching file paths sorted by modification time.',
  parameters: z.object({
    pattern: z.string().describe('Glob pattern to match (e.g., "**/*.ts", "src/**/*.tsx")'),
    path: z.string().optional().describe('Directory to search in (defaults to cwd)'),
  }),
  execute: async ({ pattern, path }) => {
    try {
      const cwd = path ?? process.cwd();
      const matches = await globFn(pattern, {
        cwd,
        absolute: true,
        nodir: true,
        dot: false,
        ignore: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
      });

      if (matches.length === 0) {
        return 'No files matched the pattern.';
      }

      return matches.join('\n');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return `Error searching files: ${message}`;
    }
  },
});
