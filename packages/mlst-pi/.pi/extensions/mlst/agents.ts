/**
 * MLST Pi Extension — Agent Spawning
 *
 * Spawns pi subprocesses with --no-extensions to prevent re-entrancy.
 * Passes the parent model explicitly. Streams text_delta events for
 * live progress feedback via onProgress callback.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentResult, MlstAgentConfig, UsageStats } from "./types.js";
import { loadProjectConfig, type ModelRoutingConfig, resolveAgentModel } from "./config.js";
import type { SkillLoader } from "./skills.js";

const MAX_CONCURRENCY = 4;

// ─── Provider Profiles ──────────────────────────────────────────────────────

export interface ProviderProfile {
  /** Maximum number of agent subprocesses that may run simultaneously. */
  concurrency: number;
  /**
   * Minimum milliseconds to wait between consecutive agent spawns (pacing delay).
   * `0` means no enforced pacing — agents are spawned as concurrency slots open up.
   * Non-zero values are used for providers with strict request-per-minute limits
   * (e.g., Google/Gemini free tier) where burst concurrency triggers 429s even within
   * the normal concurrency limit.
   */
  spawnDelayMs: number;
}

/**
 * Built-in provider profiles indexed by provider name.
 *
 * Different providers have different rate-limit characteristics:
 * - **Subscription providers** (Copilot): no API quotas, full concurrency.
 * - **Paid API providers** (Anthropic, OpenAI): full concurrency; adaptive backoff handles 429s.
 * - **Local models** (Ollama, LM Studio): no rate limits but hardware-bound; lower concurrency.
 * - **Free-tier / aggressive limits** (Google, Groq): low concurrency + mandatory pacing delays.
 * - **Routed providers** (OpenRouter): moderate defaults; sub-provider lookup may override them.
 *
 * To add a new provider, add an entry here. To override project-specific limits, use
 * `.mlst/config.json` `"providers"` key (see {@link loadProviderProfile}).
 */
export const DEFAULT_PROVIDER_PROFILES: Record<string, ProviderProfile> = {
  // Subscription — generous limits
  "copilot":        { concurrency: 4, spawnDelayMs: 0 },
  "github-copilot": { concurrency: 4, spawnDelayMs: 0 },

  // Paid API — full concurrency, adaptive backoff handles limits
  "anthropic":      { concurrency: 4, spawnDelayMs: 0 },
  "openai":         { concurrency: 4, spawnDelayMs: 0 },

  // Local models — no rate limits, but hardware-bound
  "ollama":         { concurrency: 2, spawnDelayMs: 0 },
  "lmstudio":       { concurrency: 2, spawnDelayMs: 0 },

  // Free-tier / aggressive rate limits
  "google":         { concurrency: 1, spawnDelayMs: 5_000 },
  "gemini":         { concurrency: 1, spawnDelayMs: 5_000 },
  "cerebras":       { concurrency: 4, spawnDelayMs: 0 },
  "groq":           { concurrency: 1, spawnDelayMs: 3_000 },

  // Routed providers (free tiers via OpenRouter, etc.)
  "openrouter":     { concurrency: 2, spawnDelayMs: 2_000 },
  "minimax":        { concurrency: 1, spawnDelayMs: 5_000 },
  "qwen":           { concurrency: 1, spawnDelayMs: 5_000 },
  "xiaomi":         { concurrency: 1, spawnDelayMs: 5_000 },
  "kimi":           { concurrency: 1, spawnDelayMs: 5_000 },
};

const FALLBACK_PROFILE: ProviderProfile = { concurrency: 2, spawnDelayMs: 2_000 };

