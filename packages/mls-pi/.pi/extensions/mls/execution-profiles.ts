/**
 * MLS Pi Extension — Execution Profiles
 *
 * Bundles all behavioral differences between execution modes into a single
 * config object. The orchestrator reads values from the profile without
 * knowing which mode is active — no if/else branching on mode names.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { loadProjectConfig } from "./config.js";
import type { ExecutionProfile, GatePoint, PipelineMode } from "./types.js";

/**
 * Default execution profile for remote API providers (Anthropic, OpenAI, GitHub Copilot, etc.).
 * Full concurrency, all quality gates enabled, LLM-based tech-stack extraction enabled.
 * Rate limiting is handled adaptively by {@link RateThrottle} rather than by baking limits here.
 * Human gates are off by default (opt-in via config).
 */
export const CLOUD_PROFILE: ExecutionProfile = {
  name: "cloud",
  group1Concurrency: 4,
  group2Concurrency: 2,
  maxReviewIterations: 3,
  maxTestRetries: 3,
  enablePhase0: true,
  enableSpecGate: true,
  enableReviewGate: true,
  sequentialGroup1: false,
  skipAgentsMdExtraction: false,
  humanGates: [],
  pipelineMode: "full",
};

/**
 * Execution profile for local hardware-bound models (Ollama, LM Studio).
 * Sequential execution prevents GPU/CPU contention; all LLM-based quality gates are disabled
 * to reduce context consumption; retries are minimized to keep run times manageable.
 */
export const LOCAL_PROFILE: ExecutionProfile = {
  name: "local",
  group1Concurrency: 1,
  group2Concurrency: 1,
  maxReviewIterations: 1,
  maxTestRetries: 2,
  enablePhase0: false,
  enableSpecGate: false,
  enableReviewGate: false,
  sequentialGroup1: true,
  skipAgentsMdExtraction: true,
  humanGates: [],
  pipelineMode: "full",
};

/**
 * Provider names that automatically select the local execution profile.
 * To add a new local provider, add its name here.
 */
const LOCAL_PROVIDERS = new Set(["ollama", "lmstudio"]);

/**
 * Resolve the execution profile for a build run.
 *
 * Priority (highest to lowest):
 *   1. Provider auto-detection — if `provider` is in {@link LOCAL_PROVIDERS}, returns the local profile.
 *   2. `"mode": "local"` key in `.mls/config.json` — returns the local profile.
 *   3. `"executionProfile": { ... }` object in `.mls/config.json` — merges the object over
 *      the cloud profile baseline. The `name` field defaults to `"custom"` if not specified.
 *      Example: `{ "executionProfile": { "maxReviewIterations": 1, "enableSpecGate": false } }`
 *   4. Default — returns the cloud profile.
 *
 * The resolved profile is a shallow copy; callers may not mutate it.
 *
 * @param cwd - Project working directory; `.mls/config.json` is resolved relative to this.
 * @param provider - Provider name string from the active session (e.g., `"anthropic"`, `"ollama"`).
 * @returns A fully populated {@link ExecutionProfile}.
 */
export function resolveExecutionProfile(cwd: string, provider?: string): ExecutionProfile {
  if (provider && LOCAL_PROVIDERS.has(provider)) return { ...LOCAL_PROFILE };

  const config = loadProjectConfig(cwd);

  if (config.mode === "local") return { ...LOCAL_PROFILE };

  if (config.executionProfile && typeof config.executionProfile === "object") {
    const merged = { ...CLOUD_PROFILE, ...config.executionProfile, name: config.executionProfile.name ?? "custom" };
    // Merge humanGates from config if provided
    if (Array.isArray(config.humanGates)) {
      merged.humanGates = config.humanGates as GatePoint[];
    }
    // Merge pipelineMode from config if provided
    if (config.pipelineMode) {
      merged.pipelineMode = config.pipelineMode as PipelineMode;
    }
    return merged;
  }

  // Apply top-level humanGates/pipelineMode overrides even without executionProfile block
  const profile = { ...CLOUD_PROFILE };
  if (Array.isArray(config.humanGates)) {
    profile.humanGates = config.humanGates as GatePoint[];
  }
  if (config.pipelineMode) {
    profile.pipelineMode = config.pipelineMode as PipelineMode;
  }
  return profile;
}
