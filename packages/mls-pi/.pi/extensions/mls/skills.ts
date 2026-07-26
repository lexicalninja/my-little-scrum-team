/**
 * MLS Pi Extension — Skill Loader
 *
 * Reads SKILL.md files from the skills/ directory and provides them
 * for injection into agent system prompts at spawn time.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { AGENT_SKILLS } from "./types.js";

/**
 * Lazy-loads SKILL.md files from a directory of named subdirectories and provides them
 * for injection into agent system prompts at spawn time.
 *
 * Each skill lives at `<skillsDir>/<name>/SKILL.md`. Skills are cached after the first
 * load; subsequent calls to any method are served from cache.
 *
 * Construction does NOT load skills. Call {@link load} explicitly, or let it be called
 * lazily on the first access via any other public method.
 */
export class SkillLoader {
  private cache = new Map<string, string>();
  private skillsDir: string;
  private loaded = false;

  /**
   * @param skillsDir - Absolute path to the directory containing skill subdirectories.
   *   If the directory does not exist, all lookups will return empty results.
   */
  constructor(skillsDir: string) {
    this.skillsDir = skillsDir;
  }

  /**
   * Discover and cache all `SKILL.md` files found in immediate subdirectories of `skillsDir`.
   * Idempotent: subsequent calls after the first are no-ops.
   * Silently skips missing, unreadable, or non-directory entries.
   */
  load(): void {
    if (this.loaded) return;

    if (!fs.existsSync(this.skillsDir)) {
      this.loaded = true;
      return;
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(this.skillsDir, { withFileTypes: true });
    } catch {
      this.loaded = true;
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillPath = path.join(this.skillsDir, entry.name, "SKILL.md");
      if (!fs.existsSync(skillPath)) continue;

      try {
        const content = fs.readFileSync(skillPath, "utf-8");
        this.cache.set(entry.name, content);
      } catch {
        // Skip unreadable skills
      }
    }

    this.loaded = true;
  }

  /**
   * Return the raw Markdown content of a skill by its directory name.
   *
   * @param skillName - Directory name under `skillsDir` (e.g., `"design-system"`).
   * @returns The SKILL.md content, or `undefined` if the skill was not found or failed to load.
   */
  getSkill(skillName: string): string | undefined {
    this.load();
    return this.cache.get(skillName);
  }

  /**
   * Return the names of all skills that were successfully loaded from disk.
   *
   * @returns Array of skill directory names (e.g., `["design-system"]`).
   */
  getLoadedSkills(): string[] {
    this.load();
    return Array.from(this.cache.keys());
  }

  /**
   * Build the combined skill section to append to an agent's system prompt at spawn time.
   *
   * Looks up `AGENT_SKILLS[agentName]` to find the skill names configured for this agent,
   * then concatenates their content into a `## Skill Instructions` section.
   *
   * @param agentName - The agent's `name` field (e.g., `"mls-designer"`).
   * @returns A formatted Markdown string with all matching skill contents, or an empty string
   *   if no skills are configured for this agent or none of the configured skills were loaded.
   */
  getSkillsForAgent(agentName: string): string {
    this.load();

    const skillNames = AGENT_SKILLS[agentName];
    if (!skillNames || skillNames.length === 0) return "";

    const sections: string[] = [];

    for (const name of skillNames) {
      const content = this.cache.get(name);
      if (content) {
        sections.push(`### Skill: ${name}\n\n${content}`);
      }
    }

    if (sections.length === 0) return "";

    return `\n\n## Skill Instructions\n\nThe following skills provide detailed guidance for specific tasks. Use them as reference when performing the described activities.\n\n${sections.join("\n\n---\n\n")}`;
  }

  /**
   * Return the content of a single skill for direct use in orchestrator LLM calls
   * (as opposed to agent spawn injection).
   *
   * Unlike {@link getSkill}, this always returns a string (empty string when the skill is
   * missing), so callers can safely pass the result directly to {@link LlmClient.call}.
   *
   * @param skillName - Directory name under `skillsDir`.
   * @returns The SKILL.md content, or an empty string if not found.
   */
  getOrchestratorSkill(skillName: string): string {
    this.load();
    return this.cache.get(skillName) ?? "";
  }
}