/**
 * Resolve the rate-limit profile to apply for the current session.
 *
 * Three-level lookup (highest to lowest priority):
 * 1. **Per-project config override** — reads `.mlst/config.json` `"providers"` key.
 *    Example: `{ "providers": { "anthropic": { "concurrency": 1, "spawnDelayMs": 3000 } } }`
 * 2. **OpenRouter sub-provider** — when `provider === "openrouter"` and `modelId` is provided,
 *    extracts the sub-provider from `modelId.split("/")[0]` (e.g., `"anthropic/claude-3"` →
 *    `"anthropic"`) and uses that provider's built-in profile if one exists.
 * 3. **Built-in default** — looks up `DEFAULT_PROVIDER_PROFILES[provider]`.
 * 4. **Fallback** — returns `{ concurrency: 2, spawnDelayMs: 2000 }` for unknown providers.
 *
 * @param cwd      - Project working directory for reading `.mlst/config.json`.
 * @param provider - Provider name from the active session (e.g., `"anthropic"`, `"google"`).
 * @param modelId  - Optional model ID string (used only for OpenRouter sub-provider detection).
 * @returns A shallow copy of the resolved profile.
 */
export function loadProviderProfile(cwd: string, provider: string, modelId?: string): ProviderProfile {
  // 1. Check per-project config override
  const config = loadProjectConfig(cwd);
  const overrides = config.providers;
  if (overrides && typeof overrides === "object" && overrides[provider]) {
    const o = overrides[provider];
    return {
      concurrency: typeof o.concurrency === "number" ? o.concurrency : FALLBACK_PROFILE.concurrency,
      spawnDelayMs: typeof o.spawnDelayMs === "number" ? o.spawnDelayMs : FALLBACK_PROFILE.spawnDelayMs,
    };
  }

  // 2. For openrouter, prefer the routed provider's profile when the model ID exposes it.
  if (provider === "openrouter" && modelId) {
    const subProvider = modelId.split("/")[0];
    if (subProvider && DEFAULT_PROVIDER_PROFILES[subProvider]) {
      return { ...DEFAULT_PROVIDER_PROFILES[subProvider] };
    }
  }

  // 3. Built-in profile for this provider
  if (DEFAULT_PROVIDER_PROFILES[provider]) {
    return { ...DEFAULT_PROVIDER_PROFILES[provider] };
  }

  return { ...FALLBACK_PROFILE };
}

// ─── Rate Limit Throttle ─────────────────────────────────────────────────────

/**
 * Adaptive rate-limit throttle for agent spawning.
 *
 * Starts from a provider baseline (set via {@link applyProfile}) and reacts to 429
 * errors by backing off (doubling the delay, reducing concurrency). After each
 * successful call it gradually recovers toward the baseline. Concurrency is only
 * restored once the delay has fully recovered to the baseline value.
 *
 * State machine:
 * ```
 * baseline  ──[backoff]──►  delayMs * 2, concurrency - 1  (caps: 60s delay, min 1 concurrency)
 *           ◄─[success]──  delayMs - 1s per call; concurrency restored when delay == baseline
 * ```
 */
class RateThrottle {
  /** Spawn-delay baseline (ms) from the provider profile; target after full recovery. */
  private baseDelayMs = 0;
  /** Concurrency baseline from the provider profile; target after full recovery. */
  private baseConcurrency = MAX_CONCURRENCY;
  /** Current minimum ms between consecutive spawns; increases on 429, decreases on success. */
  private delayMs = 0;
  /** Current maximum simultaneous agent subprocesses; decreases on 429, restored on recovery. */
  private maxConcurrency = MAX_CONCURRENCY;
  /** Timestamp (ms) after which new spawns are permitted again following a backoff. */
  private backoffUntil = 0;
  /** Timestamp (ms) of the most recent spawn; used to enforce the pacing delay. */
  private lastSpawnTime = 0;
  /** Dashboard event emitter injected by the orchestrator; `undefined` before `setEventEmitter`. */
  private onEvent?: (event: any) => void;

  /** @internal Used by the orchestrator to route `rate_limit` events to the dashboard. */
  setEventEmitter(fn: (event: any) => void) { this.onEvent = fn; }

