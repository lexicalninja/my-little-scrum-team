/**
 * My Little Scrum Team — Pi Extension
 *
 * Registers /build and /mlst-status commands. Orchestrates 7 specialist
 * agents through a phased workflow with quality gates.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Text } from "@mariozechner/pi-tui";
import { loadAgents, rateThrottle, loadProviderProfile } from "./agents.js";
import { loadProjectConfig, resolveLlmModel } from "./config.js";
import { resolveExecutionProfile } from "./execution-profiles.js";
import { SkillLoader } from "./skills.js";
import { StateManager, type StateManagerDeps } from "./state.js";
import { ContextAssembler } from "./context.js";
import { QualityGates } from "./quality-gates.js";
import { LlmClient } from "./llm.js";
import { MlstDatabase } from "./db.js";
import { Dashboard, SessionHandle } from "./dashboard.js";
import { Orchestrator } from "./orchestrator/index.js";
import { PrdSession, parsePrdFilePath } from "./prd.js";
import type { MlstEvent } from "./types.js";

/** Severity level for UI notifications sent via {@link UiApi.notify}. */
type NotificationLevel = "info" | "warning" | "error" | "success";

/** Callback that receives the TUI instance and theme, returning a renderable widget. */
type WidgetRenderer = (tui: unknown, theme: WidgetTheme) => RenderableWidget;

/** Theme API for coloring widget text. Provided by pi's TUI layer. */
interface WidgetTheme {
  /** Wrap `text` in the given foreground color (e.g., `"accent"`, `"dim"`, `"success"`). */
  fg(color: string, text: string): string;
  /** Wrap `text` in a background color. */
  bg?(color: string, text: string): string;
  /** Wrap `text` in bold. */
  bold?(text: string): string;
  /** Invert foreground/background for `text`. */
  inverse?(text: string): string;
}

/** A widget that can be rendered into pi's TUI at a given terminal width. */
interface RenderableWidget {
  /** Render the widget content for the given terminal `width` in columns. */
  render(width: number): unknown;
  /** Mark the widget as dirty so the TUI redraws it on the next frame. */
  invalidate(): void;
}

/** Optional UI surface provided by pi's command context for status, widgets, and notifications. */
interface UiApi {
  /** Display a toast notification at the given severity level. */
  notify?(message: string, level: NotificationLevel): void;
  /** Set or clear a key/value pair in the status bar. Pass `undefined` to clear. */
  setStatus?(key: string, value?: string): void;
  /** Set or clear a named widget in the TUI sidebar. Pass `undefined` to remove. */
  setWidget?(key: string, widget?: string[] | WidgetRenderer): void;
  /** Set or clear the "working…" spinner message. Pass `undefined` to clear. */
  setWorkingMessage?(message?: string): void;
  /** Set or clear a custom footer below the message box. Pass `undefined` to remove. */
  setFooter?(factory: ((tui: unknown, theme: WidgetTheme) => RenderableWidget & { dispose?(): void }) | undefined): void;
  /**
   * Show a single-line text input dialog and wait for the user's response.
   * Resolves with the entered string on success, or `undefined` if the user
   * cancels (e.g., presses Escape).
   */
  input?(prompt: string, placeholder?: string): Promise<string | undefined>;
}

/** Provider and model identifier for the active LLM, as reported by pi. */
interface ModelInfo {
  /** Provider key (e.g., `"anthropic"`, `"openai"`, `"google"`). */
  provider: string;
  /** Model identifier within the provider (e.g., `"claude-sonnet-4-20250514"`). */
  id: string;
}

/** Runtime context passed to every slash-command handler by pi. */
interface CommandContext {
  /** Absolute path to the project working directory. */
  cwd: string;
  /** Active model info, if a model is configured. */
  model?: ModelInfo;
  /** Optional UI surface for notifications, status bar, and widgets. */
  ui?: UiApi;
}

/** Shape of a `tool_call` event emitted by pi before executing a tool. */
interface ToolCallEvent {
  /** Name of the tool being invoked (e.g., `"bash"`, `"edit"`, `"write"`). */
  toolName?: string;
  /** Tool-specific arguments. */
  args?: {
    /** Bash command string (only present when `toolName === "bash"`). */
    command?: string;
    /** Target file path (only present for `edit` / `write` tools). */
    file_path?: string;
  };
}

/** Async function signature for a pi slash-command handler. */
interface CommandHandler {
  (args: string, ctx: CommandContext): Promise<void>;
}

/**
 * Pi extension API — the surface available to every extension's default export.
 *
 * Provides command registration, event hooks, conversation entry logging,
 * and an optional `exec` helper for running subprocesses.
 */
interface ExtensionAPI {
  /** Register a new slash command (e.g., `/build`). */
  registerCommand(name: string, opts: { description: string; handler: CommandHandler }): void;
  /** Subscribe to a named lifecycle event (e.g., `"session_start"`, `"tool_call"`). */
  on(event: string, handler: (...args: unknown[]) => Promise<unknown>): void;
  /** Append a structured entry to the conversation log. */
  appendEntry(type: string, data: unknown): void;
  /**
   * Execute a subprocess. Optional — falls back to `child_process.spawn` when absent.
   * Supports `signal` for cancellation and `timeout` in milliseconds.
   */
  exec?(
    cmd: string,
    args: string[],
    opts?: { signal?: AbortSignal; timeout?: number },
  ): Promise<{ stdout: string; stderr: string; code: number }>;
}

/** State for a single agent slot in the multi-agent widget. */
interface AgentSlot {
  agent: string;
  taskLabel: string;
  progress: string;
  toolCount: number;
  startTime: number;
  status: "running" | "done";
  tokens?: number;
  cost?: number;
  doneAt?: number;
}

/** Tracked task in the widget task list. */
interface TaskSlot {
  id: string;
  title: string;
  status: string;
  tokens: number;
}

/** Synthetic pipeline step representing a build phase. */
interface PipelineStep {
  id: string;
  title: string;
  status: "pending" | "in-progress" | "complete";
  tokens: number;
}

const PIPELINE_STEPS: { id: string; title: string }[] = [
  { id: "phase0", title: "Refine idea" },
  { id: "phase1", title: "Write specification" },
  { id: "phase2", title: "Break down tasks" },
  // phase3 tasks get inserted here dynamically
  { id: "phase4", title: "Generate summary" },
];

function createPipelineSteps(): PipelineStep[] {
  return PIPELINE_STEPS.map(s => ({ ...s, status: "pending" as const, tokens: 0 }));
}

/** Mutable state backing the live MLST multi-agent widget in pi's TUI. */
interface WidgetState {
  ctx: CommandContext | null;
  phase: string;
  phaseDetail: string;
  agents: Map<string, AgentSlot>;
  tasks: Map<string, TaskSlot>;
  pipeline: PipelineStep[];
  /** Tracks which pipeline step is currently active (for attributing untasked agents). */
  activePipelineId: string | null;
  elapsedStart: number;
  spinnerFrame: number;
  spinnerTimer: ReturnType<typeof setInterval> | null;
}

/** Max recent completed tasks to show individually (earlier ones collapsed to summary). */
const MAX_DONE_VISIBLE = 5;
/** Max pending tasks to show in the widget (rest collapsed). */
const MAX_PENDING_VISIBLE = 5;

/** Color theme tokens and initials per agent type for visual differentiation. */
const AGENT_STYLES: Record<string, { color: string; initial: string }> = {
  "mlst-designer":       { color: "accent",  initial: "D" },
  "mlst-spec-writer":    { color: "accent",  initial: "S" },
  "mlst-impl-engineer":  { color: "success", initial: "I" },
  "mlst-test-runner":    { color: "warning", initial: "T" },
  "mlst-reviewer":       { color: "info",    initial: "R" },
  "mlst-scrum-master":   { color: "muted",   initial: "M" },
};

function agentStyle(name: string): { color: string; initial: string } {
  return AGENT_STYLES[name] ?? { color: "dim", initial: name.charAt(0).toUpperCase() };
}

/** Duration after agent_end before the completed slot is removed from the widget. */
const DONE_FADE_MS = 5_000;

/** Cumulative cost/token totals per agent type for the footer. */
interface AgentTotals {
  tokens: number;
  cost: number;
  runs: number;
}

