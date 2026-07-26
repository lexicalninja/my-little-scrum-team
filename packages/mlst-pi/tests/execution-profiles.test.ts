import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  CLOUD_PROFILE,
  LOCAL_PROFILE,
  resolveExecutionProfile,
} from "../.pi/extensions/mlst/execution-profiles.js";

describe("resolveExecutionProfile", () => {
  let tmpDir: string | null = null;

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = null;
    }
  });

  it("returns cloud profile by default", () => {
    const profile = resolveExecutionProfile("/tmp/nonexistent");
    expect(profile.name).toBe("cloud");
    expect(profile.group1Concurrency).toBe(CLOUD_PROFILE.group1Concurrency);
    expect(profile.enablePhase0).toBe(true);
    expect(profile.enableReviewGate).toBe(true);
  });

  it("returns local profile for ollama provider", () => {
    const profile = resolveExecutionProfile("/tmp/nonexistent", "ollama");
    expect(profile.name).toBe("local");
    expect(profile.group1Concurrency).toBe(1);
    expect(profile.enablePhase0).toBe(false);
    expect(profile.sequentialGroup1).toBe(true);
  });

  it("returns local profile for lmstudio provider", () => {
    const profile = resolveExecutionProfile("/tmp/nonexistent", "lmstudio");
    expect(profile.name).toBe("local");
  });

  it("returns cloud profile for anthropic provider", () => {
    const profile = resolveExecutionProfile("/tmp/nonexistent", "anthropic");
    expect(profile.name).toBe("cloud");
  });

  it("returns local profile when config.json has mode: local", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mlst-test-"));
    const mlstDir = path.join(tmpDir, ".mlst");
    fs.mkdirSync(mlstDir, { recursive: true });
    fs.writeFileSync(
      path.join(mlstDir, "config.json"),
      JSON.stringify({ mode: "local" }),
    );

    const profile = resolveExecutionProfile(tmpDir);
    expect(profile.name).toBe("local");
    expect(profile.enablePhase0).toBe(false);
  });

  it("applies granular executionProfile overrides from config", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mlst-test-"));
    const mlstDir = path.join(tmpDir, ".mlst");
    fs.mkdirSync(mlstDir, { recursive: true });
    fs.writeFileSync(
      path.join(mlstDir, "config.json"),
      JSON.stringify({
        executionProfile: {
          name: "custom-fast",
          maxReviewIterations: 1,
          enablePhase0: false,
        },
      }),
    );

    const profile = resolveExecutionProfile(tmpDir);
    expect(profile.name).toBe("custom-fast");
    expect(profile.maxReviewIterations).toBe(1);
    expect(profile.enablePhase0).toBe(false);
    // Non-overridden values inherit from cloud
    expect(profile.group1Concurrency).toBe(CLOUD_PROFILE.group1Concurrency);
  });

  it("uses 'custom' name when executionProfile omits name", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mlst-test-"));
    const mlstDir = path.join(tmpDir, ".mlst");
    fs.mkdirSync(mlstDir, { recursive: true });
    fs.writeFileSync(
      path.join(mlstDir, "config.json"),
      JSON.stringify({ executionProfile: { maxTestRetries: 5 } }),
    );

    const profile = resolveExecutionProfile(tmpDir);
    expect(profile.name).toBe("custom");
    expect(profile.maxTestRetries).toBe(5);
  });

  it("falls through on malformed config", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mlst-test-"));
    const mlstDir = path.join(tmpDir, ".mlst");
    fs.mkdirSync(mlstDir, { recursive: true });
    fs.writeFileSync(path.join(mlstDir, "config.json"), "NOT JSON");

    const profile = resolveExecutionProfile(tmpDir);
    expect(profile.name).toBe("cloud");
  });

  it("provider auto-detection takes precedence over config", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mlst-test-"));
    const mlstDir = path.join(tmpDir, ".mlst");
    fs.mkdirSync(mlstDir, { recursive: true });
    fs.writeFileSync(
      path.join(mlstDir, "config.json"),
      JSON.stringify({ executionProfile: { name: "custom" } }),
    );

    // ollama provider → local, even though config has custom overrides
    const profile = resolveExecutionProfile(tmpDir, "ollama");
    expect(profile.name).toBe("local");
  });
});

describe("profile constants", () => {
  it("CLOUD_PROFILE has expected defaults", () => {
    expect(CLOUD_PROFILE.name).toBe("cloud");
    expect(CLOUD_PROFILE.group1Concurrency).toBe(4);
    expect(CLOUD_PROFILE.group2Concurrency).toBe(2);
    expect(CLOUD_PROFILE.maxReviewIterations).toBe(3);
    expect(CLOUD_PROFILE.enablePhase0).toBe(true);
    expect(CLOUD_PROFILE.enableSpecGate).toBe(true);
    expect(CLOUD_PROFILE.enableReviewGate).toBe(true);
    expect(CLOUD_PROFILE.sequentialGroup1).toBe(false);
    expect(CLOUD_PROFILE.skipAgentsMdExtraction).toBe(false);
  });

  it("LOCAL_PROFILE has expected defaults", () => {
    expect(LOCAL_PROFILE.name).toBe("local");
    expect(LOCAL_PROFILE.group1Concurrency).toBe(1);
    expect(LOCAL_PROFILE.group2Concurrency).toBe(1);
    expect(LOCAL_PROFILE.maxReviewIterations).toBe(1);
    expect(LOCAL_PROFILE.enablePhase0).toBe(false);
    expect(LOCAL_PROFILE.enableSpecGate).toBe(false);
    expect(LOCAL_PROFILE.enableReviewGate).toBe(false);
    expect(LOCAL_PROFILE.sequentialGroup1).toBe(true);
    expect(LOCAL_PROFILE.skipAgentsMdExtraction).toBe(true);
  });
});