  /**
   * Apply a provider profile, resetting both the baseline and current values.
   * Called once per build run (from `Orchestrator` constructor via `rateThrottle.applyProfile`).
   * Emits a `rate_limit` dashboard event to record the starting state.
   *
   * @param profile - The resolved provider profile for this session.
   */
  applyProfile(profile: ProviderProfile): void {
    this.baseConcurrency = profile.concurrency;
    this.maxConcurrency = profile.concurrency;
    this.baseDelayMs = profile.spawnDelayMs;
    this.delayMs = profile.spawnDelayMs;
    this.onEvent?.({
      type: "rate_limit", delayMs: this.delayMs, concurrency: this.maxConcurrency, timestamp: Date.now(),
    });
  }

  /**
   * Determine whether an agent error looks like a rate-limit rejection.
   *
   * Checks both `stderr` and the optional `errorMessage` for common 429 signals:
   * `"429"`, `"rate limit"`, `"rate_limit"`, `"too many requests"`, `"quota exceeded"`.
   * Case-insensitive; the two strings are concatenated before matching.
   *
   * @param stderr       - Subprocess stderr output.
   * @param errorMessage - Optional model-reported error message from the SSE event.
   * @returns `true` if a rate-limit pattern is found.
   */
  isRateLimit(stderr: string, errorMessage?: string): boolean {
    const text = `${stderr} ${errorMessage ?? ""}`.toLowerCase();
    return text.includes("429") || text.includes("rate limit") || text.includes("rate_limit")
      || text.includes("too many requests") || text.includes("quota exceeded");
  }

  /**
   * Register a rate-limit event and increase throttling.
   *
   * State changes:
   * - `delayMs` doubles (or starts at 5 000ms if currently 0), capped at 60 000ms.
   * - `maxConcurrency` decreases by 1, capped at a minimum of 1.
   * - `backoffUntil` is set to `now + delayMs` so {@link wait} blocks new spawns.
   *
   * Emits a `rate_limit` dashboard event with the updated values.
   */
  backoff(): void {
    this.delayMs = Math.min((this.delayMs || this.baseDelayMs || 5_000) * 2, 60_000);
    this.maxConcurrency = Math.max(1, this.maxConcurrency - 1);
    this.backoffUntil = Date.now() + this.delayMs;
    this.onEvent?.({
      type: "rate_limit", delayMs: this.delayMs, concurrency: this.maxConcurrency, timestamp: Date.now(),
    });
  }

  /**
   * Register a successful agent completion and gradually reduce throttling.
   *
   * State changes:
   * - `delayMs` decreases by 1 000ms per call, floored at `baseDelayMs`.
   * - `maxConcurrency` is restored to `baseConcurrency` only once `delayMs` has
   *   recovered all the way to the baseline (prevents premature concurrency restoration
   *   while still waiting out residual delay).
   */
  success(): void {
    if (this.delayMs > this.baseDelayMs) {
      this.delayMs = Math.max(this.baseDelayMs, this.delayMs - 1000);
    }
    if (this.maxConcurrency < this.baseConcurrency && this.delayMs <= this.baseDelayMs) {
      this.maxConcurrency = this.baseConcurrency;
    }
  }

  /**
   * Block the caller until it is safe to spawn the next agent.
   *
   * Two-phase wait:
   * 1. **Backoff period** — if `backoffUntil > now`, sleeps for the remaining duration.
   * 2. **Pacing delay** — if `delayMs > 0`, enforces a minimum gap between consecutive
   *    spawns by sleeping for `delayMs - timeSinceLastSpawn`.
   *
   * Updates `lastSpawnTime` after both waits complete so the next caller gets a fresh gap.
   */
  async wait(): Promise<void> {
    // Backoff wait
    const backoffRemaining = this.backoffUntil - Date.now();
    if (backoffRemaining > 0) await new Promise(r => setTimeout(r, backoffRemaining));

    // Pacing: enforce minimum gap between spawns
    if (this.delayMs > 0) {
      const sinceLast = Date.now() - this.lastSpawnTime;
      if (sinceLast < this.delayMs) await new Promise(r => setTimeout(r, this.delayMs - sinceLast));
    }
    this.lastSpawnTime = Date.now();
  }