/** Footer state tracking per-agent cumulative stats across the build. */
interface FooterState {
  ctx: CommandContext | null;
  agentTotals: Map<string, AgentTotals>;
  startTime: number;
  totalCost: number;
  totalTokens: number;
  dashboardUrl: string;
}

/** Braille-dot animation frames for the TUI spinner, cycled at 80 ms intervals. */
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Absolute path to the directory containing this module (`.pi/extensions/mlst/`). */
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the plugin root directory (three levels up from the extension source).
 *
 * Layout: `<plugin-root>/.pi/extensions/mlst/index.ts` → returns `<plugin-root>`.
 *
 * @returns Absolute path to the plugin package root.
 */
function resolvePluginRoot(): string {
  return path.resolve(MODULE_DIR, "..", "..", "..");
}

/**
 * Resolve a named resource directory (e.g., `"agents"`, `"skills"`, `"templates"`).
 *
 * Checked in order:
 * 1. Co-located inside the extension — how `scripts/install.js` lays things out,
 *    so an installed extension is self-contained.
 * 2. The package root — where pi-specific resources like `agents/` live.
 * 3. The repo root — where `skills/` and `templates/` are shared with the Claude
 *    Code plugin and the CLI. See the monorepo CLAUDE.md.
 *
 * @param name - Directory name to resolve.
 * @returns Absolute path to the resource directory. Falls back to the repo-root
 *   path when none exist, letting callers degrade gracefully.
 */
function resolveResourceDir(name: string): string {
  const pluginRoot = resolvePluginRoot();
  const candidates = [
    path.join(MODULE_DIR, name),
    path.join(pluginRoot, name),
    // packages/mlst-pi → packages → repo root
    path.join(pluginRoot, "..", "..", name),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[candidates.length - 1];
}

// ─── GitHub Issue Resolution ─────────────────────────────────────────────

/**
 * A parsed reference to a GitHub issue.
 *
 * - Bare refs (`#25`) have only `number`; `owner` and `repo` are inferred at fetch time.
 * - Explicit refs (`owner/repo#25`) include all three fields.
 */
export interface GithubIssueRef {
  /** Repository owner (GitHub user or org). Undefined for bare `#N` refs. */
  owner?: string;
  /** Repository name. Undefined for bare `#N` refs. */
  repo?: string;
  /** Issue number (always present). */
  number: number;
}

/**
 * A fetched GitHub issue with the fields needed for build input.
 *
 * Returned by {@link fetchGitHubIssue} after a successful `gh issue view` call.
 */
export interface GithubIssue {
  /** Issue number. */
  number: number;
  /** Issue title (always present — fetch throws if missing). */
  title: string;
  /** Issue body markdown, or `null` if the issue has no body. */
  body: string | null;
}

/**
 * Subprocess execution function signature.
 *
 * Used as an injection seam so that {@link fetchGitHubIssue} and
 * {@link inferRepoFromGitRemote} can be tested without spawning real processes.
 *
 * @param cmd  - Executable name (e.g., `"git"`, `"gh"`).
 * @param args - Argument array passed to the subprocess.
 * @param opts - Optional settings; currently only `timeout` (milliseconds).
 * @returns Resolved result with `stdout`, `stderr`, and exit `code`.
 */
export type ExecFn = (
  cmd: string,
  args: string[],
  opts?: { timeout?: number },
) => Promise<{ stdout: string; stderr: string; code: number }>;

/** Default exec implementation used by `fetchGitHubIssue` (spawn-based, no pi dependency). */
const defaultExecFn = (
  cmd: string,
  args: string[],
  opts?: { timeout?: number },
): Promise<{ stdout: string; stderr: string; code: number }> => {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data: Buffer) => { stdout += data; });
    proc.stderr?.on("data", (data: Buffer) => { stderr += data; });

    const timer =
      opts?.timeout != null
        ? setTimeout(() => {
            proc.kill();
            resolve({ stdout, stderr: stderr + "\nProcess timed out.", code: 1 });
          }, opts.timeout)
        : null;

    proc.on("close", (code: number | null) => {
      if (timer) clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? 1 });
    });

    proc.on("error", () => {
      if (timer) clearTimeout(timer);
      resolve({ stdout, stderr, code: 1 });
    });
  });
}

/** Regex matching a bare issue reference: `#<number>` (whole-input only). */
const ISSUE_BARE_RE = /^#(\d+)$/;

/** Regex matching an explicit issue reference: `owner/repo#<number>` (whole-input only). */
const ISSUE_EXPLICIT_RE = /^([\w.-]+)\/([\w.-]+)#(\d+)$/;

/**
 * Detect a GitHub issue reference in the input string (whole-input only).
 *
 * Supported patterns:
 * - `#25`            — bare issue ref (repo inferred from `git remote`)
 * - `owner/repo#25` — explicit repo ref
 *
 * @param input - Trimmed user input string.
 * @returns A `GithubIssueRef` object or `null` if no pattern matches.
 */
export function detectGitHubIssueRef(input: string): GithubIssueRef | null {
  const trimmed = input.trim();

  const bare = ISSUE_BARE_RE.exec(trimmed);
  if (bare) return { number: parseInt(bare[1], 10) };

  const explicit = ISSUE_EXPLICIT_RE.exec(trimmed);
  if (explicit) return { owner: explicit[1], repo: explicit[2], number: parseInt(explicit[3], 10) };

  return null;
}

/**
 * Infer the GitHub `owner/repo` from the git remote URL of the current working directory.
 *
 * Supports SSH (`git@github.com:owner/repo.git`) and HTTPS
 * (`https://github.com/owner/repo[.git]`) remote URL formats.
 *
 * @throws `Error` if git fails or the remote URL is not a GitHub URL.
 */
async function inferRepoFromGitRemote(
  cwd: string,
  execFn: ExecFn,
): Promise<{ owner: string; repo: string }> {
  const result = await execFn("git", ["remote", "get-url", "origin"], { timeout: 10000 });
  if (result.code !== 0) {
    throw new Error(
      "Could not determine GitHub repo from git remote. Use owner/repo#N syntax instead.",
    );
  }

  const url = result.stdout.trim();

  // SSH: git@github.com:owner/repo.git
  const ssh = /github.com[:\/]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(url); // [:\/] matches ':' in SSH URLs and '/' in HTTPS URLs
  if (ssh) return { owner: ssh[1], repo: ssh[2] };

  // HTTPS: https://github.com/owner/repo[.git]
  const https = /github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(url);
  if (https) return { owner: https[1], repo: https[2] };

  throw new Error(
    `Could not determine GitHub repo from git remote URL: ${url}. Use owner/repo#N syntax instead.`,
  );
}

/**
 * Fetch a GitHub issue via the `gh` CLI.
 *
 * When `ref` has no explicit `owner`/`repo`, the repo is inferred from
 * `git remote get-url origin` in `cwd`.
 *
 * @param ref     - Issue reference (bare `#N` or explicit `owner/repo#N`).
 * @param cwd     - Project working directory for git remote inference.
 * @param execFn  - Optional exec override for testing (injection seam).
 *   The `gh issue view` call is made with a 30-second (30,000 ms) timeout.
 * @throws `Error` on `gh` not found, auth failure, issue-not-found, or malformed response.
 */
export async function fetchGitHubIssue(
  ref: GithubIssueRef,
  cwd: string,
  execFn: ExecFn = defaultExecFn,
): Promise<GithubIssue> {
  // 1. Resolve owner/repo
  let owner = ref.owner;
  let repo = ref.repo;
  if (!owner || !repo) {
    const remote = await inferRepoFromGitRemote(cwd, execFn);
    owner = remote.owner;
    repo = remote.repo;
  }

  // 2. Check gh availability
  const ghCheck = await execFn("gh", ["--version"], { timeout: 5000 });
  if (ghCheck.code !== 0) {
    throw new Error(
      "gh CLI not found — install it and run 'gh auth login' before using issue references",
    );
  }

  // 3. Fetch issue JSON
  const result = await execFn(
    "gh",
    ["issue", "view", String(ref.number), "--repo", `${owner}/${repo}`, "--json", "number,title,body"],
    { timeout: 30000 },
  );

  if (result.code !== 0) {
    throw new Error(
      `Failed to fetch GitHub issue #${ref.number}: ${
        result.stderr.trim() || "unknown error"
      }`,
    );
  }

  // 4. Parse and validate JSON
  let parsed: { number?: number; title?: string; body?: string | null };
  try {
    parsed = JSON.parse(result.stdout) as typeof parsed;
  } catch {
    throw new Error(
      `Unexpected response from gh while fetching issue #${ref.number}: invalid JSON`,
    );
  }

  if (!parsed.title) {
    throw new Error(
      `Unexpected response from gh — missing title field for issue #${ref.number}`,
    );
  }

  return {
    number: parsed.number ?? ref.number,
    title: parsed.title,
    body: parsed.body ?? null,
  };
}

