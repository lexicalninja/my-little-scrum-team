import { describe, expect, it } from "vitest";
import { resolveAgentModel, resolveLlmModel, type ModelRoutingConfig } from "../.pi/extensions/mls/config.js";

describe("resolveAgentModel", () => {
  const models: ModelRoutingConfig = {
    coding: "anthropic/claude-sonnet-4-20250514",
    planning: "openai/o3-pro",
    scrumMaster: "openai/gpt-4o",
    review: "google/gemini-3.1-pro",
    tests: "openai/o3-mini",
    agents: {
      "mls-designer": "openai/gpt-4o-mini",
    },
  };

  it("prefers exact agent override from config", () => {
    const model = resolveAgentModel(
      "mls-designer",
      "anthropic/claude-sonnet-4-20250514",
      "openai/gpt-4o-mini",
      models,
    );

    expect(model).toBe("openai/gpt-4o-mini");
  });

  it("uses role-based model when no exact agent override exists", () => {
    const model = resolveAgentModel(
      "mls-code-reviewer",
      "anthropic/claude-sonnet-4-20250514",
      "openai/gpt-4o-mini",
      models,
    );

    expect(model).toBe("google/gemini-3.1-pro");
  });

  it("prefers frontmatter model over parent session model when no config override exists", () => {
    const model = resolveAgentModel(
      "mls-test-runner",
      "openai/o3-mini",
      "anthropic/claude-sonnet-4-20250514",
    );

    expect(model).toBe("openai/o3-mini");
  });

  it("falls back to the parent session model when no config or frontmatter model exists", () => {
    const model = resolveAgentModel(
      "mls-test-runner",
      undefined,
      "anthropic/claude-sonnet-4-20250514",
    );

    expect(model).toBe("anthropic/claude-sonnet-4-20250514");
  });
});

describe("resolveLlmModel", () => {
  it("uses planning model for build orchestration by default", () => {
    const model = resolveLlmModel("build", "anthropic/claude-sonnet-4-20250514", {
      planning: "openai/o3-pro",
    });

    expect(model).toBe("openai/o3-pro");
  });

  it("uses explicit prd model when configured", () => {
    const model = resolveLlmModel("prd", "anthropic/claude-sonnet-4-20250514", {
      planning: "openai/o3-pro",
      prd: "anthropic/claude-opus-4-5",
    });

    expect(model).toBe("anthropic/claude-opus-4-5");
  });

  it("falls back to the session model when no config override exists", () => {
    const model = resolveLlmModel("build", "anthropic/claude-sonnet-4-20250514");
    expect(model).toBe("anthropic/claude-sonnet-4-20250514");
  });
});