  getConcurrency(): number { return this.maxConcurrency; }
  getDelay(): number { return this.delayMs; }
}

/**
 * Singleton rate throttle shared across all agent spawns in a build run.
 * The `Orchestrator` constructor calls `rateThrottle.applyProfile()` to configure
 * it for the current session's provider before any agents are spawned.
 */
export const rateThrottle = new RateThrottle();

// ─── Agent Discovery ────────────────────────────────────────────────────────

/**
 * Discover and parse all agent definition files in an `agents/` directory.
 *
 * Reads every `.md` file (including symlinks) in `agentsDir`. Each file must have
 * YAML frontmatter with at least `name` and `description` fields; files missing
 * either field are silently skipped. The `tools` frontmatter value is split on commas
 * if present. Returns an empty array if the directory does not exist or cannot be read.
 *
 * @param agentsDir - Absolute path to the directory containing agent `.md` files.
 * @returns Array of parsed agent configs, one per valid `.md` file.
 */
export interface LoadAgentsOptions {
  parentModel?: string;
  models?: ModelRoutingConfig;
}

export function loadAgents(agentsDir: string, opts: LoadAgentsOptions = {}): MlstAgentConfig[] {
  if (!fs.existsSync(agentsDir)) return [];

  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(agentsDir, { withFileTypes: true }); } catch { return []; }

  const agents: MlstAgentConfig[] = [];
  for (const entry of entries) {
    if (!entry.name.endsWith(".md") || (!entry.isFile() && !entry.isSymbolicLink())) continue;

    let content: string;
    try { content = fs.readFileSync(path.join(agentsDir, entry.name), "utf-8"); } catch { continue; }

    const { frontmatter, body } = parseFrontmatter(content);
    if (!frontmatter.name || !frontmatter.description) continue;

    const tools = frontmatter.tools?.split(",").map((t: string) => t.trim()).filter(Boolean);
    const model = resolveAgentModel(frontmatter.name, frontmatter.model, opts.parentModel, opts.models);

    agents.push({
      name: frontmatter.name,
      description: frontmatter.description,
      tools: tools?.length ? tools : undefined,
      model,
      systemPrompt: body,
      filePath: path.join(agentsDir, entry.name),
    });
  }
  return agents;
}

/**
 * Simple key:value YAML frontmatter parser (no external library).
 * Handles single-level string values only; nested objects and arrays are not supported.
 * Lines without a `:` separator are silently skipped.
 *
 * @param content - Full file content starting with `---\n...\n---\n`.
 * @returns Parsed frontmatter key-value pairs and the body text after the closing `---`.
 */
function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };

  const fm: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const i = line.indexOf(":");
    if (i === -1) continue;
    const key = line.slice(0, i).trim();
    const value = line.slice(i + 1).trim();
    if (key && value) fm[key] = value;
  }
  return { frontmatter: fm, body: match[2] };
}

// ─── Safety Preamble ─────────────────────────────────────────────────────────

/**
 * Soft safety constraints injected into every spawned agent's system prompt.
 *
 * These are advisory guards — the agent can technically ignore them — but they
 * layer with the hard guards enforced by the orchestrator's `tool_call` handler
 * (which blocks `edit`/`write` on the main agent) and the deletion detection gate.
 * The preamble covers destructive shell commands, out-of-directory writes, `.git/`
 * and `node_modules/` mutations, and empty-content overwrites.
 *
 * @param cwd - Project working directory; included in the prompt so agents know the boundary.
 * @returns Markdown string to append to the agent's system prompt.
 */