/**
 * Format a fetched GitHub issue as structured text for the orchestrator.
 *
 * Output format:
 * ```
 * GitHub Issue #<N>: <title>
 *
 * <body>
 * ```
 * If `body` is null or blank, only the title line is emitted.
 *
 * @param issue - A `GithubIssue` returned by `fetchGitHubIssue`.
 * @returns Formatted string.
 */
export function formatIssueText(issue: GithubIssue): string {
  const header = `GitHub Issue #${issue.number}: ${issue.title}`;
  if (!issue.body || !issue.body.trim()) return header;
  return `${header}\n\n${issue.body}`;
}

/**
 * Resolve user input by expanding file references inline.
 *
 * Three resolution modes (checked in order):
 * 1. **GitHub issue ref** — if the entire trimmed input is `#N` or `owner/repo#N`,
 *    fetches the issue via the `gh` CLI and returns formatted title + body.
 *    The fetched body is NOT re-processed for `@file` references — it is returned
 *    as-is to avoid unintentional file reads from arbitrary issue content.
 * 2. **Bare path** — if `input` matches `^[\w./-]+\.\w+$` (looks like a lone file path),
 *    attempts to read the file and returns its content. Falls through to the original
 *    string if the file does not exist or cannot be read.
 * 3. **`@file` references** — replaces every `@<path>` token within the input string
 *    with the file's content (allows mixing prose with referenced files).
 *
 * @param input - Raw user input string, potentially containing file paths or `@file` refs.
 * @param cwd   - Project working directory; all paths are resolved relative to this.
 * @returns The input string with all resolvable references replaced.
 */
export async function resolveInput(input: string, cwd: string): Promise<string> {
  const trimmed = input.trim();

  // GitHub issue reference check (runs before file-path check — `#25` is not a valid file path)
  const issueRef = detectGitHubIssueRef(trimmed);
  if (issueRef) {
    const issue = await fetchGitHubIssue(issueRef, cwd);
    return formatIssueText(issue);
  }

  // If the entire input looks like a file path (e.g., "PRD.md", "docs/spec.md"), try to read it
  if (/^[\w./-]+\.\w+$/.test(trimmed)) {
    const content = readReferencedFile(trimmed, cwd);
    if (content) return content;
  }

  // Inline @file references within the input (e.g., "build auth per @PRD.md")
  // Supports quoted paths for filenames with spaces: @"path/to/my file.md"
  return trimmed.replace(/@"([^"]+)"|@([\w./-]+)/g, (match, quotedPath, unquotedPath) => {
    const filePath = quotedPath ?? unquotedPath;
    const content = readReferencedFile(filePath, cwd);
    return content ?? match;
  });
}

/**
 * Safely read a file referenced from user input.
 *
 * **Security:** enforces two path-safety rules:
 * 1. Absolute paths are rejected (`null`) — only project-relative paths are allowed.
 * 2. Resolved paths that escape the project root (path traversal via `../`) are rejected.
 *    The resolved path must start with `path.resolve(cwd) + path.sep`.
 *
 * @param filePath - Relative file path from user input (e.g., `"docs/PRD.md"`).
 * @param cwd      - Project working directory to resolve against.
 * @returns File content as a UTF-8 string, or `null` if the path is unsafe or unreadable.
 */
