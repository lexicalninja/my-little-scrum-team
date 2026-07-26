import { tool } from 'ai';
import { z } from 'zod';
import { readFile, writeFile } from 'node:fs/promises';

export const editFileTool = tool({
  description: 'Edit a file by replacing an exact string match with new content. The old_string must appear exactly once in the file (unless replace_all is true).',
  parameters: z.object({
    file_path: z.string().describe('Absolute path to the file to edit'),
    old_string: z.string().describe('The exact text to find and replace'),
    new_string: z.string().describe('The replacement text'),
    replace_all: z.boolean().optional().default(false).describe('Replace all occurrences instead of just the first'),
  }),
  execute: async ({ file_path, old_string, new_string, replace_all }) => {
    try {
      const content = await readFile(file_path, 'utf-8');

      if (!content.includes(old_string)) {
        return `Error: old_string not found in ${file_path}`;
      }

      if (!replace_all) {
        const count = content.split(old_string).length - 1;
        if (count > 1) {
          return `Error: old_string found ${count} times in ${file_path}. Use replace_all=true or provide more context to make it unique.`;
        }
      }

      const updated = replace_all
        ? content.replaceAll(old_string, new_string)
        : content.replace(old_string, new_string);

      await writeFile(file_path, updated, 'utf-8');
      return `File edited successfully: ${file_path}`;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return `Error editing file: ${message}`;
    }
  },
});