function buildSafetyPreamble(cwd: string): string {
  return `
## Safety Constraints (enforced by MLST orchestrator)

- NEVER run destructive commands: \`rm -rf\`, \`rm -r\`, \`git reset --hard\`, \`git clean\`, \`git checkout .\`, \`find -delete\`.
- NEVER modify files outside the project directory: ${cwd}
- NEVER modify anything inside \`.git/\` or \`node_modules/\`.
- NEVER overwrite a file with empty content (this is effectively deletion).
- If a file needs to be deleted as part of a refactor, use \`git rm <file>\` for individual files. Do NOT use recursive or wildcard deletes.
- Prefer small, targeted changes. If you find yourself deleting large amounts of code, explain why in your output.

## Clarification Protocol

If you encounter ambiguity that could lead to incorrect assumptions:
- Output \`CLARIFICATION_NEEDED: <your question>\` on its own line.
- You may include multiple CLARIFICATION_NEEDED lines for separate questions.
- Continue with your best judgment after the markers — the orchestrator will pause and relay your questions to the user.
- Only use this for genuinely ambiguous decisions that could significantly affect downstream work.
`;
}

// ─── Spawn Options ──────────────────────────────────────────────────────────

export interface SpawnOptions {
  cwd: string;
  /** Parent model as "provider/id" — used only when no agent-level or config-level model is set. */
  model?: string;
  signal?: AbortSignal;
  /**
   * Sprint context (tech stack, tasks, coding guidelines) from buildSprintContext().
   * Appended to the agent's system prompt. Empty string / undefined = no-op.
   */
  sprintContext?: string;
  /** Called with streaming text as the agent works */
  onProgress?: (text: string, toolCount: number) => void;
}

// ─── Agent Spawning ─────────────────────────────────────────────────────────

/**
 * Write a temporary system-prompt file for agent spawning.
 *
 * Creates a uniquely named temp directory and writes the content to
 * `prompt-<safeName>.md` inside it with file permissions 0o600 (owner-read only).
 * The caller is responsible for deleting the file and directory after the agent exits.
 *
 * @param name    - Agent name; used (sanitized) in the filename.
 * @param content - Full system-prompt content to write.
 * @returns Paths to the temp directory and the prompt file.
 */
async function writeTempPrompt(name: string, content: string): Promise<{ dir: string; filePath: string }> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "mlst-agent-"));
  const filePath = path.join(dir, `prompt-${name.replace(/[^\w.-]+/g, "_")}.md`);
  await fs.promises.writeFile(filePath, content, { encoding: "utf-8", mode: 0o600 });
  return { dir, filePath };
}

/**
 * Spawn a single `pi` agent subprocess and collect its output, usage stats, and exit code.
 *
 * **Full lifecycle:**
 * 1. `rateThrottle.wait()` — blocks if in a backoff period or pacing window.
 * 2. Build `pi` args: `--no-extensions`, `--no-session`, optional `--model`, optional `--tools`.
 * 3. Write system prompt + skills + safety preamble to a temp file (0o600 permissions).
 * 4. Spawn the `pi` subprocess; stream `text_delta` events to `onProgress` callback.
 * 5. Accumulate token usage from every `message_end` event across all turns.
 * 6. On exit: detect rate limits via `rateThrottle.isRateLimit()` and call `backoff()` or `success()`.
 * 7. Clean up the temp file and directory in the `finally` block (guaranteed even on error).
 *
 * Returns the result regardless of exit code — callers (e.g., {@link Orchestrator.spawn})
 * are responsible for inspecting `exitCode` and throwing as appropriate.
 *
 * @param agent       - Agent configuration (system prompt, tools, model, name).
 * @param task        - Task description string passed as the `pi` positional argument.
 * @param skillLoader - Skill loader to inject agent-specific skills into the system prompt.
 * @param opts        - CWD, model override, abort signal, and progress callback.
 * @returns Fully populated `AgentResult`; check `exitCode` to determine success or failure.
 */
