/**
 * MLST Pi Extension — Shared Type Definitions
 */

// ─── Sprint State ───────────────────────────────────────────────────────────

/**
 * Lifecycle phase of a sprint run.
 *
 * - `idle`           — No build running; the extension is loaded but inactive.
 * - `phase0`         — Idea refinement: LLM checks whether the input is clear enough to proceed.
 * - `phase1`         — Specification: `mlst-spec-writer` agent drafts the full project spec.
 * - `phase2`         — Task breakdown: `mlst-scrum-master` agent converts the spec to tasks.
 * - `scaffold`       — Scaffolding: `mlst-impl-engineer` creates initial project structure for empty repos.
 * - `phase3`         — Execution: Group 1 (design/infra/docs) then Group 2 (impl/testing) run.
 * - `phase4`         — Completion: sprint summary is generated and persisted to SQLite.
 * - `complete`       — Sprint has finished; results are available.
 * - `fast-path`      — Bug-fix shortcut: no phases, direct impl → test → lint → review.
 * - `impl-fast-path` — Implementation-spec shortcut: like fast-path but for exact-spec inputs.
 */
export type Phase =
  | "idle"
  | "phase0"
  | "phase1"
  | "phase2"
  | "scaffold"
  | "phase3"
  | "phase4"
  | "complete"
  | "fast-path"
  | "impl-fast-path";

/**
 * Input classification produced by the LLM gate in `Orchestrator.classify()`.
 *
 * - `bug`                 — A defect report with expected vs actual behavior, error messages,
 *                           or stack traces. Routes to the fast-path (direct fix, no phases).
 * - `feature`             — A single feature described in plain language. Full pipeline.
 * - `epic`                — A large, multi-component body of work. Full pipeline.
 * - `plan`                — A roadmap or multi-feature description. Full pipeline.
 * - `implementation-spec` — Provides exact file paths and line-by-line code changes to make
 *                           (very rare). A PRD or requirements document is NOT this — those
 *                           are `requirements`. Routes to the impl-fast-path (no phases).
 * - `requirements`        — A PRD, spec document, or feature description with acceptance
 *                           criteria. The most common classification for uploaded documents.
 *                           Routes to the full pipeline but skips Phase 0 (input is already
 *                           structured enough to proceed directly to spec-writing).
 */
export type Classification =
  | "bug"
  | "feature"
  | "epic"
  | "plan"
  | "implementation-spec"
  | "requirements";

/**
 * Lifecycle status of an individual task.
 *
 * Approximate transitions:
 * ```
 *   pending → in-progress → testing → in-progress → reviewing → complete
 *                                                             ↘ escalated  (max iterations hit)
 *   any status → escalated  (on unrecoverable error)
 *   any status → blocked    (dependency unmet; reserved, not currently triggered)
 * ```
 *
 * - `pending`     — Task created but not yet started.
 * - `in-progress` — Implementation agent is running or applying review fixes.
 * - `testing`     — Test-runner agent is writing or verifying tests.
 * - `reviewing`   — Code-reviewer agent is evaluating the implementation.
 * - `complete`    — All acceptance criteria met and the reviewer approved.
 * - `blocked`     — A dependency has not resolved (reserved; not currently triggered).
 * - `escalated`   — Max iterations exhausted or unrecoverable error; needs human attention.
 */
export type TaskStatus =
  | "pending"
  | "in-progress"
  | "testing"
  | "reviewing"
  | "complete"
  | "blocked"
  | "escalated";

export type TaskType =
  | "Implementation"
  | "Testing"
  | "Documentation"
  | "Infrastructure"
  | "Deployment"
  | "Design";

export interface TaskState {
  /** UUID generated at parse time; used as the stable internal key across all maps. */
  id: string;
  /**
   * Human-readable short key in `TASK-001` format, assigned by the scrum-master agent.
   * Distinct from `id` (which is a UUID): this is displayed in the UI, used in dependency
   * references in the scrum-master output, and stored in SQLite as the issue title prefix.
   */
  label: string;
  title: string;
  type: TaskType;
  status: TaskStatus;
  /** UUIDs of tasks that must be `complete` before this task can start (topological ordering). */
  dependencies: string[];
  /**
   * UUIDs of sibling tasks that may run concurrently alongside this one.
   * Unlike `dependencies`, these do not create ordering constraints — they are metadata
   * for display and potential future parallelism hints. Set by the scrum-master agent.
   */
  parallelWith: string[];
  acceptanceCriteria: string[];
  filesAffected: string[];
  assignedAgent: string;
  /** Text output from the implementation agent (GREEN phase or fast-path). */
  output?: string;
  /** Text output from the code-reviewer agent for the most recent review pass. */
  reviewOutput?: string;
  /** Text output from the designer agent (Group 1); injected into the impl agent's GREEN-phase prompt. */
  designOutput?: string;
  /** Number of review iterations attempted so far; incremented at the start of each review loop pass. */
  iterationCount: number;
}

