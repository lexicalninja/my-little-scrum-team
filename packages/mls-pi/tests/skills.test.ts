import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { SkillLoader } from "../.pi/extensions/mls/skills.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "fixtures", "skills");

describe("SkillLoader", () => {
  it("loads skills from a valid directory", () => {
    const loader = new SkillLoader(fixturesDir);
    loader.load();
    const skills = loader.getLoadedSkills();
    expect(skills).toContain("design-system");
  });

  it("getSkill returns content for loaded skill", () => {
    const loader = new SkillLoader(fixturesDir);
    loader.load();
    const content = loader.getSkill("design-system");
    expect(content).toBeDefined();
    expect(typeof content).toBe("string");
    expect(content!.length).toBeGreaterThan(0);
  });

  it("getSkill returns undefined for unknown skill", () => {
    const loader = new SkillLoader(fixturesDir);
    loader.load();
    expect(loader.getSkill("nonexistent")).toBeUndefined();
  });

  it("getLoadedSkills lists all loaded skill names", () => {
    const loader = new SkillLoader(fixturesDir);
    loader.load();
    const skills = loader.getLoadedSkills();
    expect(Array.isArray(skills)).toBe(true);
    expect(skills.length).toBeGreaterThan(0);
  });

  it("getSkillsForAgent returns formatted section for mls-designer", () => {
    const loader = new SkillLoader(fixturesDir);
    loader.load();
    const result = loader.getSkillsForAgent("mls-designer");
    expect(result).toContain("design-system");
    expect(result.length).toBeGreaterThan(0);
  });

  it("getSkillsForAgent returns empty string for unknown agent", () => {
    const loader = new SkillLoader(fixturesDir);
    loader.load();
    const result = loader.getSkillsForAgent("unknown-agent");
    expect(result).toBe("");
  });

  it("getOrchestratorSkill returns skill content", () => {
    const loader = new SkillLoader(fixturesDir);
    loader.load();
    const result = loader.getOrchestratorSkill("design-system");
    expect(result).toBeDefined();
    expect(typeof result).toBe("string");
  });

  it("does not crash on non-existent directory", () => {
    const loader = new SkillLoader("/tmp/does-not-exist-skills-dir");
    expect(() => loader.load()).not.toThrow();
    expect(loader.getLoadedSkills()).toEqual([]);
  });

  it("load is idempotent", () => {
    const loader = new SkillLoader(fixturesDir);
    loader.load();
    const firstLoad = loader.getLoadedSkills();
    loader.load();
    const secondLoad = loader.getLoadedSkills();
    expect(firstLoad).toEqual(secondLoad);
  });
});