export async function spawnAgent(
  agent: MlstAgentConfig,
  task: string,
  skillLoader: SkillLoader,
  opts: SpawnOptions,
): Promise<AgentResult> {
  // Adaptive rate limit: wait if in backoff period
  await rateThrottle.wait();

  const args: string[] = [
    "--mode", "json",
    "-p",
    "--no-session",
    "--no-extensions",   // Prevent MLST extension from loading in subprocess
    "--thinking", "off", // Subprocess agents don't need extended thinking
  ];

  // Prefer exact agent/config routing over the parent session default.
  if (agent.model) args.push("--model", agent.model);
  else if (opts.model) args.push("--model", opts.model);

  if (agent.tools?.length) args.push("--tools", agent.tools.join(","));

  const result: AgentResult = {
    agent: agent.name, task, exitCode: 0, output: "", stderr: "",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
  };

  // Build system prompt with injected skills and safety preamble
  const fullPrompt = agent.systemPrompt + skillLoader.getSkillsForAgent(agent.name) + buildSafetyPreamble(opts.cwd) + (opts.sprintContext ?? "");
  let tmpDir: string | null = null;
  let tmpPath: string | null = null;

  try {
    if (fullPrompt.trim()) {
      const tmp = await writeTempPrompt(agent.name, fullPrompt);
      tmpDir = tmp.dir;
      tmpPath = tmp.filePath;
      args.push("--append-system-prompt", tmpPath);
    }

    args.push(`Task: ${task}`);

    let wasAborted = false;
    const messages: any[] = [];
    const textChunks: string[] = [];
    const thinkingChunks: string[] = [];
    let toolCount = 0;

    const exitCode = await new Promise<number>((resolve) => {
      const proc = spawn("pi", args, {
        cwd: opts.cwd, shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let buffer = "";

      proc.stdout.on("data", (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) processEvent(line);
      });

      proc.stderr.on("data", (data: Buffer) => { result.stderr += data.toString(); });

      proc.on("close", (code: number | null) => {
        if (buffer.trim()) processEvent(buffer);
        resolve(code ?? 0);
      });

      proc.on("error", () => resolve(1));

      if (opts.signal) {
        const kill = () => { wasAborted = true; proc.kill("SIGTERM"); setTimeout(() => { if (!proc.killed) proc.kill("SIGKILL"); }, 5000); };
        if (opts.signal.aborted) kill();
        else opts.signal.addEventListener("abort", kill, { once: true });
      }

      function processEvent(line: string) {
        if (!line.trim()) return;
        let event: any;
        try { event = JSON.parse(line); } catch { return; }

        // Stream text deltas and thinking for live progress
        if (event.type === "message_update") {
          const ame = event.assistantMessageEvent;
          if (ame?.type === "text_delta") {
            textChunks.push(ame.delta ?? "");
            const lastLine = textChunks.join("").split("\n").filter((l: string) => l.trim()).pop() ?? "";
            opts.onProgress?.(lastLine, toolCount);
          } else if (ame?.type === "thinking") {
            thinkingChunks.push(ame.thinking ?? "");
          }
        }

        // Track tool calls
        if (event.type === "tool_execution_start") {
          toolCount++;
          const name = event.toolName ?? "";
          const preview = event.args?.command?.slice(0, 40) ?? event.args?.file_path?.split("/").pop() ?? "";
          opts.onProgress?.(`[${name}] ${preview}`, toolCount);
        }

        // Capture completed messages
        if (event.type === "message_end" && event.message) {
          // Emit complete thought (not partial chunks)
          if (thinkingChunks.length > 0) {
            const fullThought = thinkingChunks.join("").trim();
            if (fullThought) {
              const lastLine = fullThought.split("\n").filter((l: string) => l.trim()).pop() ?? "";
              opts.onProgress?.(`thinking: ${lastLine.slice(0, 60)}`, toolCount);
            }
            thinkingChunks.length = 0;
          }

          const msg = event.message;
          messages.push(msg);
          if (msg.role === "assistant") {
            result.usage.turns++;
            const u = msg.usage;
            if (u) {
              result.usage.input += u.input ?? 0;
              result.usage.output += u.output ?? 0;
              result.usage.cacheRead += u.cacheRead ?? 0;
              result.usage.cacheWrite += u.cacheWrite ?? 0;
              result.usage.cost += u.cost?.total ?? 0;
              result.usage.contextTokens = u.totalTokens ?? 0;
            }
            if (!result.model && msg.model) result.model = msg.model;
            if (msg.stopReason) result.stopReason = msg.stopReason;
            if (msg.errorMessage) result.errorMessage = msg.errorMessage;
          }
        }

        if (event.type === "tool_result_end" && event.message) {
          messages.push(event.message);
        }
      }
    });

    result.exitCode = exitCode;
    if (wasAborted) { result.exitCode = 1; result.errorMessage = "Agent was aborted"; }
    result.output = getFinalOutput(messages);

    // Adaptive rate limiting
    if (result.exitCode !== 0 && rateThrottle.isRateLimit(result.stderr, result.errorMessage)) {
      rateThrottle.backoff();
    } else if (result.exitCode === 0) {
      rateThrottle.success();
    }

    return result;
  } finally {
    if (tmpPath) try { fs.unlinkSync(tmpPath); } catch {}
    if (tmpDir) try { fs.rmdirSync(tmpDir); } catch {}
  }
}

// ─── Parallel Execution ─────────────────────────────────────────────────────

/**
 * Spawn multiple agent tasks concurrently, respecting the current throttle concurrency limit.
 *
 * Delegates to {@link mapLimit} with `rateThrottle.getConcurrency()` as the pool size.
 * Note that `getConcurrency()` reflects the current (possibly reduced) limit — prior backoff
 * events may have lowered it below the provider baseline.
 *
 * @param tasks       - Array of `{ agent, task }` pairs to execute.
 * @param skillLoader - Shared skill loader injected into each agent.
 * @param opts        - Shared spawn options (CWD, model, signal, progress callback).
 * @returns Array of `AgentResult` in the same order as the input `tasks` array.
 */
export async function spawnAgentsParallel(
  tasks: Array<{ agent: MlstAgentConfig; task: string }>,
  skillLoader: SkillLoader,
  opts: SpawnOptions,
): Promise<AgentResult[]> {
  return mapLimit(tasks, rateThrottle.getConcurrency(), (item) =>
    spawnAgent(item.agent, item.task, skillLoader, opts),
  );
}

/**
 * Pool-based concurrency limiter that returns results in input order.
 *
 * Starts `Math.min(concurrency, items.length)` worker coroutines; each worker pulls
 * the next item from the shared `next` index until all items are processed.
 * Equivalent to `p-limit` for arrays.
 *
 * @param items       - Items to process.
 * @param concurrency - Maximum number of items to process in parallel.
 * @param fn          - Async function to apply to each item.
 * @returns Array of results in the same order as `items`.
 */
async function mapLimit<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  if (!items.length) return [];
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }));
  return results;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Scan a message array in reverse to find the last assistant turn's text content.
 *
 * @param messages - Array of message objects from the `pi` subprocess SSE events.
 * @returns The text of the last assistant message, or an empty string if none found.
 */