export interface SprintState {
  /** Current lifecycle phase of this sprint run. Updated by `StateManager.setPhase()`. */
  phase: Phase;
  /** LLM classification of the original input. Set after `Orchestrator.classify()` returns. */
  classification?: Classification;
  input: string;
  /**
   * Optional upstream Architecture Decision Record text, stored verbatim and injected into
   * the spec prompt so the spec-writer has prior architectural context and constraints.
   */
  decisionRecord?: string;
  /** Full specification text produced by the `mlst-spec-writer` agent in Phase 1. */
  specification?: string;
  tasks: TaskState[];
  /** Maximum number of review-loop iterations before a task is escalated. Sourced from the execution profile. */
  maxReviewIterations: number;
  /** Maximum number of test-fix attempts before escalation. Sourced from the execution profile. */
  maxTestRetries: number;
  startedAt: string;
  completedAt?: string;
}

// ─── Human Quality Gates ────────────────────────────────────────────────────

/**
 * Named pipeline boundary where the orchestrator can pause for human review.
 *
 * - `"post-spec"`      — After Phase 1 (specification) completes.
 * - `"post-tasks"`     — After Phase 2 (task breakdown) completes.
 * - `"post-design"`    — After Group 1 design tasks complete, before Group 2 impl.
 * - `"pre-execution"`  — Reserved; not currently wired.
 * - `"on-escalation"`  — When a task is escalated after max review iterations.
 * - `"post-review"`    — After the review loop in fast paths, before marking complete.
 */
export type GatePoint =
  | "post-spec"
  | "post-tasks"
  | "post-design"
  | "pre-execution"
  | "on-escalation"
  | "post-review";

/**
 * Result returned by the orchestrator's `humanGate()` method.
 *
 * Captures the human's approval decision, any revised artifact content,
 * a structured annotation summarising the human's constraints/preferences
 * (injected into downstream prompts), and metadata about the interaction.
 */
export interface HumanGateResult {
  /** Whether the human approved (or the gate auto-approved due to timeout/config). */
  approved: boolean;
  /** Revised artifact text if the human's feedback led to LLM reconciliation. */
  revisedArtifact?: string;
  /**
   * Structured summary of the human's decisions, constraints, and preferences.
   * Injected into the next phase's prompt as `## Human Review Notes`.
   */
  gateAnnotation?: string;
  /** Number of feedback rounds the human went through before approving (0 = first prompt). */
  feedbackRounds: number;
  /** Whether the gate was auto-approved without human interaction (timeout, CI, not in profile). */
  autonomous: boolean;
}

/**
 * Human response to an on-escalation gate.
 *
 * - `"retry"`    — Reset iteration count, re-run with a different approach hint.
 * - `"skip"`     — Mark the task complete without reviewer approval.
 * - `"escalate"` — Mark escalated, continue the sprint with remaining tasks.
 * - `"abort"`    — Stop the entire sprint immediately.
 */
export type EscalationAction = "retry" | "skip" | "escalate" | "abort";

// ─── Quality Gates ──────────────────────────────────────────────────────────

export interface GateResult {
  passed: boolean;
  /**
   * Human-readable failure reasons collected during validation.
   * Empty when `passed` is `true`. Each entry describes a separate, actionable issue.
   */
  issues: string[];
}

// ─── Agent Config ───────────────────────────────────────────────────────────

export interface MlstAgentConfig {
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  /**
   * The body of the agent's `.md` file after the YAML frontmatter is stripped.
   * This is the raw system prompt content. Skill injections and the safety preamble
   * are appended at spawn time and are not stored here.
   */
  systemPrompt: string;
  /** Absolute path to the agent definition `.md` file in the `agents/` directory. */
  filePath: string;
}

// ─── Agent Execution Results ────────────────────────────────────────────────

export interface UsageStats {
  /** Total input tokens sent to the model across all turns. */
  input: number;
  /** Total output tokens generated by the model across all turns. */
  output: number;
  /**
   * Tokens served from Anthropic's prompt cache (billed at a reduced rate).
   * Zero for providers that do not support prompt caching.
   */
  cacheRead: number;
  /**
   * Tokens written into Anthropic's prompt cache for future reuse.
   * Zero for providers that do not support prompt caching.
   */
  cacheWrite: number;
  /** Accumulated USD cost across all turns, as reported by the provider. */
  cost: number;
  /**
   * Total tokens in the context window at the last assistant turn.
   * Useful for detecting context exhaustion before the model is cut off.
   */
  contextTokens: number;
  /** Number of completed assistant turns in the conversation. */
  turns: number;
}

