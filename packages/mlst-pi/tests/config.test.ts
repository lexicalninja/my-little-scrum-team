import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  loadConfigFile,
  loadProjectConfig,
  mergeConfigs,
  type ProjectConfig,
} from "../.pi/extensions/mlst/config.js";

describe("loadConfigFile", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mlst-config-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty object when file does not exist", () => {
    const result = loadConfigFile(path.join(tmpDir, "nope.json"));
    expect(result).toEqual({});
  });

  it("returns empty object for invalid JSON", () => {
    const filePath = path.join(tmpDir, "bad.json");
    fs.writeFileSync(filePath, "not json{{{", "utf-8");
    expect(loadConfigFile(filePath)).toEqual({});
  });

  it("returns empty object for non-object JSON", () => {
    const filePath = path.join(tmpDir, "array.json");
    fs.writeFileSync(filePath, '"just a string"', "utf-8");
    expect(loadConfigFile(filePath)).toEqual({});
  });

  it("parses a valid config file", () => {
    const filePath = path.join(tmpDir, "config.json");
    const config = { models: { default: "anthropic/claude-sonnet-4-20250514" } };
    fs.writeFileSync(filePath, JSON.stringify(config), "utf-8");
    expect(loadConfigFile(filePath)).toEqual(config);
  });
});

describe("mergeConfigs", () => {
  it("returns empty object when both are empty", () => {
    expect(mergeConfigs({}, {})).toEqual({});
  });

  it("returns global when project is empty", () => {
    const global: ProjectConfig = { mode: "fast", models: { default: "a/b" } };
    expect(mergeConfigs(global, {})).toEqual(global);
  });

  it("returns project when global is empty", () => {
    const project: ProjectConfig = { mode: "careful", models: { coding: "x/y" } };
    expect(mergeConfigs({}, project)).toEqual(project);
  });

  it("project scalars override global scalars", () => {
    const global: ProjectConfig = { mode: "fast" };
    const project: ProjectConfig = { mode: "careful" };
    expect(mergeConfigs(global, project)).toEqual({ mode: "careful" });
  });

  it("merges models key-by-key with project winning", () => {
    const global: ProjectConfig = {
      models: { default: "a/default", coding: "a/coding", planning: "a/planning" },
    };
    const project: ProjectConfig = {
      models: { coding: "b/coding", review: "b/review" },
    };

    const result = mergeConfigs(global, project);
    expect(result.models).toEqual({
      default: "a/default",
      coding: "b/coding",
      planning: "a/planning",
      review: "b/review",
    });
  });

  it("merges models.agents key-by-key", () => {
    const global: ProjectConfig = {
      models: {
        agents: { "mlst-designer": "a/designer", "mlst-spec-writer": "a/spec" },
      },
    };
    const project: ProjectConfig = {
      models: {
        agents: { "mlst-designer": "b/designer", "mlst-code-reviewer": "b/reviewer" },
      },
    };

    const result = mergeConfigs(global, project);
    expect(result.models?.agents).toEqual({
      "mlst-designer": "b/designer",
      "mlst-spec-writer": "a/spec",
      "mlst-code-reviewer": "b/reviewer",
    });
  });

  it("merges providers with nested per-provider merge", () => {
    const global: ProjectConfig = {
      providers: {
        anthropic: { concurrency: 5, spawnDelayMs: 100 },
        openai: { concurrency: 3 },
      },
    };
    const project: ProjectConfig = {
      providers: {
        anthropic: { spawnDelayMs: 200 },
        google: { concurrency: 2 },
      },
    };

    const result = mergeConfigs(global, project);
    expect(result.providers).toEqual({
      anthropic: { concurrency: 5, spawnDelayMs: 200 },
      openai: { concurrency: 3 },
      google: { concurrency: 2 },
    });
  });

  it("merges executionProfile key-by-key", () => {
    const global: ProjectConfig = {
      executionProfile: { name: "default", maxConcurrentAgents: 3 },
    };
    const project: ProjectConfig = {
      executionProfile: { maxConcurrentAgents: 1 },
    };

    const result = mergeConfigs(global, project);
    expect(result.executionProfile).toEqual({
      name: "default",
      maxConcurrentAgents: 1,
    });
  });
});

describe("loadProjectConfig", () => {
  let tmpDir: string;
  let fakeHome: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mlst-load-"));
    fakeHome = path.join(tmpDir, "home");
    fs.mkdirSync(fakeHome, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty object when neither global nor project config exists", () => {
    const cwd = path.join(tmpDir, "project");
    fs.mkdirSync(cwd, { recursive: true });
    expect(loadProjectConfig(cwd, fakeHome)).toEqual({});
  });

  it("loads global config when only global exists", () => {
    const cwd = path.join(tmpDir, "project");
    fs.mkdirSync(cwd, { recursive: true });

    const globalDir = path.join(fakeHome, ".mlst");
    fs.mkdirSync(globalDir, { recursive: true });
    fs.writeFileSync(
      path.join(globalDir, "config.json"),
      JSON.stringify({ models: { default: "a/global" } }),
    );

    expect(loadProjectConfig(cwd, fakeHome)).toEqual({ models: { default: "a/global" } });
  });

  it("loads project config when only project exists", () => {
    const cwd = path.join(tmpDir, "project");
    const mlstDir = path.join(cwd, ".mlst");
    fs.mkdirSync(mlstDir, { recursive: true });
    fs.writeFileSync(
      path.join(mlstDir, "config.json"),
      JSON.stringify({ models: { coding: "b/project" } }),
    );

    expect(loadProjectConfig(cwd, fakeHome)).toEqual({ models: { coding: "b/project" } });
  });

  it("merges global and project configs with project taking precedence", () => {
    const cwd = path.join(tmpDir, "project");
    const projectMlst = path.join(cwd, ".mlst");
    const globalMlst = path.join(fakeHome, ".mlst");

    fs.mkdirSync(projectMlst, { recursive: true });
    fs.mkdirSync(globalMlst, { recursive: true });

    fs.writeFileSync(
      path.join(globalMlst, "config.json"),
      JSON.stringify({
        mode: "fast",
        models: { default: "a/global", coding: "a/global-coding" },
      }),
    );

    fs.writeFileSync(
      path.join(projectMlst, "config.json"),
      JSON.stringify({
        models: { coding: "b/project-coding", review: "b/project-review" },
      }),
    );

    const result = loadProjectConfig(cwd, fakeHome);
    expect(result.mode).toBe("fast");
    expect(result.models).toEqual({
      default: "a/global",
      coding: "b/project-coding",
      review: "b/project-review",
    });
  });
});