function getFinalOutput(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") {
      const text = extractText(messages[i].content);
      if (text) return text;
    }
  }
  return "";
}

/**
 * Extract text from a message `content` field.
 * Handles both plain string content and content-block arrays
 * (filters for `type === "text"` blocks and joins with newlines).
 *
 * @param content - The `content` value from a message object.
 * @returns Extracted text string, or empty string if content is neither a string nor an array.
 */
function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
  }
  return "";
}

/**
 * Format a `UsageStats` object into a compact human-readable string for notifications.
 *
 * Includes (in order, omitting zeroes): turn count, input tokens (↑), output tokens (↓),
 * cost in USD, and model name. Token counts are formatted with k/M suffixes.
 *
 * @param usage - Usage statistics from a completed agent run.
 * @param model - Optional model string to append (e.g., `"claude-opus-4-5"`).
 * @returns Formatted string, e.g., `"3 turns ↑12k ↓4k $0.0234 claude-opus-4-5"`.
 */
export function formatUsage(usage: UsageStats, model?: string): string {
  const parts: string[] = [];
  if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
  if (usage.input) parts.push(`↑${fmtTokens(usage.input)}`);
  if (usage.output) parts.push(`↓${fmtTokens(usage.output)}`);
  if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
  if (model) parts.push(model);
  return parts.join(" ");
}

function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1000000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1000000).toFixed(1)}M`;
}
