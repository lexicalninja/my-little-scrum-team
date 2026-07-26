/**
 * MLS Pi Extension — Orchestrator Helpers
 *
 * Pure utility functions and type-only interfaces shared across orchestrator
 * modules. No class dependencies; safe to import from any orchestrator sub-module.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentResult, ClarificationRequest, MlsAgentConfig, TaskState, TaskType } from "../types.js";
import type { Issue } from "../db.js";
import type { SkillLoader } from "../skills.js";
import type { SpawnOptions } from "../agents.js";
import { spawnAgent } from "../agents.js";

// ─── Internal Interfaces ─────────────────────────────────────────────────────

export interface CommandSpec {
  cmd: string;
  args: string[];
}

export interface ParsedTaskPayload {
  id?: string;
  label?: string;
  title?: string;
  type?: TaskType;
  dependencies?: string[];
  parallelWith?: string[];
  acceptanceCriteria?: string[];
  filesAffected?: string[];
}

export interface ParsedTaskLine {
  label: string;
  parsed: ParsedTaskPayload;
}

// ─── Task / Issue Mapping ─────────────────────────────────────────────────────

/**
 * Map a `TaskStatus` value to the corresponding SQLite `Issue.status` value.
 *
 * The two status spaces differ slightly: `"complete"` → `"closed"`,
 * `"in-progress"` → `"in_progress"` (underscore), everything else maps directly
 * or falls back to `"open"`.
 */
export function mapTaskStatusToIssueStatus(status: NonNullable<Partial<TaskState>["status"]>): Issue["status"] {
  switch (status) {
    case "complete":
      return "closed";
    case "in-progress":
      return "in_progress";
    case "testing":
      return "testing";
    case "reviewing":
      return "reviewing";
    case "escalated":
      return "escalated";
    default:
      return "open";
  }
}

/**
 * Return the default agent name for a given `TaskType`.
 *
 * Mapping:
 * - `"Design"` → `"mls-designer"`
 * - `"Infrastructure"` / `"Deployment"` → `"mls-infra-engineer"`
 * - `"Testing"` → `"mls-test-runner"`
 * - Everything else (`"Implementation"`, `"Documentation"`) → `"mls-impl-engineer"`
 */
export function mapTypeToAgent(type: string): string {
  switch (type.toLowerCase()) {
    case "design": return "mls-designer";
    case "infrastructure": case "deployment": return "mls-infra-engineer";
    case "testing": return "mls-test-runner";
    default: return "mls-impl-engineer";
  }
}

// ─── Concurrency Utilities ────────────────────────────────────────────────────

/**
 * Pool-based concurrency limiter for `void`-returning async tasks.
 *
 * Starts `Math.min(limit, items.length)` worker coroutines. Each worker pulls the
 * next available item from the shared `next` index until all items are processed.
 * All workers run concurrently; results are not collected (use `mapLimit` in agents.ts
 * if return values are needed).
 *
 * @param items - Items to process.
 * @param limit - Maximum number of items to process in parallel.
 * @param fn    - Async function to apply to each item.
 */
export async function mapConcurrent<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i]);
    }
  }));
}

/**
 * Group tasks into topological batches for sequential execution.
 *
 * Uses a Kahn's-algorithm variant: iterates until no items remain, each iteration
 * collecting tasks whose dependencies are all in the `done` set. Cycles are handled
 * gracefully: if no ready tasks are found but items remain, all remaining tasks are
 * pushed into the last batch rather than throwing (prevents deadlock).
 *
 * @param impl - The implementation/testing tasks to sequence.
 * @param all  - All sprint tasks (used to seed `done` with already-complete tasks).
 * @returns Array of batches; each batch may run concurrently, batches run sequentially.
 */
export function topologicalBatches(impl: TaskState[], all: TaskState[]): TaskState[][] {
  const batches: TaskState[][] = [];
  const done = new Set(all.filter((t) => t.status === "complete").map((t) => t.id));
  let remaining = [...impl];

  while (remaining.length > 0) {
    const batch = remaining.filter((t) => t.dependencies.every((d) => done.has(d)));
    if (batch.length === 0) { batches.push(remaining); break; }
    batches.push(batch);
    for (const t of batch) done.add(t.id);
    remaining = remaining.filter((t) => !done.has(t.id));
  }

  return batches;
}

// ─── Package Manager Detection ────────────────────────────────────────────────

/**
 * Read and parse `package.json` from the project root.
 *
 * @param cwd - Project working directory.
 * @returns Parsed `package.json` object, or `null` if the file is missing or malformed.
 */
