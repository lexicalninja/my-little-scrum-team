import { tool } from 'ai';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';

export const readFileTool = tool({
  description: 'Read a file from the filesystem. Returns the file contents with line numbers.',
  parameters: z.object({
    file_path: z.string().describe('Absolute path to the file to read'),
    offset: z.number().optional().describe('Line number to start reading from (1-based)'),
    limit: z.number().optional().describe('Maximum number of lines to read'),
  }),
  execute: async ({ file_path, offset, limit }) => {
    try {
      const content = await readFile(file_path, 'utf-8');
      let lines = content.split('\n');

      if (offset !== undefined && offset > 0) {
        lines = lines.slice(offset - 1);
      }
      if (limit !== undefined && limit > 0) {
        lines = lines.slice(0, limit);
      }

      const startLine = offset ?? 1;
      const numbered = lines.map((line, i) => `${startLine + i}\t${line}`).join('\n');
      return numbered;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return `Error reading file: ${message}`;
    }
  },
});
