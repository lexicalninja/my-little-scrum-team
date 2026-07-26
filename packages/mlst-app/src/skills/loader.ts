/**
 * Skill loader — reads SKILL.md files and builds prompt content for agents.
 * Skills are loaded from the markdown directory at startup and cached.
 */
import { readFile, readdir, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMarkdown } from '../utils/markdown-parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface LoadedSkill {
  name: string;
  description: string;
  body: string;
}

let skillCache: Map<string, LoadedSkill> | null = null;

/**
 * Resolves the skills directory.
 *
 * Skills live once at the repo root (`skills/`) and are shared with the Claude
 * Code plugin — this package does not carry its own copy. The candidates below
 * cover running from source and from the compiled output, which sit at
 * different depths relative to that root.
 */
async function getSkillsDir(): Promise<string | null> {
  const fromEnv = process.env.MLST_SKILLS_DIR;
  if (fromEnv) return fromEnv;

  const candidates = [
    // From source: packages/mlst-app/src/skills/ → repo root
    join(__dirname, '..', '..', '..', '..', 'skills'),
    // From dist: packages/mlst-app/dist/src/skills/ → repo root
    join(__dirname, '..', '..', '..', '..', '..', 'skills'),
  ];

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Not this one — try the next.
    }
  }

  return null;
}

export async function loadAllSkills(skillsDir?: string): Promise<Map<string, LoadedSkill>> {
  if (skillCache) return skillCache;

  const dir = skillsDir ?? (await getSkillsDir());
  if (dir === null) {
    skillCache = new Map();
    return skillCache;
  }
  const skills = new Map<string, LoadedSkill>();

  try {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillFile = join(dir, entry.name, 'SKILL.md');
      try {
        await access(skillFile);
        const content = await readFile(skillFile, 'utf-8');
        const { frontmatter, body } = parseMarkdown(content);

        skills.set(entry.name, {
          name: (frontmatter.name as string) ?? entry.name,
          description: (frontmatter.description as string) ?? '',
          body,
        });
      } catch {
        // Skill directory exists but no SKILL.md — skip
      }
    }
  } catch {
    // Skills directory doesn't exist — no skills loaded
  }

  skillCache = skills;
  return skills;
}

/**
 * Get concatenated skill content for an agent's assigned skills.
 */
export async function getSkillContentForAgent(skillNames: string[], skillsDir?: string): Promise<string> {
  const allSkills = await loadAllSkills(skillsDir);
  const sections: string[] = [];

  for (const name of skillNames) {
    const skill = allSkills.get(name);
    if (skill) {
      sections.push(`### Skill: ${skill.name}\n\n${skill.body}`);
    }
  }

  return sections.length > 0
    ? `## Available Skills\n\n${sections.join('\n\n---\n\n')}`
    : '';
}

/** Clear the skill cache (for testing) */
export function clearSkillCache() {
  skillCache = null;
}