export function readPackageJson(cwd: string): { packageManager?: string; scripts?: Record<string, unknown> } | null {
  const packageJsonPath = joinCwd(cwd, "package.json");
  if (!fs.existsSync(packageJsonPath)) return null;

  try {
    return JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as { packageManager?: string; scripts?: Record<string, unknown> };
  } catch {
    return null;
  }
}

/**
 * Determine the correct package manager command for a given npm script.
 *
 * Detection order (first match wins):
 * 1. `packageManager` field in `package.json` starting with `"pnpm@"` → pnpm.
 * 2. `pnpm-lock.yaml` present → pnpm.
 * 3. `packageManager` starting with `"yarn@"` or `yarn.lock` present → yarn.
 * 4. `packageManager` starting with `"bun@"`, `bun.lock`, or `bun.lockb` present → bun.
 * 5. Default → npm.
 *
 * @param cwd        - Project working directory.
 * @param scriptName - npm script name (e.g., `"test"`, `"lint"`).
 * @returns Command and args to run the script (e.g., `{ cmd: "pnpm", args: ["test"] }`).
 */
export function getPackageManagerCommand(cwd: string, scriptName: string): { cmd: string; args: string[] } {
  const packageManager = readPackageJson(cwd)?.packageManager;

  if ((typeof packageManager === "string" && packageManager.startsWith("pnpm@")) || fs.existsSync(joinCwd(cwd, "pnpm-lock.yaml"))) {
    return { cmd: "pnpm", args: [scriptName] };
  }
  if ((typeof packageManager === "string" && packageManager.startsWith("yarn@")) || fs.existsSync(joinCwd(cwd, "yarn.lock"))) {
    return { cmd: "yarn", args: [scriptName] };
  }
  if (
    (typeof packageManager === "string" && packageManager.startsWith("bun@"))
    || fs.existsSync(joinCwd(cwd, "bun.lock"))
    || fs.existsSync(joinCwd(cwd, "bun.lockb"))
  ) {
    return { cmd: "bun", args: ["run", scriptName] };
  }

  return { cmd: "npm", args: ["run", scriptName] };
}

// ─── Agent Utilities ──────────────────────────────────────────────────────────

/**
 * Run Group 1 agent tasks sequentially (one at a time).
 * Used when `profile.sequentialGroup1` is `true` (local profile).
 *
 * @param tasks       - Array of `{ agent, task }` pairs to execute in order.
 * @param skillLoader - Shared skill loader.
 * @param opts        - Shared spawn options.
 * @returns Array of `AgentResult` in input order.
 */
export async function sequentialSpawn(
  tasks: Array<{ agent: MlsAgentConfig; task: string }>,
  skillLoader: SkillLoader,
  opts: SpawnOptions,
): Promise<AgentResult[]> {
  const results: AgentResult[] = [];
  for (const item of tasks) {
    results.push(await spawnAgent(item.agent, item.task, skillLoader, opts));
  }
  return results;
}

// ─── Path Utilities ───────────────────────────────────────────────────────────

/** Join a file name to the project working directory path. */
export function joinCwd(cwd: string, file: string): string {
  return path.join(cwd, file);
}

/** Combine stdout and stderr into a single trimmed string, omitting empty halves. */
export function joinOutput(stdout: string, stderr: string): string {
  return [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
}

// ─── Clarification Detection ──────────────────────────────────────────────────

/**
 * Regex matching the structured clarification marker in agent output.
 *
 * The marker format is: `CLARIFICATION_NEEDED: <question text>`
 * One marker per line; multiple markers are batched into a single request.
 * Case-insensitive to handle model output variations.
 */
const CLARIFICATION_RE = /^CLARIFICATION_NEEDED:[^\S\n]*(.+)$/gim;

/**
 * Scan agent output for structured clarification markers.
 *
 * Returns a {@link ClarificationRequest} if one or more `CLARIFICATION_NEEDED: <question>`
 * markers are found; `null` otherwise.
 *
 * @param output    - The agent's text output to scan.
 * @param agent     - The agent name (for the request metadata).
 * @param taskLabel - Optional task label (for the request metadata).
 * @returns A `ClarificationRequest` with all detected questions, or `null` if none found.
 */
export function extractClarifications(
  output: string,
  agent: string,
  taskLabel?: string,
): ClarificationRequest | null {
  const questions: string[] = [];
  let match: RegExpExecArray | null;

  // Reset lastIndex for global regex reuse
  CLARIFICATION_RE.lastIndex = 0;
  while ((match = CLARIFICATION_RE.exec(output)) !== null) {
    const question = match[1].trim();
    if (question) questions.push(question);
  }

  if (questions.length === 0) return null;

  return { agent, questions, taskLabel };
}
