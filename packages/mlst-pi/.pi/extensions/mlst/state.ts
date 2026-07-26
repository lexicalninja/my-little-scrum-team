/**
 * MLST Pi Extension — Sprint State Management
 *
 * Persists sprint state via pi.appendEntry() for session continuity.
 */

import type { Phase, SprintState, TaskState, TaskStatus } from "./types.js";

export interface StateManagerDeps {
  /**
   * Append a typed entry to the pi session log for cross-session continuity.
   * Currently disabled in {@link StateManager.persist} due to a stack-overflow issue
   * in pi's session machinery — see that method for details.
   */
  appendEntry: (type: string, data: unknown) => void;
  /** Update a named status-bar entry in the pi TUI (`undefined` clears the entry). */
  setStatus: (key: string, value: string | undefined) => void;
  /** Update a named widget panel in the pi TUI (`undefined` removes the widget). */
  setWidget: (key: string, lines: string[] | undefined) => void;
  /** Display a notification message at the given severity level in the pi TUI. */
  notify: (message: string, level: "info" | "warning" | "error" | "success") => void;
}

/**
 * In-memory sprint state manager with UI side effects on every mutation.
 *
 * This class is the single source of truth for the current sprint's in-flight state
 * (phase, tasks, classification, etc.). Every mutating method also calls {@link updateUI}
 * and {@link persist}, keeping the pi TUI and SQLite database in sync.
 *
 * Primary persistence is SQLite (via {@link MlstDatabase}), not this class.
 * Session-based persistence via `appendEntry` is intentionally disabled —
 * see {@link persist} for the reason.
 */
export class StateManager {
  private state: SprintState;
  private deps: StateManagerDeps;

  /**
   * @param deps - UI callbacks provided by the extension entry point.
   *   Initializes with {@link defaultState}; does NOT restore from any storage.
   */
  constructor(deps: StateManagerDeps) {
    this.deps = deps;
    this.state = this.defaultState();
  }

  private defaultState(): SprintState {
    return {
      phase: "idle",
      input: "",
      tasks: [],
      maxReviewIterations: 3,
      maxTestRetries: 3,
      startedAt: new Date().toISOString(),
    };
  }

  /**
   * Clear all sprint state and set the new input string.
   * Called at the start of every `/build` run before any agents are spawned.
   *
   * @param input - The raw user input for the new sprint.
   */
  reset(input: string): void {
    this.state = this.defaultState();
    this.state.input = input;
    this.persist();
  }

  /**
   * Return a read-only snapshot of the current sprint state.
   * Callers must not mutate the returned object — all changes must go through
   * the mutating methods on this class to ensure UI and persistence stay in sync.
   *
   * @returns The current `SprintState`; mutations have no effect on internal state.
   */
  getState(): Readonly<SprintState> {
    return this.state;
  }

  // ─── Phase Management ───────────────────────────────────────────────────

  /**
   * Set the current lifecycle phase, trigger a UI update, and persist.
   * Every phase transition should go through this method.
   *
   * @param phase - The new lifecycle phase.
   */
  setPhase(phase: Phase): void {
    this.state.phase = phase;
    this.updateUI();
    this.persist();
  }

  /**
   * Record the LLM-produced classification of the current input.
   * Persists to storage but does NOT trigger a UI update (classification is not shown in the TUI).
   *
   * @param classification - The classification value from `Orchestrator.classify()`.
   */
  setClassification(classification: SprintState["classification"]): void {
    this.state.classification = classification;
    this.persist();
  }

  // ─── Artifact Storage ───────────────────────────────────────────────────

  /**
   * Store an Architecture Decision Record for injection into spec prompts.
   * The record is passed verbatim to `ContextAssembler.buildSpecPrompt()` as the
   * `decisionRecord` argument.
   *
   * @param record - Raw ADR text from an upstream source.
   */
  setDecisionRecord(record: string): void {
    this.state.decisionRecord = record;
    this.persist();
  }

  /**
   * Store the full specification text produced by the `mlst-spec-writer` agent in Phase 1.
   * This is read by Phase 2 (task breakdown) and Phase 3 (implementation context).
   *
   * @param spec - The spec-writer agent's complete output.
   */
  setSpecification(spec: string): void {
    this.state.specification = spec;
    this.persist();
  }

  // ─── Task Management ───────────────────────────────────────────────────

  /**
   * Replace the entire task list and trigger a UI update.
   * Called once after `Orchestrator.parseTasks()` converts the scrum-master output.
   *
   * @param tasks - The complete list of parsed tasks for this sprint.
   */
  setTasks(tasks: TaskState[]): void {
    this.state.tasks = tasks;
    this.updateUI();
    this.persist();
  }

  /**
   * Apply a partial update to a single task by UUID and trigger a UI update.
   * Silently no-ops if `taskId` is not found in the current task list.
   *
   * @param taskId - UUID of the task to update.
   * @param update - Partial `TaskState` fields to merge onto the existing task.
   */
  updateTask(taskId: string, update: Partial<TaskState>): void {
    const task = this.state.tasks.find((t) => t.id === taskId);
    if (task) {
      Object.assign(task, update);
      this.updateUI();
      this.persist();
    }
  }

  /**
   * Look up a single task by UUID.
   *
   * @param taskId - UUID of the task.
   * @returns The matching `TaskState`, or `undefined` if not found.
   */
  getTask(taskId: string): TaskState | undefined {
    return this.state.tasks.find((t) => t.id === taskId);
  }

  /**
   * Return all tasks whose `type` field matches the given string.
   *
   * @param type - A `TaskType` value (e.g., `"Design"`, `"Implementation"`).
   */
  getTasksByType(type: string): TaskState[] {
    return this.state.tasks.filter((t) => t.type === type);
  }

