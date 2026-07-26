/**
 * Parse YAML frontmatter + body from markdown files.
 * Used for loading agent definitions and skill files.
 */
import matter from 'gray-matter';
import { readFile } from 'node:fs/promises';

export interface ParsedMarkdown {
  frontmatter: Record<string, unknown>;
  body: string;
}

export function parseMarkdown(content: string): ParsedMarkdown {
  const { data, content: body } = matter(content);
  return { frontmatter: data, body: body.trim() };
}

export async function parseMarkdownFile(filePath: string): Promise<ParsedMarkdown> {
  const content = await readFile(filePath, 'utf-8');
  return parseMarkdown(content);
}