export interface AgentResult {
  agent: string;
  task: string;
  /** Exit code of the `pi` subprocess. Non-zero indicates failure. */
  exitCode: number;
  output: string;
  stderr: string;
  usage: UsageStats;
  model?: string;
  /**
   * Model-reported reason the response ended (e.g., `"end_turn"`, `"max_tokens"`).
   * Sourced from the `message_end` SSE event emitted by the `pi` subprocess.
   */
  stopReason?: string;
  /**
   * Model-reported error description, if any. Distinct from `stderr` (the subprocess
   * stderr stream) — this is the model's own error message embedded in the SSE event.
   */
  errorMessage?: string;
}

/**
 * Reason the review loop exited for a given task.
 *
 * - `approved`       — The reviewer's LLM verdict was APPROVED (or `enableReviewGate` is `false`,
 *                      in which case all reviews are auto-approved after the first pass).
 * - `needs-fixes`    — Reviewer requested changes but `maxReviewIterations` has not been reached yet.
 *                      The loop continues to the next iteration.
 * - `max-iterations` — The iteration cap was hit before approval; the task is escalated.
 */
export type ReviewReason = "approved" | "needs-fixes" | "max-iterations";

// ─── Clarification Requests ──────────────────────────────────────────────

/**
 * A clarifying question surfaced by a sub-agent during task execution.
 *
 * Detected when agent output contains one or more `CLARIFICATION_NEEDED: <question>`
 * markers. The orchestrator pauses the requesting task, prompts the user (or falls
 * back to autonomous decision in non-interactive/CI mode), and re-invokes the agent
 * with the answer injected into the task context.
 */
export interface ClarificationRequest {
  /** The agent name that raised the question. */
  agent: string;
  /** One or more clarifying questions extracted from the agent's output. */
  questions: string[];
  /** Optional task label (e.g., `"TASK-001"`) if the clarification arose during task execution. */
  taskLabel?: string;
}

// ─── Deletion Safety ─────────────────────────────────────────────────────

/**
 * Classification of how destructive a set of code changes appears to be,
 * based on `git diff --stat` output.
 *
 * - `normal`       — Routine change: no unusual deletion patterns detected. No special handling.
 * - `large`        — Exceeds one or more thresholds (files deleted, net lines removed, or
 *                    removal-to-addition ratio). The code reviewer receives an explicit warning.
 * - `catastrophic` — Reserved for future use; not currently triggered by any gate.
 */
export type DeletionTier = "normal" | "large" | "catastrophic";

export interface DeletionCheckResult {
  /**
   * Classification of the deletion scope. `"normal"` needs no special handling;
   * `"large"` causes the reviewer prompt to include a deletion warning section.
   */
  tier: DeletionTier;
  /**
   * Paths of files that had only deletions and zero additions in the `git diff --stat`
   * output — i.e., files that were fully removed rather than partially edited.
   */
  filesDeleted: string[];
  /** Total lines removed, as reported by the `git diff --stat` summary line (authoritative). */
  linesRemoved: number;
  /** Total lines added, as reported by the `git diff --stat` summary line (authoritative). */
  linesAdded: number;
  warning?: string;
}

// ─── Execution Profile ──────────────────────────────────────────────────────

/**
 * Pipeline execution mode.
 *
 * - `"full"`        — Current behavior: all phases 0-4 run end-to-end.
 * - `"gated"`       — Full pipeline but pauses at every enabled human gate.
 * - `"review-only"` — Phases 0-2 only; produce spec + tasks for human review
 *                     without running any agents in Phase 3. Useful for planning.
 */
export type PipelineMode = "full" | "gated" | "review-only";

export interface ExecutionProfile {
  /** Display name for logging (e.g. "cloud", "local", or "custom" for config.json overrides). */
  name: string;

  // ── Concurrency ──────────────────────────────
  /** Max parallel agents in Group 1 (design/infra/docs). */
  group1Concurrency: number;
  /** Max parallel impl tasks per topological batch in Group 2. */
  group2Concurrency: number;

  // ── Review & Test Iteration Limits ───────────
  /** Maximum number of review-loop passes before a task is escalated. */
  maxReviewIterations: number;
  /** Maximum number of test-fix attempts before a task is escalated. */
  maxTestRetries: number;

