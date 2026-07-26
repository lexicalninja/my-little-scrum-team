import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";
import {
  loadAgents,
  loadProviderProfile,
  rateThrottle,
  formatUsage,
} from "../.pi/extensions/mls/agents.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "fixtures", "agents");

describe("loadAgents", () => {
  it("parses a valid agent with all fields", () => {
    const agents = loadAgents(fixturesDir);
    const agent = agents.find((a) => a.name === "mls-test-agent");
    expect(agent).toBeDefined();
    expect(agent!.description).toBeDefined();
    expect(agent!.tools).toEqual(["read", "write", "bash"]);
    expect(agent!.model).toBe("test-model");
    expect(agent!.systemPrompt).toBeTruthy();
    expect(agent!.filePath).toContain("valid-agent.md");
  });

  it("skips agents with missing name", () => {
    const agents = loadAgents(fixturesDir);
    const noName = agents.find((a) =>
      a.filePath?.includes("no-name.md"),
    );
    expect(noName).toBeUndefined();
  });

  it("skips files with no frontmatter", () => {
    const agents = loadAgents(fixturesDir);
    const noFm = agents.find((a) =>
      a.filePath?.includes("no-frontmatter.md"),
    );
    expect(noFm).toBeUndefined();
  });

  it("returns empty array for non-existent directory", () => {
    const agents = loadAgents("/tmp/does-not-exist-agents-dir");
    expect(agents).toEqual([]);
  });

  it("applies config-driven model overrides when provided", () => {
    const agents = loadAgents(fixturesDir, {
      parentModel: "openai/gpt-4o-mini",
      models: {
        agents: {
          "mls-test-agent": "openai/o3-mini",
        },
      },
    });

    const agent = agents.find((a) => a.name === "mls-test-agent");
    expect(agent?.model).toBe("openai/o3-mini");
  });

  it("keeps frontmatter model ahead of the parent model when no config override exists", () => {
    const agents = loadAgents(fixturesDir, {
      parentModel: "openai/gpt-4o-mini",
    });

    const agent = agents.find((a) => a.name === "mls-test-agent");
    expect(agent?.model).toBe("test-model");
  });
});