export function readReferencedFile(filePath: string, cwd: string): string | null {
  if (path.isAbsolute(filePath)) return null;
  const resolved = path.resolve(cwd, filePath);
  if (!resolved.startsWith(path.resolve(cwd) + path.sep)) return null;

  try {
    return fs.readFileSync(resolved, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Extract the active model as a `"provider/id"` string for passing to subprocesses.
 *
 * Returns `undefined` (rather than throwing) when no model is configured — agent
 * subprocesses then fall back to their own configured model or pi's default.
 *
 * @param ctx - The command context from pi.
 * @returns A `"provider/id"` string (e.g., `"anthropic/claude-opus-4-5"`), or `undefined`.
 */
export function getModelString(ctx: CommandContext): string | undefined {
  const model = ctx.model;
  if (!model?.provider || !model.id) {
    return undefined;
  }

  return `${model.provider}/${model.id}`;
}

/**
 * Create a {@link StateManagerDeps} adapter that bridges pi's UI API to
 * the state manager's dependency interface.
 *
 * @param ctx - Command context providing the UI surface.
 * @returns Dependency object wired to the context's UI methods.
 */
function createStateManagerDeps(ctx: CommandContext): StateManagerDeps {
  return {
    appendEntry: () => {},
    setStatus: (key, value) => ctx.ui?.setStatus?.(key, value),
    setWidget: (key, lines) => ctx.ui?.setWidget?.(key, lines),
    notify: (message, level) => ctx.ui?.notify?.(message, level),
  };
}

/**
 * Create a fresh {@link WidgetState} with all fields at their idle defaults.
 *
 * @returns A new widget state object ready to be activated by {@link startWidget}.
 */
function createWidgetState(): WidgetState {
  return {
    ctx: null,
    phase: "",
    phaseDetail: "",
    agents: new Map(),
    tasks: new Map(),
    pipeline: createPipelineSteps(),
    activePipelineId: null,
    elapsedStart: 0,
    spinnerFrame: 0,
    spinnerTimer: null,
  };
}

/**
 * Push the current widget state to pi's TUI for immediate re-render.
 *
 * No-ops when `widget.ctx` is `null` (widget not active).
 *
 * @param widget - The live widget state to render.
 */
function updateWidget(widget: WidgetState): void {
  const ctx = widget.ctx;
  if (!ctx) {
    return;
  }

  ctx.ui?.setWidget?.("mlst-live", (_tui, theme) => createLiveWidget(widget, theme));
}

/** Format an agent name for display: strip `mlst-` prefix, uppercase, replace hyphens. */
function shortAgent(name: string): string {
  return name.replace(/^mlst-/, "").replace(/-/g, " ").toUpperCase();
}

/** Format seconds as a compact elapsed string. */
function fmtElapsed(ms: number): string {
  const sec = Math.round(ms / 1000);
  return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m${sec % 60}s`;
}

/** Format token count as compact string (e.g., "14.2k"). */
function fmtTokens(n: number): string {
  return n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`;
}

/**
 * Build a {@link RenderableWidget} showing all active agents with live status.
 *
 * Renders: phase header with task counter, agent cards with box drawing,
 * and completed agent summaries with tokens/cost during the fade window.
 */
/** Task status icons for the task list. */
const TASK_ICONS: Record<string, string> = {
  pending: "○", open: "○", blocked: "⊘",
  "in-progress": "◐", in_progress: "◐", testing: "◑", reviewing: "◕",
  complete: "✓", closed: "✓", escalated: "✗",
};

/** Unified item type for the pipeline view — can be a phase step or a real task. */
interface PipelineItem {
  id: string;
  title: string;
  status: string;
  tokens: number;
  isPhase: boolean;
}

function createLiveWidget(widget: WidgetState, theme: WidgetTheme): RenderableWidget {
  const spinner = SPINNER_FRAMES[widget.spinnerFrame % SPINNER_FRAMES.length];
  const now = Date.now();

  // Evict done agents past the fade window
  for (const [key, slot] of widget.agents) {
    if (slot.status === "done" && slot.doneAt && now - slot.doneAt > DONE_FADE_MS) {
      widget.agents.delete(key);
    }
  }

  const bold = theme.bold ?? ((s: string) => s);
  const inverse = theme.inverse ?? ((s: string) => s);

  return {
    render(width: number) {
      const lines: string[] = [];
      const maxW = Math.max(width - 12, 20);
      const runningAgents = [...widget.agents.values()].filter(a => a.status === "running");

      // Build unified pipeline: pre-task phases + real tasks + post-task phases
      const items: PipelineItem[] = [];
      const prePhases = widget.pipeline.filter(s => s.id !== "phase4");
      const postPhases = widget.pipeline.filter(s => s.id === "phase4");
      for (const s of prePhases) items.push({ id: s.id, title: s.title, status: s.status, tokens: s.tokens, isPhase: true });
      for (const t of widget.tasks.values()) items.push({ id: t.id, title: t.title, status: t.status, tokens: t.tokens, isPhase: false });
      for (const s of postPhases) items.push({ id: s.id, title: s.title, status: s.status, tokens: s.tokens, isPhase: true });

      const doneItems = items.filter(i => i.status === "complete" || i.status === "closed");
      const activeItems = items.filter(i => i.status === "in-progress" || i.status === "testing" || i.status === "reviewing");
      const pendingItems = items.filter(i => i.status === "pending" || i.status === "open" || i.status === "blocked");
      const escalatedItems = items.filter(i => i.status === "escalated");

      // ─── Header ───
      if (widget.phase) {
        const elapsed = fmtElapsed(now - widget.elapsedStart);
        const isRunning = widget.phase !== "Complete";
        const prefix = isRunning ? theme.fg("accent", spinner) : theme.fg("success", "✓");
        const counter = theme.fg("dim", `  ${doneItems.length}/${items.length} steps`);
        const concurrency = runningAgents.length > 1 ? theme.fg("dim", `  ×${runningAgents.length}`) : "";
        lines.push(`  ${prefix} ${bold(theme.fg("accent", "MLST Build"))}${counter}${concurrency}  ${theme.fg("dim", elapsed)}`);
        lines.push("");
      }

      // ─── Completed items (last 5, earlier collapsed) ───
      const hiddenDone = doneItems.length - MAX_DONE_VISIBLE;
      if (hiddenDone > 0) {
        lines.push(`  ${theme.fg("success", "✓")} ${theme.fg("dim", `${hiddenDone} earlier step${hiddenDone > 1 ? "s" : ""} completed`)}`);
      }
      for (const item of doneItems.slice(-MAX_DONE_VISIBLE)) {
        const tokStr = item.tokens > 0 ? theme.fg("dim", `  ${fmtTokens(item.tokens)}`) : "";
        const label = item.isPhase ? theme.fg("dim", item.title) : `${theme.fg("dim", item.id)}  ${theme.fg("dim", item.title)}`;
        lines.push(`  ${theme.fg("success", "✓")} ${label}${tokStr}`);
      }

      // ─── Escalated items ───
      for (const item of escalatedItems) {
        const title = item.title.length > maxW ? item.title.slice(0, maxW - 3) + "..." : item.title;
        lines.push(`  ${theme.fg("warning", "✗")} ${theme.fg("warning", item.id)}  ${theme.fg("dim", title)}`);
      }

      // ─── Active items (with agent info) ───
      for (const item of activeItems) {
        const icon = TASK_ICONS[item.status] ?? "◐";
        const agent = runningAgents.find(a => a.taskLabel === item.id);

        if (agent) {
          const style = agentStyle(agent.agent);
          const badge = theme.fg(style.color, inverse(` ${style.initial} `));
          const elapsed = fmtElapsed(now - agent.startTime);
          const tools = agent.toolCount > 0 ? theme.fg("dim", ` 🔧 ${agent.toolCount}`) : "";
          const rawLabel = item.isPhase ? item.title : `${item.id}  ${item.title}`;
          const rawTrunc = rawLabel.length > maxW - 20 ? rawLabel.slice(0, maxW - 23) + "..." : rawLabel;
          const titleTrunc = item.isPhase ? rawTrunc : `${bold(rawTrunc.slice(0, item.id.length))}${rawTrunc.slice(item.id.length)}`;
          lines.push(`  ${theme.fg("accent", icon)} ${titleTrunc}  ${badge}${tools} ${theme.fg("dim", elapsed)}`);

          if (agent.progress) {
            const prog = agent.progress.length > maxW - 4 ? agent.progress.slice(0, maxW - 7) + "..." : agent.progress;
            lines.push(`    ${theme.fg(style.color, "│")} ${theme.fg("muted", prog)}`);
          }
        } else {
          const label = item.isPhase ? item.title : `${theme.fg("accent", item.id)}  ${item.title}`;
          lines.push(`  ${theme.fg("accent", icon)} ${label}`);
        }
      }

      // ─── Pending items (capped) ───
      const visiblePending = pendingItems.slice(0, MAX_PENDING_VISIBLE);
      const hiddenPending = pendingItems.length - visiblePending.length;
      for (const item of visiblePending) {
        const title = item.title.length > maxW ? item.title.slice(0, maxW - 3) + "..." : item.title;
        const label = item.isPhase ? title : `${item.id}  ${title}`;
        lines.push(`  ${theme.fg("dim", "○")} ${theme.fg("dim", label)}`);
      }
      if (hiddenPending > 0) {
        lines.push(`  ${theme.fg("dim", `  +${hiddenPending} more pending`)}`);
      }

      if (lines.length === 0) {
        lines.push(theme.fg("dim", `  ${spinner} MLST idle`));
      }

      const text = new Text(lines.join("\n"), 0, 0);
      return text.render(width);
    },
    invalidate() {},
  };
}

/**
 * Reset all display fields in the widget state to empty/zero without
 * stopping the spinner timer or clearing the context.
 */
function resetWidget(widget: WidgetState): void {
  widget.phase = "";
  widget.phaseDetail = "";
  widget.agents.clear();
  widget.tasks.clear();
  widget.pipeline = createPipelineSteps();
  widget.activePipelineId = null;
}

/**
 * Activate the live widget: bind to a command context, start the spinner
 * animation timer (80 ms interval), and push an initial render.
 *
 * @param widget - Widget state to activate.
 * @param ctx    - Command context providing the UI surface.
 */
function startWidget(widget: WidgetState, ctx: CommandContext): void {
  widget.ctx = ctx;
  widget.phase = "Starting...";
  widget.phaseDetail = "";
  widget.agents.clear();
  widget.tasks.clear();
  widget.pipeline = createPipelineSteps();
  widget.activePipelineId = null;
  widget.elapsedStart = Date.now();
  widget.spinnerFrame = 0;
  widget.spinnerTimer = setInterval(() => {
    widget.spinnerFrame++;
    updateWidget(widget);
  }, 80);
  updateWidget(widget);
}

/**
 * Deactivate the live widget: stop the spinner timer, remove the widget
 * from pi's TUI, and clear all state fields.
 *
 * @param widget - Widget state to deactivate.
 */
function stopWidget(widget: WidgetState): void {
  if (widget.spinnerTimer) {
    clearInterval(widget.spinnerTimer);
    widget.spinnerTimer = null;
  }

  const ctx = widget.ctx;
  if (ctx) {
    ctx.ui?.setWidget?.("mlst-live", undefined);
  }

  widget.ctx = null;
  resetWidget(widget);
}

// ─── Footer: per-agent cost/token tree ───────────────────────────────────────

function createFooterState(): FooterState {
  return { ctx: null, agentTotals: new Map(), startTime: 0, totalCost: 0, totalTokens: 0, dashboardUrl: "" };
}

function startFooter(footer: FooterState, ctx: CommandContext, dashboardUrl?: string): void {
  footer.ctx = ctx;
  footer.agentTotals.clear();
  footer.startTime = Date.now();
  footer.totalCost = 0;
  footer.totalTokens = 0;
  footer.dashboardUrl = dashboardUrl ?? "";
  updateFooter(footer);
}

function stopFooter(footer: FooterState): void {
  footer.ctx?.ui?.setFooter?.(undefined);
  footer.ctx = null;
}

function applyFooterEvent(footer: FooterState, event: MlstEvent): void {
  if (event.type !== "agent_end") return;
  const tokens = (event.usage?.input ?? 0) + (event.usage?.output ?? 0);
  const cost = event.usage?.cost ?? 0;
  const existing = footer.agentTotals.get(event.agent);
  if (existing) {
    existing.tokens += tokens;
    existing.cost += cost;
    existing.runs++;
  } else {
    footer.agentTotals.set(event.agent, { tokens, cost, runs: 1 });
  }
  footer.totalCost += cost;
  footer.totalTokens += tokens;
  updateFooter(footer);
}

function updateFooter(footer: FooterState): void {
  const ctx = footer.ctx;
  if (!ctx) return;

  ctx.ui?.setFooter?.((_tui, theme) => {
    const bold = theme.bold ?? ((s: string) => s);

    return {
      dispose() {},
      invalidate() {},
      render(width: number): string[] {
        const elapsed = fmtElapsed(Date.now() - footer.startTime);
        const lines: string[] = [];

        // Header: project name | elapsed | dashboard link
        const dashLink = footer.dashboardUrl ? `  ${theme.fg("accent", footer.dashboardUrl)}` : "";
        lines.push(`${bold("mlst")} ${theme.fg("dim", "│")} ${theme.fg("dim", elapsed)}${dashLink}`);

        // Agent tree
        const agents = [...footer.agentTotals.entries()];
        for (let i = 0; i < agents.length; i++) {
          const [name, totals] = agents[i];
          const isLast = i === agents.length - 1;
          const connector = isLast ? "└─" : "├─";
          const style = agentStyle(name);
          const displayName = bold(theme.fg(style.color, shortAgent(name)));
          const costStr = theme.fg("warning", `$${totals.cost.toFixed(3)}`);
          const tokStr = theme.fg("dim", `${fmtTokens(totals.tokens)}`);
          lines.push(` ${theme.fg("accent", connector)} ${theme.fg(style.color, "◆")} ${displayName} ${costStr} ${tokStr}`);
        }

        // Total line
        if (agents.length > 0) {
          const totalCost = theme.fg("warning", `$${footer.totalCost.toFixed(3)}`);
          const totalTok = theme.fg("dim", fmtTokens(footer.totalTokens));
          lines.push(theme.fg("dim", `   Total: ${totalCost} ${totalTok}`));
        }

        return new Text(lines.join("\n"), 0, 0).render(width) as string[];
      },
    };
  });
}

/** Map from internal phase identifiers to human-readable display labels. */
const PHASE_DISPLAY: Record<string, string> = {
  phase0: "Idea Refinement",
  phase1: "Specification",
  phase2: "Task Breakdown",
  scaffold: "Scaffolding",
  phase3: "Building",
  phase4: "Completion",
  "fast-path": "Bug Fix",
  "impl-fast-path": "Implementation",
};

/**
 * Apply an orchestrator event to the widget state and trigger a re-render.
 *
 * Handles `phase`, `agent_start`, `agent_end`, and `sprint_end` events.
 * Other event types are ignored (no-op).
 *
 * @param widget - The live widget state to update.
 * @param event  - An {@link MlstEvent} emitted by the orchestrator.
 */
function applyWidgetEvent(widget: WidgetState, event: MlstEvent): void {
  switch (event.type) {
    case "phase": {
      widget.phase = PHASE_DISPLAY[event.phase] ?? event.phase;
      widget.agents.clear();
      // Mark all earlier pipeline steps as complete (handles skipped phases)
      const stepIdx = widget.pipeline.findIndex(s => s.id === event.phase);
      // For unknown phases (phase3/scaffold), mark pre-task steps complete but NOT phase4
      const phase4Idx = widget.pipeline.findIndex(s => s.id === "phase4");
      const cutoff = stepIdx === -1 ? (phase4Idx === -1 ? widget.pipeline.length : phase4Idx) : stepIdx;
      for (let i = 0; i < cutoff; i++) {
        if (widget.pipeline[i].status !== "complete") widget.pipeline[i].status = "complete";
      }
      const step = stepIdx >= 0 ? widget.pipeline[stepIdx] : undefined;
      if (step) {
        step.status = "in-progress";
        widget.activePipelineId = step.id;
      } else {
        // phase3 (execution) — no synthetic step, but mark as active context
        widget.activePipelineId = event.phase;
      }
      break;
    }
    case "agent_start": {
      const key = `${event.agent}:${event.taskLabel}`;
      // For untasked agents, use the active pipeline step id as taskLabel
      const effectiveLabel = event.taskLabel || widget.activePipelineId || "";
      widget.agents.set(key, {
        agent: event.agent,
        taskLabel: effectiveLabel,
        progress: "",
        toolCount: 0,
        startTime: Date.now(),
        status: "running",
      });
      break;
    }
    case "agent_end": {
      const key = `${event.agent}:${event.taskLabel}`;
      const slot = widget.agents.get(key);
      if (slot) {
        slot.status = "done";
        const tokens = (event.usage?.input ?? 0) + (event.usage?.output ?? 0);
        slot.tokens = tokens;
        slot.cost = event.usage?.cost ?? 0;
        slot.doneAt = Date.now();
        // Attribute tokens to the task or pipeline step
        const task = widget.tasks.get(slot.taskLabel);
        if (task) {
          task.tokens += tokens;
        } else {
          const step = widget.pipeline.find(s => s.id === slot.taskLabel);
          if (step) step.tokens += tokens;
        }
      }
      break;
    }
    case "agent_progress": {
      const key = `${event.agent}:${event.taskLabel}`;
      const slot = widget.agents.get(key);
      if (slot) {
        slot.progress = event.text;
        slot.toolCount = event.toolCount;
      }
      break;
    }
    case "task": {
      const existing = widget.tasks.get(event.id);
      if (existing) {
        existing.status = event.status;
        if (event.title) existing.title = event.title;
      } else {
        widget.tasks.set(event.id, { id: event.id, title: event.title || "", status: event.status, tokens: 0 });
      }
      break;
    }
    case "sprint_end":
      widget.phase = "Complete";
      widget.agents.clear();
      for (const step of widget.pipeline) {
        if (step.status === "in-progress") step.status = "complete";
      }
      break;
    case "human_gate":
      widget.phase = `Gate: ${event.gate} [${event.status}]`;
      break;
    default:
      return;
  }

  updateWidget(widget);
}

/**
 * Legacy progress callback — now a no-op since agent_progress events are
 * handled directly in applyWidgetEvent. Kept to satisfy the orchestrator's
 * onAgentProgress callback contract.
 */
function setWidgetProgress(_widget: WidgetState, _text: string, _toolCount: number): void {
  // Progress is now applied via agent_progress events in applyWidgetEvent.
}

export const __test__: {
  createWidgetState(): any;
  applyWidgetEvent(widget: any, event: MlstEvent): void;
  createFooterState(): any;
  applyFooterEvent(footer: any, event: MlstEvent): void;
  agentStyle(name: string): { color: string; initial: string };
  shortAgent(name: string): string;
  fmtElapsed(ms: number): string;
  fmtTokens(n: number): string;
  isSubprocessInvocation(argv: string[]): boolean;
  promptUserForClarification(ctx: any, question: string, context?: string): Promise<string | null>;
  execCommand(pi: any, cwd: string, cmd: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }>;
} = {
  createWidgetState,
  applyWidgetEvent,
  createFooterState,
  applyFooterEvent,
  agentStyle,
  shortAgent,
  fmtElapsed,
  fmtTokens,
  isSubprocessInvocation,
  promptUserForClarification,
  execCommand,
};

/**
 * Acquire the singleton dashboard server and create a new session.
 * Registers the session-specific URL in pi's status bar.
 *
 * @param ctx - Command context providing `cwd` and UI surface.
 * @returns A {@link SessionHandle} scoped to this build/resume invocation.
 */
function startDashboard(ctx: CommandContext): SessionHandle {
  const dashboard = Dashboard.acquire();
  const session = dashboard.createSession(ctx.cwd);
  ctx.ui?.setStatus?.("mlst-dashboard", session.url);
  return session;
}

/**
 * End a dashboard session, notify the user of the log path, and
 * clear the status bar entry. Does not shut down the server if other sessions
 * are still active.
 *
 * @param ctx     - Command context providing the UI surface.
 * @param session - The session handle to stop.
 */
function stopDashboard(ctx: CommandContext, session: SessionHandle): void {
  if (session.runLogPath) {
    ctx.ui?.notify?.(`Session log: ${session.runLogPath}`, "info");
  }

  session.stop();
  ctx.ui?.setStatus?.("mlst-dashboard", undefined);
}

/**
 * Show a usage warning when `/build` is invoked with no arguments.
 *
 * @param ctx - Command context providing the UI surface.
 */
function notifyMissingBuildArgs(ctx: CommandContext): void {
  ctx.ui?.notify?.("Usage: /build <description>", "warning");
}

/**
 * Check whether the current process was launched as an MLST subprocess.
 *
 * Returns `true` when `argv` contains `-p` or `--mode`, which are flags
 * used by spawned agent subprocesses. This prevents the extension from
 * loading recursively inside its own child processes.
 *
 * @param argv - Process argument vector (typically `process.argv`).
 * @returns `true` if this is a subprocess invocation.
 */
function isSubprocessInvocation(argv: string[]): boolean {
  return argv.includes("-p") || argv.includes("--mode");
}

/**
 * Determine whether a tool call should be blocked on the main orchestrator agent.
 *
 * `edit` and `write` are blocked at the orchestrator level so that only spawned
 * sub-agents may modify files during a build run. This prevents the orchestrator
 * from accidentally overwriting work in progress while agents are running.
 *
 * @param toolName - The name of the tool being called (from the `tool_call` event).
 * @returns `true` if the tool should be blocked, `false` otherwise.
 */
export function isBlockedTool(toolName?: string): boolean {
  return toolName === "edit" || toolName === "write";
}

// ─── Catastrophic Command Blocklist ──────────────────────────────────────

/**
 * Regex patterns matching catastrophic / destructive bash commands.
 *
 * Each pattern targets a specific class of dangerous operation:
 * recursive `rm`, wildcard `rm -f`, `git reset --hard`, `git clean`,
 * `git checkout .`, `git push --force`, force branch deletion, `rmdir`,
 * and `find -delete` / `find -exec rm`.
 */
const CATASTROPHIC_BASH_PATTERNS: RegExp[] = [
  /\brm\s+(-[a-zA-Z]*[rR]|--recursive)/,       // rm -r, rm -rf, rm -Rf
  /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+).*\*/,      // rm -f with wildcards
  /\bgit\s+reset\s+--hard/,                      // git reset --hard
  /\bgit\s+clean\s+-[a-zA-Z]*[fd]/,             // git clean -fd, -f, -d
  /\bgit\s+checkout\s+\.\s*$/,                   // git checkout .
  /\bgit\s+push\s+.*--force/,                    // git push --force
  /\bgit\s+branch\s+-[a-zA-Z]*D/,               // git branch -D (force delete)
  /\brmdir\b/,                                    // rmdir
  /\bfind\b.*(?:^|\s)-delete\b/,                // find ... -delete
  /\bfind\b.*-exec\s+rm\b/,                      // find ... -exec rm
];

/**
 * Check whether a bash command matches any catastrophic destructive pattern.
 *
 * Patterns cover: recursive `rm`, wildcard `rm -f`, `git reset --hard`,
 * `git clean -fd`, `git checkout .`, `git push --force`, force branch deletion,
 * `rmdir`, and `find -delete` / `find -exec rm`.
 *
 * @param command - The bash command string from the `tool_call` event args.
 * @returns A human-readable description of the matched pattern (e.g.,
 *   `"Blocked destructive command matching: \\brm\\s+..."`), or `null` if the
 *   command is safe. Callers include the returned string in the block message.
 */
export function isCatastrophicCommand(command?: string): string | null {
  if (!command) return null;

  for (const pattern of CATASTROPHIC_BASH_PATTERNS) {
    if (pattern.test(command)) {
      return `Blocked destructive command matching: ${pattern.source}`;
    }
  }

  return null;
}

// ─── Path Safety ─────────────────────────────────────────────────────────

/**
 * Validate that a file path is safe to write within the current project.
 *
 * Two conditions trigger an unsafe result:
 * 1. **Path traversal** — the resolved path does not start with `projectRoot + path.sep`
 *    (and is not exactly `projectRoot`). Catches `../` escapes.
 * 2. **`.git/` write** — the resolved path contains `/.git/` or ends with `/.git`.
 *    Prevents corruption of the git repository internals.
 *
 * @param filePath - The file path to validate (from a `tool_call` event's `file_path` arg).
 * @param cwd      - Project working directory (the allowed root).
 * @returns `null` when the path is safe; a non-null error string describing the violation
 *   when unsafe. Callers must check for non-null and use the string in block messages.
 */
export function isPathSafe(filePath: string | undefined, cwd: string): string | null {
  if (!filePath) return null;

  const resolved = path.resolve(filePath);
  const projectRoot = path.resolve(cwd);

  if (!resolved.startsWith(projectRoot + path.sep) && resolved !== projectRoot) {
    return `Path escapes project root: ${filePath}`;
  }

  if (resolved.includes(`${path.sep}.git${path.sep}`) || resolved.endsWith(`${path.sep}.git`)) {
    return `Write to .git/ blocked: ${filePath}`;
  }

  return null;
}

/**
 * Format sprint status as an array of display lines for the `/mlst-status` command.
 *
 * Pure formatting function — no side effects. Output format:
 * ```
 * Sprint: <sprintName>
 * <closed>/<total> closed, <open> open, <escalated> escalated
 * <icon> #<number>: <title> [<status>]
 * ...
 * ```
 *
 * @param sprintName - Display name of the sprint.
 * @param summary    - Aggregate counts from `MlstDatabase.getSprintSummary()`.
 * @param issues     - Issue rows from `MlstDatabase.getSprintIssues()`.
 * @returns Array of formatted strings, one per line.
 */
export function getSprintStatusLines(
  sprintName: string,
  summary: { total: number; open: number; closed: number; escalated: number },
  issues: Array<{ number: number; title: string; status: string }>,
): string[] {
  return [
    `Sprint: ${sprintName}`,
    `${summary.closed}/${summary.total} closed, ${summary.open} open, ${summary.escalated} escalated`,
    ...issues.map((issue) => `${getIssueIcon(issue.status)} #${issue.number}: ${issue.title} [${issue.status}]`),
  ];
}

/**
 * Return the display icon character for a given issue status string.
 *
 * Mapping:
 * - `"closed"`    → `"\u25cf"` (filled circle)
 * - `"escalated"` → `"\u2717"` (cross)
 * - `"open"`      → `"\u25cb"` (empty circle)
 * - any other     → `"\u25d0"` (half-filled circle, represents in-progress states)
 *
 * @param status - Issue status string from the database.
 * @returns A single Unicode character.
 */
export function getIssueIcon(status: string): string {
  if (status === "closed") {
    return "●";
  }
  if (status === "escalated") {
    return "✗";
  }
  if (status === "open") {
    return "○";
  }

  return "◐";
}

/**
 * Extension entry point called by pi when the extension is loaded.
 *
 * **Singleton guard:** checks `process.argv` for `"-p"` or `"--mode"` flags that
 * indicate a subprocess invocation (agent or LLM call). Returns immediately in that
 * case so the MLST extension does not load inside its own subprocesses (re-entrancy guard).
 *
 * **Registrations:**
 * - `/build` command — starts the full orchestration pipeline.
 * - `/mlst-status` command — shows current sprint status from SQLite.
 *
 * **Event hooks:**
 * - `session_start` — lazily initializes `StateManager` and `MlstDatabase` (singleton pattern;
 *   state and db are created once per session, not per command invocation).
 * - `tool_call` — blocks `edit`/`write` tools on the main orchestrator agent while a build
 *   is active; also blocks catastrophic bash commands. Only active when `orchestratorActive`
 *   is `true` so normal pi usage is unaffected outside of a build run.
 * - `session_before_compact` — injects sprint context into the compaction summary when
 *   a build is in progress (skipped when phase is `"idle"` to avoid polluting idle sessions).
 *
 * @param pi - The pi extension API provided at load time.
 */
export default function mlstExtension(pi: ExtensionAPI): void {
  if (isSubprocessInvocation(process.argv)) {
    return;
  }

  const skills = new SkillLoader(resolveResourceDir("skills"));
  skills.load();

  const agentsDir = resolveResourceDir("agents");
  const context = new ContextAssembler(resolveResourceDir("templates"));
  const gates = new QualityGates();
  const widget = createWidgetState();
  const footer = createFooterState();

  let state: StateManager | null = null;
  let db: MlstDatabase | null = null;
  let orchestratorActive = false;

  function ensureInit(ctx: CommandContext): { state: StateManager; db: MlstDatabase } {
    // Singleton pattern: state and db live for the entire pi session, not per-command.
    // Re-using the same instances preserves in-memory sprint state across /build and /mlst-status.
    if (!state || !db) {
      state = new StateManager(createStateManagerDeps(ctx));
      db = new MlstDatabase(ctx.cwd);
    }

    return { state, db };
  }

  /**
   * Handle --resume: load sprint from SQLite and continue from Phase 3.
   */
  async function handleResume(args: string, ctx: CommandContext, piApi: ExtensionAPI): Promise<void> {
    const { state: sprintState, db: database } = ensureInit(ctx);
    const sessionModel = getModelString(ctx);
    const config = loadProjectConfig(ctx.cwd);
    const llm = new LlmClient(resolveLlmModel("build", sessionModel, config.models));
    const agentList = loadAgents(agentsDir, { parentModel: sessionModel, models: config.models });

    // Parse sprint ID from args: --resume or --resume <sprint-id>
    const sprintIdStr = args.replace(/^--resume\s*/, "").trim();
    const project = database.getOrCreateProject(ctx.cwd);

    let sprint;
    if (sprintIdStr && /^\d+$/.test(sprintIdStr)) {
      sprint = database.getSprint(parseInt(sprintIdStr, 10));
    } else {
      sprint = database.getLatestSprint(project.id);
    }

    if (!sprint) {
      ctx.ui?.notify?.("No sprint found to resume.", "warning");
      return;
    }

    if (!sprint.specification) {
      ctx.ui?.notify?.("Sprint has no specification — cannot resume from Phase 3.", "warning");
      return;
    }

    // Restore execution profile
    let execProfile = resolveExecutionProfile(ctx.cwd, ctx.model?.provider);
    if (sprint.execution_profile) {
      try {
        const saved = JSON.parse(sprint.execution_profile);
        execProfile = { ...execProfile, ...saved };
      } catch { /* ignore parse errors */ }
    }

    // Restore tasks from SQLite
    const issues = database.getSprintIssues(sprint.id);
    const tasks = issues.map((issue) => ({
      id: `resume-${issue.id}`,
      label: `TASK-${String(issue.number).padStart(3, "0")}`,
      title: issue.title,
      type: (issue.type || "Implementation") as any,
      status: "pending" as const,
      dependencies: JSON.parse(issue.dependencies || "[]"),
      parallelWith: [],
      acceptanceCriteria: JSON.parse(issue.acceptance_criteria || "[]"),
      filesAffected: JSON.parse(issue.files_affected || "[]"),
      assignedAgent: issue.assigned_agent ?? "mlst-impl-engineer",
      iterationCount: 0,
    }));

    if (tasks.length === 0) {
      ctx.ui?.notify?.("Sprint has no tasks — cannot resume.", "warning");
      return;
    }

    ctx.ui?.notify?.(`Resuming sprint #${sprint.id}: ${sprint.name} (${tasks.length} tasks)`, "info");

    const provider = ctx.model?.provider ?? "";
    const providerProfile = loadProviderProfile(ctx.cwd, provider, ctx.model?.id);
    rateThrottle.applyProfile(providerProfile);

    orchestratorActive = true;
    startWidget(widget, ctx);
    const dashboard = startDashboard(ctx);
    startFooter(footer, ctx, dashboard.url);

    try {
      const orchestrator = new Orchestrator({
        state: sprintState,
        skills,
        context,
        gates,
        llm,
        db: database,
        agents: agentList,
        profile: execProfile,
        cwd: ctx.cwd,
        model: sprint.model ?? sessionModel,
        signal: undefined,
        notify: (message, level) => ctx.ui?.notify?.(message, level),
        sendMessage: (message) => ctx.ui?.notify?.(message, "info"),
        exec: (cmd, commandArgs) => execCommand(piApi, ctx.cwd, cmd, commandArgs),
        emit: (event) => {
          dashboard.emit(event);
          applyWidgetEvent(widget, event);
          applyFooterEvent(footer, event);
        },
        onAgentProgress: (text, toolCount) => setWidgetProgress(widget, text, toolCount),
        setWorkingMessage: (message) => ctx.ui?.setWorkingMessage?.(message),
        promptUser: (question, ctx2) => promptUserForClarification(ctx, question, ctx2),
      });

      // Restore gate annotations from prior gates
      if (sprint.gate_annotations) {
        orchestrator.restoreGateAnnotations(sprint.gate_annotations);
      }

      const classification = (sprint.classification ?? "feature") as any;
      sprintState.setClassification(classification);
      sprintState.reset(sprint.goal ?? "");
      sprintState.setMaxIterations(execProfile.maxReviewIterations, execProfile.maxTestRetries);

      await orchestrator.resumeFromPhase3(
        sprint.specification,
        tasks,
        sprint.id,
        project.id,
      );
      ctx.ui?.notify?.("MLST resume complete.", "success");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui?.notify?.(`MLST resume failed: ${message}`, "error");
    } finally {
      orchestratorActive = false;
      stopWidget(widget);
      stopFooter(footer);
      ctx.ui?.setWorkingMessage?.();
      ctx.ui?.setStatus?.("mlst", undefined);
      stopDashboard(ctx, dashboard);
    }
  }

  const handleBuild: CommandHandler = async (args, ctx) => {
    if (!args.trim()) {
      notifyMissingBuildArgs(ctx);
      return;
    }

    const trimmed = args.trim();

    // Handle --resume flag
    if (trimmed.startsWith("--resume")) {
      await handleResume(trimmed, ctx, pi);
      return;
    }

    const { state: sprintState, db: database } = ensureInit(ctx);
    const sessionModel = getModelString(ctx);
    const config = loadProjectConfig(ctx.cwd);
    const llm = new LlmClient(resolveLlmModel("build", sessionModel, config.models));
    const agents = loadAgents(agentsDir, { parentModel: sessionModel, models: config.models });
    const input = await resolveInput(trimmed, ctx.cwd);
    const isPrd = parsePrdFilePath(trimmed);

    // Handle --plan flag: override pipeline mode to review-only
    const isPlanMode = trimmed.startsWith("--plan ") || trimmed === "--plan";
    const buildInput = isPlanMode ? trimmed.replace(/^--plan\s*/, "").trim() : undefined;

    // Auto-detect provider for rate limiting and execution profile
    const provider = ctx.model?.provider ?? "";
    const execProfile = resolveExecutionProfile(ctx.cwd, provider);
    if (isPlanMode) {
      execProfile.pipelineMode = "review-only";
    }
    ctx.ui?.notify?.(`Execution profile: ${execProfile.name} (mode: ${execProfile.pipelineMode})`, "info");
    const providerProfile = loadProviderProfile(ctx.cwd, provider, ctx.model?.id);
    rateThrottle.applyProfile(providerProfile);
    if (providerProfile.spawnDelayMs > 0) {
      ctx.ui?.notify?.(`Provider: ${provider || "unknown"} — concurrency=${providerProfile.concurrency}, pacing=${Math.round(providerProfile.spawnDelayMs / 1000)}s`, "info");
    }

    orchestratorActive = true;
    startWidget(widget, ctx);
    ctx.ui?.notify?.("MLST starting...", "info");

    const dashboard = startDashboard(ctx);
    startFooter(footer, ctx, dashboard.url);

    try {
      const orchestrator = new Orchestrator({
        state: sprintState,
        skills,
        context,
        gates,
        llm,
        db: database,
        agents,
        profile: execProfile,
        cwd: ctx.cwd,
        model: sessionModel,
        signal: undefined,
        notify: (message, level) => ctx.ui?.notify?.(message, level),
        sendMessage: (message) => ctx.ui?.notify?.(message, "info"),
        exec: (cmd, commandArgs) => execCommand(pi, ctx.cwd, cmd, commandArgs),
        emit: (event) => {
          dashboard.emit(event);
          applyWidgetEvent(widget, event);
          applyFooterEvent(footer, event);
        },
        onAgentProgress: (text, toolCount) => setWidgetProgress(widget, text, toolCount),
        setWorkingMessage: (message) => ctx.ui?.setWorkingMessage?.(message),
        promptUser: (question, context) => promptUserForClarification(ctx, question, context),
      });

      await orchestrator.run(isPlanMode && buildInput ? await resolveInput(buildInput, ctx.cwd) : input, { isPrd: isPrd && !isPlanMode });
      ctx.ui?.notify?.("MLST workflow complete.", "success");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui?.notify?.(`MLST failed: ${message}`, "error");
    } finally {
      orchestratorActive = false;
      stopWidget(widget);
      stopFooter(footer);
      ctx.ui?.setWorkingMessage?.();
      ctx.ui?.setStatus?.("mlst", undefined);
      stopDashboard(ctx, dashboard);
    }
  };

  const handleStatus: CommandHandler = async (_args, ctx) => {
    const { db: database } = ensureInit(ctx);
    const project = database.getOrCreateProject(ctx.cwd);
    const sprint = database.getActiveSprint(project.id);

    if (!sprint) {
      ctx.ui?.notify?.("No active sprint.", "info");
      return;
    }

    const summary = database.getSprintSummary(sprint.id);
    const issues = database.getSprintIssues(sprint.id);
    const lines = getSprintStatusLines(sprint.name, summary, issues);
    ctx.ui?.notify?.(lines.join("\n"), "info");
  };

  pi.on("session_start", async (_event, rawContext) => {
    // Eagerly initialize state and db so they are ready before the first /build command.
    // This avoids a cold-start delay when the user runs /build immediately after loading.
    ensureInit(rawContext as CommandContext);
    return undefined;
  });

  pi.on("tool_call", async (rawEvent) => {
    if (!orchestratorActive) return undefined;

    const event = rawEvent as ToolCallEvent;

    // Block edit/write on the main orchestrator agent (only spawned agents may write)
    if (isBlockedTool(event.toolName)) {
      return {
        block: true,
        reason: `MLST: ${event.toolName} blocked during orchestration — only spawned agents may modify files.`,
      };
    }

    // Block catastrophic bash commands on the main orchestrator agent
    if (event.toolName === "bash") {
      const blocked = isCatastrophicCommand(event.args?.command);
      if (blocked) {
        return { block: true, reason: `MLST safety: ${blocked}` };
      }
    }

    return undefined;
  });

  const handlePrd: CommandHandler = async (args, ctx) => {
    if (!args.trim()) {
      ctx.ui?.notify?.("Usage: /prd <idea> or /prd --resume <slug>", "warning");
      return;
    }

    if (!ctx.ui?.input) {
      ctx.ui?.notify?.("The /prd command requires interactive mode.", "warning");
      return;
    }

    const trimmed = args.trim();
    const input = await resolveInput(trimmed, ctx.cwd);
    const sessionModel = getModelString(ctx);
    const config = loadProjectConfig(ctx.cwd);
    const llm = new LlmClient(resolveLlmModel("prd", sessionModel, config.models));

    const prdDeps = {
      cwd: ctx.cwd,
      llm,
      promptUser: async (prompt: string): Promise<string> => {
        const answer = await ctx.ui?.input?.(prompt, "");
        return answer ?? "";
      },
      notify: (message: string, level: "info" | "warning" | "error" | "success") =>
        ctx.ui?.notify?.(message, level),
    };

    const session = new PrdSession(prdDeps);

    try {
      if (trimmed.startsWith("--resume ")) {
        const slug = trimmed.slice("--resume ".length).trim();
        if (!slug) {
          ctx.ui?.notify?.("Usage: /prd --resume <slug>", "warning");
          return;
        }
        const result = await session.resume(slug);
        ctx.ui?.notify?.(`PRD complete: ${result.filePath}`, "success");
        ctx.ui?.notify?.(`Run /build ${result.filePath} to start building.`, "info");
      } else {
        const result = await session.run(input);
        ctx.ui?.notify?.(`PRD complete: ${result.filePath}`, "success");
        ctx.ui?.notify?.(`Run /build ${result.filePath} to start building.`, "info");
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui?.notify?.(`PRD failed: ${message}`, "error");
    }
  };

  pi.registerCommand("build", {
    description: "Start the MLST scrum team workflow for any feature, epic, or bug fix",
    handler: handleBuild,
  });

  pi.registerCommand("prd", {
    description: "Run an interactive planning session that produces a PRD for /build",
    handler: handlePrd,
  });

  pi.registerCommand("mlst-status", {
    description: "Show current MLST sprint status from database",
    handler: handleStatus,
  });

  pi.on("session_before_compact", async () => {
    // Skip when idle — injecting sprint state into an unrelated session's compaction
    // summary wastes context tokens and confuses the compaction model.
    if (!state || state.getState().phase === "idle") {
      return undefined;
    }

    return {
      customInstructions: `Preserve MLST sprint state. Phase: ${state.getState().phase}. Tasks: ${state.getState().tasks.length}.`,
    };
  });
}

/**
 * Timeout for user clarification prompts (60 seconds).
 * After this, the orchestrator falls back to autonomous decision.
 */
const CLARIFICATION_TIMEOUT_MS = 60_000;

/**
 * Prompt the user for a clarification answer via the pi TUI.
 *
 * In interactive mode, opens an input dialog with a 60-second timeout. The dialog
 * auto-dismisses on timeout, returning `null` so the orchestrator proceeds autonomously.
 * In non-interactive/CI mode (no UI available), returns `null` immediately.
 *
 * @param ctx      - Command context providing the UI surface.
 * @param question - The clarifying question(s) to display.
 * @param context  - Optional label (agent name, task ID) displayed alongside the question.
 * @returns The user's text answer, or `null` if unavailable or timed out.
 */
async function promptUserForClarification(
  ctx: CommandContext,
  question: string,
  context?: string,
): Promise<string | null> {
  if (!ctx.ui?.notify) return null;

  const title = context
    ? `Clarification needed (${context})`
    : "Clarification needed";

  // Try to use the input dialog with a timeout
  try {
    const ui = ctx.ui as UiApi & {
      input?: (prompt: string, placeholder?: string, options?: { timeout?: number }) => Promise<string | undefined>;
    };

    if (typeof ui.input === "function") {
      const answer = await ui.input(
        `${title}:\n${question}`,
        "Type your answer...",
        { timeout: CLARIFICATION_TIMEOUT_MS },
      );
      return answer?.trim() || null;
    }
  } catch {
    // input() not available or threw — fall through to null
  }

  // Non-interactive mode: notify and return null
  ctx.ui.notify?.(`${title}: ${question} (auto-deciding — no interactive input available)`, "warning");
  return null;
}

/**
 * Execute a subprocess command, preferring pi's built-in `exec` when available
 * and falling back to a raw `child_process.spawn` otherwise.
 *
 * The pi `exec` path uses a 60-second timeout. The spawn fallback has no
 * built-in timeout but inherits the parent process's signal handling.
 *
 * @param pi   - Extension API (checked for an `exec` method).
 * @param cwd  - Working directory for the subprocess.
 * @param cmd  - Executable name.
 * @param args - Argument array.
 * @returns Resolved result with `stdout`, `stderr`, and exit `code`.
 */
async function execCommand(
  pi: ExtensionAPI,
  cwd: string,
  cmd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number }> {
  if (pi.exec) {
    return pi.exec(cmd, args, { timeout: 60000 });
  }

  return new Promise((resolve) => {
    const proc = spawn(cmd, args, {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data: Buffer) => {
      stdout += data;
    });

    proc.stderr?.on("data", (data: Buffer) => {
      stderr += data;
    });

    proc.on("close", (code: number | null) => {
      resolve({ stdout, stderr, code: code ?? 1 });
    });

    proc.on("error", () => {
      resolve({ stdout, stderr, code: 1 });
    });
  });
}