  // ── Phase Toggles ────────────────────────────
  /** Whether to run Phase 0 (idea refinement) for non-requirements input. */
  enablePhase0: boolean;
  /** Whether to run spec-completeness LLM gate after Phase 1. */
  enableSpecGate: boolean;
  /** Whether to run the reviewApproved LLM call (if false, auto-approve after first review). */
  enableReviewGate: boolean;

  // ── Workflow Simplifications ──────────────────
  /** If true, Group 1 tasks run sequentially instead of via spawnAgentsParallel. */
  sequentialGroup1: boolean;
  /** If true, skip the AGENTS.md tech-stack extraction LLM call to save context. */
  skipAgentsMdExtraction: boolean;

  // ── Human Quality Gates ─────────────────────
  /**
   * List of pipeline boundaries where human approval is required.
   * Empty array = fully autonomous (no gates). Gates not in this list
   * are auto-approved without LLM analysis.
   */
  humanGates: GatePoint[];

  // ── Pipeline Mode ───────────────────────────
  /**
   * Pipeline execution mode. Defaults to `"full"` for backward compatibility.
   * `"gated"` pauses at every enabled human gate; `"review-only"` stops after Phase 2.
   */
  pipelineMode: PipelineMode;
}

// ─── Skill Mapping ──────────────────────────────────────────────────────────

/**
 * Static mapping from agent name to the list of skill names to inject at spawn time.
 * Skills are loaded from `skills/<name>/SKILL.md` by {@link SkillLoader}.
 * To add a new skill injection for an agent, add its name as a key with the skill names as values.
 */
export const AGENT_SKILLS: Record<string, string[]> = {
  "mlst-designer": ["design-system"],
};

// ─── Dashboard Events ───────────────────────────────────────────────────────

/** Common fields present on every dashboard event. */
interface MlstEventBase {
  timestamp: number;
  /** Session identifier — set by the dashboard when emitting. Optional for backward compatibility with old JSONL logs. */
  sessionId?: string;
}

export type MlstEvent =
  | (MlstEventBase & { type: "sprint_start"; input: string; classification: string })
  | (MlstEventBase & { type: "phase"; phase: string })
  | (MlstEventBase & {
      type: "human_gate";
      gate: GatePoint;
      status: "waiting" | "analyzing" | "reviewing" | "approved" | "rejected" | "timeout";
      feedbackRounds: number;
      autonomous: boolean;
      conversationSummary?: string;
    })
  | (MlstEventBase & { type: "agent_start"; agent: string; prompt: string; taskLabel: string })
  | (MlstEventBase & { type: "agent_end"; agent: string; output: string; model?: string; usage: UsageStats; taskLabel: string })
  | (MlstEventBase & { type: "agent_progress"; agent: string; taskLabel: string; text: string; toolCount: number })
  | (MlstEventBase & { type: "llm_start"; purpose: string; system: string; user: string; tier: string })
  | (MlstEventBase & { type: "llm_end"; purpose: string; response: string })
  | (MlstEventBase & { type: "exec_start"; command: string; args: string[] })
  | (MlstEventBase & { type: "exec_end"; command: string; code: number; stdout: string })
  | (MlstEventBase & { type: "gate"; name: string; passed: boolean; issues: string[] })
  | (MlstEventBase & { type: "task"; id: string; status: string; title: string })
  | (MlstEventBase & {
      type: "review";
      taskId: string;
      label: string;
      title: string;
      iteration: number;
      max: number;
      approved: boolean;
      /** Whether the task was escalated because `max` iterations were exhausted without approval. */
      escalated: boolean;
      reason: ReviewReason;
    })
  | (MlstEventBase & {
      type: "rate_limit";
      /** Milliseconds the throttle is currently waiting between spawns (0 = no pacing). */
      delayMs: number;
      concurrency: number;
    })
  | (MlstEventBase & {
      type: "deletion_check";
      taskId: string;
      tier: DeletionTier;
      filesDeleted: string[];
      linesRemoved: number;
      linesAdded: number;
      warning?: string;
    })
  | (MlstEventBase & {
      type: "checkpoint";
      taskId: string;
      /**
       * Git stash ref label used for this checkpoint (e.g., `"mlst-checkpoint-<taskId>"`).
       * The stash is pushed and immediately popped — only the reflog entry is kept for recovery.
       */
      ref: string;
    })
  | (MlstEventBase & {
      type: "clarification";
      agent: string;
      questions: string[];
      taskLabel?: string;
      /** The user's answer, or `null` if the orchestrator decided autonomously (timeout/CI). */
      answer: string | null;
      /** Whether the orchestrator made an autonomous decision (no user input available). */
      autonomous: boolean;
    })
  | (MlstEventBase & { type: "sprint_end"; summary: string; aborted?: boolean; abortReason?: string });