describe("loadProviderProfile", () => {
  it("returns built-in profile for known provider", () => {
    const profile = loadProviderProfile("/tmp", "anthropic");
    expect(profile.concurrency).toBe(4);
    expect(profile.spawnDelayMs).toBe(0);
  });

  it("returns fallback for unknown provider", () => {
    const profile = loadProviderProfile("/tmp", "unknown-provider");
    expect(profile.concurrency).toBe(2);
    expect(profile.spawnDelayMs).toBe(2_000);
  });

  it("prefers the routed provider profile for openrouter model IDs", () => {
    const profile = loadProviderProfile(
      "/tmp/nonexistent",
      "openrouter",
      "google/gemini-flash",
    );
    expect(profile.concurrency).toBe(1);
    expect(profile.spawnDelayMs).toBe(5_000);
  });

  it("uses per-project config override from .mls/config.json", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mls-test-"));
    try {
      const mlsDir = path.join(tmpDir, ".mls");
      fs.mkdirSync(mlsDir, { recursive: true });
      fs.writeFileSync(
        path.join(mlsDir, "config.json"),
        JSON.stringify({
          providers: {
            anthropic: { concurrency: 10, spawnDelayMs: 500 },
          },
        }),
      );
      const profile = loadProviderProfile(tmpDir, "anthropic");
      expect(profile.concurrency).toBe(10);
      expect(profile.spawnDelayMs).toBe(500);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("falls through on malformed config", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mls-test-"));
    try {
      const mlsDir = path.join(tmpDir, ".mls");
      fs.mkdirSync(mlsDir, { recursive: true });
      fs.writeFileSync(path.join(mlsDir, "config.json"), "NOT JSON");
      const profile = loadProviderProfile(tmpDir, "anthropic");
      expect(profile.concurrency).toBe(4);
      expect(profile.spawnDelayMs).toBe(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("rateThrottle", () => {
  beforeEach(() => {
    rateThrottle.applyProfile({ concurrency: 4, spawnDelayMs: 0 });
  });

  describe("isRateLimit", () => {
    it("detects 429 in stderr", () => {
      expect(rateThrottle.isRateLimit("HTTP 429 Too Many Requests")).toBe(true);
    });

    it("detects 'rate limit' in stderr", () => {
      expect(rateThrottle.isRateLimit("rate limit exceeded")).toBe(true);
    });

    it("detects 'too many requests' in error message", () => {
      expect(rateThrottle.isRateLimit("", "too many requests")).toBe(true);
    });

    it("detects 'quota exceeded'", () => {
      expect(rateThrottle.isRateLimit("quota exceeded")).toBe(true);
    });

    it("returns false for unrelated errors", () => {
      expect(rateThrottle.isRateLimit("connection timeout")).toBe(false);
    });
  });

  describe("backoff", () => {
    it("doubles delay and reduces concurrency", () => {
      rateThrottle.applyProfile({ concurrency: 4, spawnDelayMs: 1_000 });
      const initialConcurrency = rateThrottle.getConcurrency();
      const initialDelay = rateThrottle.getDelay();

      rateThrottle.backoff();

      expect(rateThrottle.getDelay()).toBe(initialDelay * 2);
      expect(rateThrottle.getConcurrency()).toBeLessThan(initialConcurrency);
    });

    it("caps delay at 60 seconds", () => {
      rateThrottle.applyProfile({ concurrency: 4, spawnDelayMs: 30_000 });
      rateThrottle.backoff();
      rateThrottle.backoff();
      rateThrottle.backoff();

      expect(rateThrottle.getDelay()).toBeLessThanOrEqual(60_000);
    });

    it("uses 5000ms fallback when baseline delay is 0 (then doubles to 10000)", () => {
      rateThrottle.applyProfile({ concurrency: 4, spawnDelayMs: 0 });
      rateThrottle.backoff();
      expect(rateThrottle.getDelay()).toBe(5_000 * 2);
    });

    it("starts backoff at 10_000ms when baseline delay is 0", () => {
      rateThrottle.applyProfile({ concurrency: 4, spawnDelayMs: 0 });
      rateThrottle.backoff();
      expect(rateThrottle.getDelay()).toBe(10_000);
    });

    it("concurrency never drops below 1", () => {
      rateThrottle.applyProfile({ concurrency: 2, spawnDelayMs: 1_000 });
      rateThrottle.backoff();
      rateThrottle.backoff();
      rateThrottle.backoff();
      rateThrottle.backoff();
      expect(rateThrottle.getConcurrency()).toBe(1);
    });
  });

  describe("success", () => {
    it("recovers concurrency after backoff", () => {
      rateThrottle.applyProfile({ concurrency: 4, spawnDelayMs: 1_000 });
      rateThrottle.backoff();
      const afterBackoff = rateThrottle.getConcurrency();

      rateThrottle.success();

      expect(rateThrottle.getConcurrency()).toBeGreaterThanOrEqual(
        afterBackoff,
      );
    });

    it("recovers concurrency to baseline after delay fully recovers", () => {
      rateThrottle.applyProfile({ concurrency: 4, spawnDelayMs: 1_000 });
      rateThrottle.backoff(); // delay → 2000, concurrency → 3

      // One success reduces delay by 1000 → 1000 (== base), so concurrency restores
      rateThrottle.success();
      expect(rateThrottle.getDelay()).toBe(1_000);
      expect(rateThrottle.getConcurrency()).toBe(4);
    });
  });
});

describe("formatUsage", () => {
  const emptyUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 };

  it("formats with turns and input tokens", () => {
    const result = formatUsage({ ...emptyUsage, turns: 3, input: 1500 });
    expect(result).toContain("3 turns");
    expect(result).toContain("1.5k");
  });

  it("includes cost when provided", () => {
    const result = formatUsage({ ...emptyUsage, turns: 1, input: 100, cost: 0.05 });
    expect(result).toContain("$0.0500");
  });

  it("includes model when provided", () => {
    const result = formatUsage({ ...emptyUsage, turns: 1 }, "claude-sonnet");
    expect(result).toContain("claude-sonnet");
  });

  it("handles zero values", () => {
    const result = formatUsage(emptyUsage);
    expect(result).toBe("");
  });

  it("formats large token counts", () => {
    const result = formatUsage({ ...emptyUsage, input: 1500000 });
    expect(result).toContain("1.5M");
  });

  it("formats medium token counts", () => {
    const result = formatUsage({ ...emptyUsage, input: 15000 });
    expect(result).toContain("15k");
  });

  it("singular turn", () => {
    const result = formatUsage({ ...emptyUsage, turns: 1 });
    expect(result).toContain("1 turn");
    expect(result).not.toContain("turns");
  });

  it("includes output tokens when non-zero", () => {
    const result = formatUsage({ ...emptyUsage, output: 500 });
    expect(result).toContain("↓500");
  });
});