  /**
   * Return all tasks whose `status` field matches the given value.
   *
   * @param status - A `TaskStatus` value (e.g., `"complete"`, `"escalated"`).
   */
  getTasksByStatus(status: TaskStatus): TaskState[] {
    return this.state.tasks.filter((t) => t.status === status);
  }

  /**
   * Set the iteration caps read from the active execution profile.
   * Called once per run from `Orchestrator.run()` before any tasks are created.
   *
   * @param reviewMax - Maximum review-loop iterations before escalation.
   * @param testMax   - Maximum test-fix attempts before escalation.
   */
  setMaxIterations(reviewMax: number, testMax: number): void {
    this.state.maxReviewIterations = reviewMax;
    this.state.maxTestRetries = testMax;
  }

  // ─── Completion ────────────────────────────────────────────────────────

  /**
   * Mark the sprint as finished: sets phase to `"complete"`, records `completedAt`,
   * triggers a UI update (which clears the task widget), and persists.
   * Called by the orchestrator at the end of Phase 4 (or fast-path completion).
   */
  complete(): void {
    this.state.phase = "complete";
    this.state.completedAt = new Date().toISOString();
    this.updateUI();
    this.persist();
  }

  // ─── Status Summary ────────────────────────────────────────────────────

  /**
   * Build a human-readable multi-line status string for diagnostics (e.g., for `/mlst-status`).
   * Includes the current phase, classification, task counts, and per-task status icons.
   *
   * @returns A newline-separated string. Never throws.
   */
  getStatusSummary(): string {
    const s = this.state;
    const lines: string[] = [];
    lines.push(`Phase: ${s.phase}`);
    if (s.classification) lines.push(`Type: ${s.classification}`);

    if (s.tasks.length > 0) {
      const complete = s.tasks.filter((t) => t.status === "complete").length;
      const inProgress = s.tasks.filter((t) => t.status === "in-progress").length;
      const escalated = s.tasks.filter((t) => t.status === "escalated").length;
      lines.push(`Tasks: ${complete}/${s.tasks.length} complete, ${inProgress} in progress`);
      if (escalated > 0) lines.push(`Escalated: ${escalated}`);
      lines.push("");
      for (const t of s.tasks) {
        const icon = STATUS_ICONS[t.status] ?? "?";
        lines.push(`  ${icon} ${t.id}: ${t.title} [${t.status}]`);
      }
    }

    return lines.join("\n");
  }

  // ─── Restore from Session ──────────────────────────────────────────────

  /**
   * Rehydrate state from a plain object (e.g., deserialized from session persistence).
   * Merges the provided data over a fresh `defaultState()`, so missing fields fall back
   * to defaults rather than being `undefined`. Triggers a UI update after restore.
   *
   * @param data - An unknown value; must be a plain object to have any effect.
   */
  restore(data: unknown): void {
    if (data && typeof data === "object") {
      this.state = { ...this.defaultState(), ...(data as Partial<SprintState>) };
      this.updateUI();
    }
  }

  // ─── Internals ─────────────────────────────────────────────────────────

  /**
   * Persist current state to the session log via `appendEntry`.
   *
   * **Currently disabled:** calling `appendEntry` inside a `tool_call` or `session_start`
   * handler caused a stack overflow deep in pi's session machinery (the session log write
   * triggered another event, which called persist again). The root cause has not been
   * identified yet. State persistence is handled by SQLite ({@link MlstDatabase}) instead.
   * Re-enable this method when the re-entrancy issue is resolved.
   */
  private persist(): void {
    // appendEntry disabled — was causing stack overflow in pi's session machinery.
    // State persists via SQLite (db.ts) instead. Re-enable when root cause is found.
    // this.deps.appendEntry("mlst-state", this.state);
  }

  /**
   * Push the current state to the pi TUI.
   *
   * Sets the `"mlst"` status line to `"MLST: <phase> (N/M tasks)"` while running;
   * clears it when `phase` is `"idle"` or `"complete"`.
   *
   * The `"mlst-tasks"` widget is always cleared — task display is handled by the
   * `mlst-live` widget in index.ts with richer formatting.
   */
  private updateUI(): void {
    const s = this.state;

    // Status line
    const phaseLabel = PHASE_LABELS[s.phase] ?? s.phase;
    if (s.phase === "idle" || s.phase === "complete") {
      this.deps.setStatus("mlst", undefined);
    } else {
      const taskProgress =
        s.tasks.length > 0
          ? ` (${s.tasks.filter((t) => t.status === "complete").length}/${s.tasks.length})`
          : "";
      this.deps.setStatus("mlst", `MLST: ${phaseLabel}${taskProgress}`);
    }

    // Task widget — disabled; the mlst-live widget in index.ts handles task display
    // with richer formatting (agent badges, progress, collapsing).
    this.deps.setWidget("mlst-tasks", undefined);
  }
}

const PHASE_LABELS: Record<string, string> = {
  idle: "Idle",
  phase0: "Phase 0: Idea Refinement",
  phase1: "Phase 1: Specification",
  phase2: "Phase 2: Task Breakdown",
  phase3: "Phase 3: Execution",
  phase4: "Phase 4: Completion",
  complete: "Complete",
  "fast-path": "Fast Path (Bug Fix)",
  "impl-fast-path": "Implementation Fast Path",
};

const STATUS_ICONS: Record<string, string> = {
  pending: "○",
  "in-progress": "◐",
  testing: "◑",
  reviewing: "◕",
  complete: "●",
  blocked: "⊘",
  escalated: "✗",
};
