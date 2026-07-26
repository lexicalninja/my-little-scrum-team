/**
 * MLST Pi Extension — Orchestrator (Blueprint Engine)
 *
 * Three types of nodes:
 *   [CODE]  — Deterministic TypeScript. Routing, validation, git, linting.
 *   [LLM]   — Direct model calls. Classification, gate evaluation, parsing.
 *   [AGENT] — Full subprocess. Implementation, testing, review.
 *
 * Directory layout:
 *   index.ts           — Core pipeline, phases, review loop, human gates (this file).
 *   helpers.ts         — Pure utilities: concurrency, task/status mappings, clarifications.
 *   task-parser.ts     — Converts scrum-master agent output into TaskState[].
 *   project-tooling.ts — Test suite and linter auto-detection and execution.
 */


import type { AgentResult, ClarificationRequest, Classification, DeletionCheckResult, EscalationAction, ExecutionProfile, GatePoint, HumanGateResult, MlstAgentConfig, MlstEvent, Phase, ReviewReason, TaskState, TaskType } from "../types.js";
import type { Issue, MlstDatabase } from "../db.js";
import type { StateManager } from "../state.js";
import type { SkillLoader } from "../skills.js";
import type { ContextAssembler } from "../context.js";
import type { QualityGates } from "../quality-gates.js";
import type { LlmClient } from "../llm.js";
import type { SpawnOptions } from "../agents.js";
import { spawnAgent, spawnAgentsParallel, formatUsage, rateThrottle } from "../agents.js";
import {
  mapTaskStatusToIssueStatus,
  mapTypeToAgent,
  mapConcurrent,
  topologicalBatches,
  sequentialSpawn,
  joinOutput,
  extractClarifications,
} from "./helpers.js";
import { parseTasks } from "./task-parser.js";
import { runTests, runLint, detectProjectOrientation } from "./project-tooling.js";
export { extractClarifications } from "./helpers.js";

export interface OrchestratorDeps {
  /** In-memory sprint state; also drives the pi TUI widget and status line. */
  state: StateManager;
  /** Lazily-loaded SKILL.md injection for agent system prompts. */
  skills: SkillLoader;
  /** Prompt builder — produces complete prompt strings for every agent and LLM call. */
  context: ContextAssembler;
  /** Deterministic validation gates (task breakdown, deletion check, test-pass heuristic). */
  gates: QualityGates;
  /** Direct LLM client used for classification, gate evaluation, and parsing (no subprocess). */
  llm: LlmClient;
  /** SQLite persistence layer; survives orchestrator interruptions. */
  db: MlstDatabase;
  /** Loaded agent definitions (name, system prompt, file path). */
  agents: MlstAgentConfig[];
  /** Active execution profile (concurrency, gate flags, retry caps). */
  profile: ExecutionProfile;
  /** Absolute path to the project root; all file operations are relative to this. */
  cwd: string;
  /** Optional model override in `"provider/id"` format; propagated to every agent spawn and LLM call. */
  model?: string;
  /** Optional abort signal; passed to every agent spawn and LLM call so the run can be cancelled. */
  signal?: AbortSignal;
  /** Display a toast/notification in the pi TUI. */
  notify: (message: string, level: "info" | "warning" | "error" | "success") => void;
  /** Send a message in the active pi conversation (visible in the chat history). */
  sendMessage: (text: string) => void;
  /** Run a shell command via pi's exec API (or a fallback child_process spawn). */
  exec: (command: string, args: string[]) => Promise<{ stdout: string; stderr: string; code: number }>;
  /** Broadcast a typed event to the dashboard SSE stream and the live widget. */
  emit: (event: MlstEvent) => void;
  /** Called with streaming text as an agent works; drives the live-progress ticker in the TUI. */
  onAgentProgress?: (text: string, toolCount: number) => void;
  /** Update the spinner/status line in the pi TUI (`undefined` clears it). */
  setWorkingMessage: (message?: string) => void;
  /**
   * Prompt the user for freeform text input during a build run.
   *
   * Used to surface clarifying questions from sub-agents. In gated mode this
   * opens a TUI input dialog; in full/review-only mode it returns `null` immediately
   * so the orchestrator can fall back to autonomous decision.
   *
   * @param question - The clarifying question to show the user.
   * @param context  - Optional context string (e.g., agent name, task label) displayed
   *   alongside the question for orientation.
   * @returns The user's text answer, or `null` if the prompt was unavailable or timed out.
   */
  promptUser: (question: string, context?: string) => Promise<string | null>;
}

/**
 * Central coordinator for the MLST build pipeline.
 *
 * Implements three execution paths:
 * - **fast-path** (`bug`): impl → test loop → lint → review.
 * - **impl-fast-path** (`implementation-spec`): same as fast-path, no phases.
 * - **full pipeline** (`feature`, `epic`, `plan`, `requirements`): Phase 0–4.
 *
 * The orchestrator owns no persistent state itself — it delegates to
 * `StateManager` (in-memory + UI), `MlstDatabase` (SQLite), and the
 * `Dashboard` (SSE events) via the `OrchestratorDeps` interface.
 */
export class Orchestrator {
  /** Injected dependencies for this build run; never mutated after construction. */
  private d: OrchestratorDeps;
  /** SQLite project row ID; set during `run()` before any agents are spawned. Zero before `run()`. */
  private projectId = 0;
  /** SQLite sprint row ID for the current run; set during `run()`. Zero before `run()`. */
  private sprintId = 0;
  /** Maps TASK-001 style IDs to DB issue IDs */
  private issueIds = new Map<string, number>();
  /** Sprint context injected into every agent via --append-system-prompt. Set by buildSprintContext() before phase3. */
  private sprintContext = "";
  /**
   * Orchestrator-owned AbortController. Passed to all spawnAgent/llm calls.
   * If deps.signal fires (external abort), this controller is also aborted.
   * The on-escalation "abort" action calls this controller's abort().
   */
  private controller: AbortController;
  /**
   * Gate annotations accumulated from human review gates.
   * Keyed by GatePoint name; values are the structured annotation strings
   * from human feedback. Injected into downstream phase prompts as
   * `## Human Review Notes`.
   */
  private gateAnnotations = new Map<string, string>();
  /** Human-provided reason when the sprint is aborted via the on-escalation gate. */
  private abortReason: string | undefined;
  /** Accumulated gate-specific LLM call count for cost tracking. */
  private gateCost = { llmCalls: 0 };

  /**
   * Wire up the rate throttle event emitter so `rate_limit` events reach the dashboard.
   * Dependencies are accepted shallowly — no validation is performed at construction time.
   *
   * @param deps - All external dependencies for this build run.
   */
  constructor(deps: OrchestratorDeps) {
    this.d = deps;
    rateThrottle.setEventEmitter((ev) => this.d.emit(ev));

    // Create orchestrator-owned AbortController; chain external signal if provided
    this.controller = new AbortController();
    if (deps.signal) {
      deps.signal.addEventListener("abort", () => this.controller.abort(), { once: true });
    }
  }

  // ─── Primitives ─────────────────────────────────────────────────────────

  private setPhase(phase: Phase): void {
    this.d.state.setPhase(phase);
    this.d.emit({ type: "phase", phase, timestamp: Date.now() });
  }

  private emitGate(name: string, passed: boolean, issues: string[] = []): void {
    this.d.emit({ type: "gate", name, passed, issues, timestamp: Date.now() });
  }

  private getAgent(name: string): MlstAgentConfig {
    const agent = this.d.agents.find((a) => a.name === name);
    if (!agent) throw new Error(`Agent "${name}" not found`);
    return agent;
  }

  /**
   * Spawn a named agent and return its text output.
   *
   * Wrapper around `spawnAgent` that:
   * - Sets the working message spinner to `"Agent: <name> (<label>)"`.
   * - Emits `agent_start` and `agent_end` dashboard events.
   * - Throws a descriptive error if the agent exits non-zero.
   * - Replaces empty output with `"(agent completed with no text output)"` and warns.
   *
   * @param name    - Agent name (must match an entry in `this.d.agents`).
   * @param task    - Task description string passed to the agent as its user prompt.
   * @param forTask - Optional task for label extraction (used in dashboard events).
   * @returns The agent's final text output.
   * @throws If the agent exits with a non-zero code.
   */
  private async spawn(name: string, task: string, forTask?: TaskState): Promise<string> {
    const agent = this.getAgent(name);
    const taskLabel = forTask?.label;
    this.d.setWorkingMessage(`Agent: ${name}${taskLabel ? ` (${taskLabel})` : ""}`);
    this.d.emit({ type: "agent_start", agent: name, prompt: task, taskLabel: taskLabel ?? "", timestamp: Date.now() });
    const result = await spawnAgent(agent, task, this.d.skills, {
      cwd: this.d.cwd,
      model: this.d.model,
      signal: this.controller.signal,
      sprintContext: this.sprintContext,
      onProgress: (text, toolCount) => {
        this.d.onAgentProgress?.(text, toolCount);
        this.d.emit({ type: "agent_progress", agent: name, taskLabel: taskLabel ?? "", text, toolCount, timestamp: Date.now() });
      },
    });

    if (result.exitCode !== 0) {
      const err = result.errorMessage || result.stderr || "(no output)";
      throw new Error(`Agent ${name} failed: ${err}`);
    }

    if (!result.output.trim()) {
      this.d.notify(`${name} returned empty output (tools ran: ${result.usage.turns} turns)`, "warning");
      result.output = "(agent completed with no text output)";
    }

    this.d.emit({ type: "agent_end", agent: name, output: result.output, model: result.model, usage: result.usage, taskLabel: taskLabel ?? "", timestamp: Date.now() });
    this.d.notify(`${name} done (${formatUsage(result.usage, result.model)})`, "success");

    // Check for clarification requests in agent output
    const clarification = extractClarifications(result.output, name, taskLabel);
    if (clarification) {
      return this.handleClarification(clarification, name, task, forTask);
    }

    return result.output;
  }

  // ─── Clarification Handling ──────────────────────────────────────────────

  /**
   * Handle a clarification request from a sub-agent.
   *
   * Flow:
   * 1. Pauses the requesting task and notifies the user via TUI.
   * 2. Batches all questions into a single prompt.
   * 3. Prompts the user for an answer via `promptUser`.
   * 4. If the user answers: re-invokes the agent with the answer injected.
   * 5. If no user response (timeout/CI): uses LLM to generate autonomous answers
   *    based on the original task context, then re-invokes the agent.
   *
   * Emits a `clarification` dashboard event regardless of whether the user answered.
   *
   * @param clarification - Parsed clarification request with questions.
   * @param agentName     - Name of the agent that raised the question.
   * @param originalTask  - The original task prompt that was sent to the agent.
   * @param forTask       - Optional task state for label and context.
   * @returns The new agent output after re-invocation with the answer.
   */
  private async handleClarification(
    clarification: ClarificationRequest,
    agentName: string,
    originalTask: string,
    forTask?: TaskState,
  ): Promise<string> {
    const displayId = forTask?.label ?? agentName;
    const batchedQuestion = clarification.questions.length === 1
      ? clarification.questions[0]
      : clarification.questions.map((q, i) => `${i + 1}. ${q}`).join("\n");

    const isGatedMode = this.d.profile.pipelineMode === "gated";

    let answer: string | null = null;
    let autonomous = !isGatedMode;

    // Only prompt user if in gated mode
    if (isGatedMode) {
      this.d.sendMessage(
        `**Clarification needed** from ${displayId}:\n\n${batchedQuestion}`,
      );
      this.d.notify(`${displayId} needs clarification`, "warning");
      answer = await this.d.promptUser(batchedQuestion, displayId);
      autonomous = answer === null;
    }

    // If no user response (or non-gated mode), generate autonomous answers via LLM
    if (answer === null) {
      this.d.notify(`${displayId}: Generating autonomous answers`, "info");
      answer = await this.generateAutonomousAnswers(batchedQuestion, originalTask);
    }

    this.d.emit({
      type: "clarification",
      agent: agentName,
      questions: clarification.questions,
      taskLabel: forTask?.label,
      answer,
      autonomous,
      timestamp: Date.now(),
    });

    // Re-invoke the agent with the answer appended to the task context
    const answerSource = autonomous ? "Orchestrator (autonomous)" : "User";
    this.d.notify(`${displayId}: Resuming with ${answerSource.toLowerCase()}'s answer`, "info");
    const augmentedTask = `${originalTask}\n\n## Clarification Response\n${answerSource} was asked:\n${batchedQuestion}\n\n${answerSource} answered:\n${answer}`;
    return this.spawn(agentName, augmentedTask, forTask);
  }

  /**
   * Generate autonomous answers to clarifying questions using LLM.
   *
   * Uses the original task context to make reasonable decisions about
   * ambiguous requirements. Prefers simple, standard approaches.
   *
   * @param questions - The clarifying questions to answer.
   * @param originalTask - The original task context for reference.
   * @returns LLM-generated answers to the questions.
   */
  private async generateAutonomousAnswers(questions: string, originalTask: string): Promise<string> {
    const systemPrompt = `You are a technical decision-maker helping an AI agent proceed with a task.
The agent has asked clarifying questions. Provide concise, practical answers that:
- Prefer simple, standard approaches over complex ones
- Choose the most common/conventional option when in doubt
- Keep scope minimal — avoid feature creep
- Make decisions that are easy to change later

Answer each question directly and briefly. Do not ask follow-up questions.`;

    const userPrompt = `## Original Task\n${originalTask}\n\n## Questions to Answer\n${questions}\n\nProvide brief, practical answers to help the agent proceed.`;

    return this.llm(systemPrompt, userPrompt, "fast");
  }

  // ─── Human Quality Gates ──────────────────────────────────────────────

  /** Max feedback rounds before force-proceeding. */
  private static MAX_GATE_FEEDBACK_ROUNDS = 3;

  /**
   * LLM analysis prompt templates, keyed by gate point.
   * Each returns a system prompt that analyses the artifact for that gate.
   */
  private static GATE_ANALYSIS_PROMPTS: Record<string, string> = {
    "post-spec": "Review this specification for completeness. Summarize the key decisions, flag any missing sections (requirements, acceptance criteria, edge cases, testing strategy), and list 2-3 questions the reviewer should consider.",
    "post-tasks": "Review this task breakdown. Check: are tasks atomic? Are dependencies correct? Is the critical path reasonable? Are acceptance criteria testable? Flag issues and suggest questions.",
    "post-design": "Review these design outputs. Check: do they align with the spec? Are accessibility requirements covered? Are responsive breakpoints specified? Flag gaps.",
    "on-escalation": "This task was escalated after max iterations. Summarize what went wrong, what was tried, and recommend: retry with different approach / skip / abort sprint.",
    "post-review": "Review the implementation outcome. Summarize what changed, the review result, and flag any remaining concerns.",
  };

  /**
   * Orchestrator-mediated human quality gate.
   *
   * If the gate is not enabled in the profile, returns auto-approved immediately
   * with no LLM analysis call.
   *
   * When enabled:
   * 1. LLM analysis pass — summarizes the artifact, flags risks, suggests questions.
   * 2. Present the Gate Review Brief to the human via sendMessage.
   * 3. Multi-turn promptUser loop (max 3 feedback rounds):
   *    - "approve"/"yes"/"done"/"lgtm" → approved
   *    - null (timeout/CI) → auto-approve with autonomous=true
   *    - Anything else → LLM reconciliation → revised artifact → re-prompt
   * 4. Produce gateAnnotation capturing human constraints for downstream prompts.
   *
   * @param gate     - Which pipeline boundary this is.
   * @param artifact - The artifact to review (spec, task list, design output, etc.).
   * @param context  - Optional additional context for the analysis prompt.
   * @returns HumanGateResult with approval status and optional revised artifact.
   */
  async humanGate(gate: GatePoint, artifact: string, context?: string): Promise<HumanGateResult> {
    // Skip entirely if gate not in profile
    if (!this.d.profile.humanGates.includes(gate)) {
      return { approved: true, feedbackRounds: 0, autonomous: true };
    }

    this.d.emit({
      type: "human_gate",
      gate,
      status: "analyzing",
      feedbackRounds: 0,
      autonomous: false,
      timestamp: Date.now(),
    });

    // Step 1: LLM analysis pass
    const analysisPrompt = Orchestrator.GATE_ANALYSIS_PROMPTS[gate] ?? "Review this artifact. Summarize key points, flag issues, and suggest 2-3 questions.";
    let analysis: string;
    try {
      analysis = await this.llm(analysisPrompt, `${artifact}${context ? `\n\nAdditional context:\n${context}` : ""}`, "balanced");
      this.gateCost.llmCalls++;
    } catch {
      // If LLM analysis fails, present the raw artifact without analysis
      analysis = "(Analysis unavailable)";
    }

    // Step 2: Present artifact + Gate Review Brief
    const briefTitle = `## 🔍 Gate Review: ${gate}`;
    const brief = `${briefTitle}\n\n### Artifact\n\n${artifact}\n\n### Analysis\n\n${analysis}\n\n---\n*Reply 'approve' to proceed, or provide feedback.*`;
    this.d.sendMessage(brief);

    this.d.emit({
      type: "human_gate",
      gate,
      status: "waiting",
      feedbackRounds: 0,
      autonomous: false,
      timestamp: Date.now(),
    });

    // Step 3: Multi-turn promptUser loop
    let currentArtifact = artifact;
    let feedbackRounds = 0;
    const conversationNotes: string[] = [];

    for (let round = 0; round < Orchestrator.MAX_GATE_FEEDBACK_ROUNDS; round++) {
      const prompt = round === 0
        ? `Review the ${gate.replace("post-", "")} above. Reply 'approve' to proceed, or provide feedback.`
        : `Updated. Reply 'approve' to proceed, or provide more feedback.`;

      const response = await this.d.promptUser(prompt, `Gate: ${gate}`);

      // null = timeout/CI → auto-approve
      if (response === null) {
        this.d.emit({
          type: "human_gate",
          gate,
          status: "timeout",
          feedbackRounds,
          autonomous: true,
          timestamp: Date.now(),
        });
        return {
          approved: true,
          revisedArtifact: feedbackRounds > 0 ? currentArtifact : undefined,
          gateAnnotation: conversationNotes.length > 0 ? conversationNotes.join("\n") : undefined,
          feedbackRounds,
          autonomous: true,
        };
      }

      // Check for approval keywords
      const normalized = response.trim().toLowerCase();
      if (["approve", "approved", "yes", "done", "lgtm", "ok", "looks good"].includes(normalized)) {
        const annotation = this.buildGateAnnotation(gate, conversationNotes, round);
        this.gateAnnotations.set(gate, annotation);

        this.d.emit({
          type: "human_gate",
          gate,
          status: "approved",
          feedbackRounds,
          autonomous: false,
          conversationSummary: annotation,
          timestamp: Date.now(),
        });

        return {
          approved: true,
          revisedArtifact: feedbackRounds > 0 ? currentArtifact : undefined,
          gateAnnotation: annotation,
          feedbackRounds,
          autonomous: false,
        };
      }

      // Treat as feedback → LLM reconciliation
      feedbackRounds++;
      conversationNotes.push(`Round ${feedbackRounds}: ${response}`);

      this.d.emit({
        type: "human_gate",
        gate,
        status: "reviewing",
        feedbackRounds,
        autonomous: false,
        timestamp: Date.now(),
      });

      try {
        const reconciled = await this.llm(
          "The user provided feedback on an artifact. Produce a revised version that addresses the feedback, and summarize what changed in a few bullet points at the end.",
          `## Current Artifact\n${currentArtifact}\n\n## User Feedback\n${response}`,
          "balanced",
        );
        currentArtifact = reconciled;
        this.gateCost.llmCalls++;
        this.d.sendMessage(`**Changes based on your feedback (round ${feedbackRounds}):**\n\n${reconciled.slice(-500)}`);
      } catch {
        this.d.sendMessage(`*Could not reconcile feedback — proceeding with current version.*`);
      }
    }

    // Max rounds reached — force-proceed
    this.d.sendMessage(`*Proceeding with current version after ${Orchestrator.MAX_GATE_FEEDBACK_ROUNDS} rounds of feedback.*`);
    const annotation = this.buildGateAnnotation(gate, conversationNotes, feedbackRounds);
    this.gateAnnotations.set(gate, annotation);

    this.d.emit({
      type: "human_gate",
      gate,
      status: "approved",
      feedbackRounds,
      autonomous: false,
      conversationSummary: annotation,
      timestamp: Date.now(),
    });

    return {
      approved: true,
      revisedArtifact: currentArtifact !== artifact ? currentArtifact : undefined,
      gateAnnotation: annotation,
      feedbackRounds,
      autonomous: false,
    };
  }

  /**
   * Build a structured annotation from the gate conversation history.
   * This is injected into the next phase's prompt as `## Human Review Notes`.
   */
  private buildGateAnnotation(gate: string, notes: string[], finalRound: number): string {
    if (notes.length === 0) {
      return `Human approved ${gate} at first prompt (no feedback).`;
    }
    return `Human reviewed ${gate} over ${finalRound} round(s).\nFeedback summary:\n${notes.join("\n")}`;
  }

  /**
   * Get accumulated gate annotations as a formatted string for prompt injection.
   * Returns empty string if no annotations exist.
   */
  private getGateAnnotationsForPrompt(): string {
    if (this.gateAnnotations.size === 0) return "";
    const lines: string[] = ["## Human Review Notes"];
    for (const [gate, annotation] of this.gateAnnotations) {
      lines.push(`### ${gate}\n${annotation}`);
    }
    return lines.join("\n\n");
  }

  /** Get gate cost tracking data. */
  getGateCost(): { llmCalls: number } {
    return { ...this.gateCost };
  }

  /**
   * Handle an on-escalation gate: present the escalation to the human
   * and return their chosen action.
   *
   * @param task      - The escalated task.
   * @param review    - The final review output.
   * @param iteration - The iteration count when escalation occurred.
   * @returns The human's chosen action, or "escalate" if no human input.
   */
  private async handleEscalationGate(
    task: TaskState,
    review: string,
    iteration: number,
  ): Promise<EscalationAction> {
    if (!this.d.profile.humanGates.includes("on-escalation")) {
      return "escalate";
    }

    // LLM analysis of what went wrong
    const analysisPrompt = Orchestrator.GATE_ANALYSIS_PROMPTS["on-escalation"];
    let analysis: string;
    try {
      analysis = await this.llm(
        analysisPrompt,
        `Task: ${task.label} - ${task.title}\nEscalated after ${iteration} iterations.\nLast review:\n${review}`,
        "balanced",
      );
      this.gateCost.llmCalls++;
    } catch {
      analysis = "(Analysis unavailable)";
    }

    this.d.sendMessage(`## ⚠️ Task Escalated: ${task.label}\n\n${analysis}`);

    this.d.emit({
      type: "human_gate",
      gate: "on-escalation",
      status: "waiting",
      feedbackRounds: 0,
      autonomous: false,
      timestamp: Date.now(),
    });

    const response = await this.d.promptUser(
      `Task ${task.label} escalated. Choose: retry / skip / escalate / abort`,
      `Escalation: ${task.label}`,
    );

    if (response === null) {
      this.d.emit({
        type: "human_gate",
        gate: "on-escalation",
        status: "timeout",
        feedbackRounds: 0,
        autonomous: true,
        timestamp: Date.now(),
      });
      return "escalate";
    }

    const normalized = response.trim().toLowerCase();
    const validActions: EscalationAction[] = ["retry", "skip", "escalate", "abort"];
    const action = validActions.find((a) => normalized.startsWith(a)) ?? "escalate";

    this.d.emit({
      type: "human_gate",
      gate: "on-escalation",
      status: action === "abort" ? "rejected" : "approved",
      feedbackRounds: 0,
      autonomous: false,
      conversationSummary: `Action: ${action}. Human said: ${response}`,
      timestamp: Date.now(),
    });

    return action;
  }

  /**
   * Execute a direct LLM call and return the response text.
   *
   * Wrapper around `LlmClient.call` that:
   * - Sets the working message to `"LLM: <first 40 chars of system prompt>..."` while running.
   * - Emits `llm_start` and `llm_end` dashboard events.
   * - Throws if the response is empty.
   *
   * @param system - System prompt text.
   * @param user   - User prompt text.
   * @param tier   - Reasoning depth hint for observability (does not change the model).
   * @returns The model's response text.
   * @throws If the model returns an empty response.
   */
  private async llm(system: string, user: string, tier: "fast" | "balanced" | "strong" = "fast"): Promise<string> {
    const purpose = system.slice(0, 60);
    this.d.setWorkingMessage(`LLM: ${purpose.slice(0, 40)}...`);
    this.d.emit({ type: "llm_start", purpose, system, user, tier, timestamp: Date.now() });
    const response = await this.d.llm.call(system, user, {
      tier,
      signal: this.controller.signal,
      onProgress: (text) => this.d.setWorkingMessage(`LLM: ${text.slice(0, 60)}`),
    });
    this.d.emit({ type: "llm_end", purpose, response, timestamp: Date.now() });

    if (!response.trim()) {
      throw new Error(`LLM returned empty response for: ${purpose}`);
    }

    return response;
  }

  /** Instrumented exec — emits events, shows in dashboard/logs. For workflow steps. */
  private async exec(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
    this.d.setWorkingMessage(`Running: ${cmd} ${args.slice(0, 2).join(" ")}`);
    this.d.emit({ type: "exec_start", command: cmd, args, timestamp: Date.now() });
    const result = await this.d.exec(cmd, args);
    this.d.emit({ type: "exec_end", command: cmd, code: result.code, stdout: result.stdout, timestamp: Date.now() });
    return result;
  }

  /** Silent exec — no events, no spinner. For internal housekeeping (search, file checks). */
  private async execQuiet(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
    return this.d.exec(cmd, args);
  }

  /**
   * Propagate a partial task update to three destinations simultaneously:
   * 1. In-memory `StateManager` (triggers UI update).
   * 2. Dashboard `task` event (updates live widget).
   * 3. SQLite via `MlstDatabase.updateIssue()` (persistent; survives interruptions).
   *
   * Status transitions additionally set `closed_at` in SQLite when moving to
   * `"complete"` or `"escalated"`.
   *
   * @param taskId - UUID of the task to update.
   * @param update - Partial `TaskState` fields to apply.
   */
  private updateTask(taskId: string, update: Partial<TaskState>): void {
    this.d.state.updateTask(taskId, update);

    if (update.status) {
      const task = this.d.state.getTask(taskId);
      if (task) this.d.emit({ type: "task", id: task.label, status: update.status, title: task.title, timestamp: Date.now() });
    }

    const dbId = this.issueIds.get(taskId);
    if (!dbId) return;

    const dbUpdate: IssueUpdatePayload = {};
    if (update.status) {
      dbUpdate.status = mapTaskStatusToIssueStatus(update.status);
      if (update.status === "complete" || update.status === "escalated") {
        dbUpdate.closed_at = new Date().toISOString();
      }
    }
    if (update.output !== undefined) dbUpdate.output = update.output;
    if (update.reviewOutput !== undefined) dbUpdate.review_output = update.reviewOutput;
    if (update.designOutput !== undefined) dbUpdate.design_output = update.designOutput;
    if (update.iterationCount !== undefined) dbUpdate.iteration_count = update.iterationCount;

    if (Object.keys(dbUpdate).length > 0) {
      this.d.db.updateIssue(dbId, dbUpdate);
    }
  }

  // ─── Entry Point ────────────────────────────────────────────────────────

  /**
   * Top-level entry point for a build run.
   *
   * Resets in-memory state, persists a new project/sprint to SQLite, classifies the
   * input via LLM, and routes to the appropriate execution path:
   * - `"bug"`                → {@link fastPath}
   * - `"implementation-spec"` → {@link implFastPath}
   * - `"requirements"`        → {@link fullPipeline} with `skipPhase0 = true`
   * - `"plan"`, `"epic"`, `"feature"` → {@link fullPipeline} with `skipPhase0 = false`
   *
   * @param input - Resolved user input (file references already inlined).
   * @param opts  - Optional run options.
   * @param opts.isPrd - When `true`, the input is a PRD from `/prd`. Classification is
   *   forced to `"requirements"` and Phase 1 (specification) is skipped — the PRD
   *   content is used directly as the spec.
   * @returns A summary string when the run completes.
   */
  async run(input: string, opts?: { isPrd?: boolean }): Promise<string> {
    this.d.state.reset(input);
    this.d.state.setMaxIterations(this.d.profile.maxReviewIterations, this.d.profile.maxTestRetries);

    // Persist to SQLite — survives interruptions
    const project = this.d.db.getOrCreateProject(this.d.cwd);
    this.projectId = project.id;
    const sprint = this.d.db.createSprint(project.id, input.slice(0, 100), input);
    this.sprintId = sprint.id;

    // PRD shortcut: skip classification and use the PRD as the spec directly
    if (opts?.isPrd) {
      const type: Classification = "requirements";
      this.d.state.setClassification(type);
      this.d.db.updateSprint(this.sprintId, { classification: type });
      this.d.emit({ type: "sprint_start", input: input.slice(0, 200), classification: type, timestamp: Date.now() });
      this.d.sendMessage("Classified as **requirements** (PRD input — skipping classification and specification phases)");
      return this.fullPipeline(input, true, true);
    }

    this.d.setWorkingMessage("Classifying input...");
    const { type, reason } = await this.classify(input);
    this.d.state.setClassification(type);
    this.d.db.updateSprint(this.sprintId, { classification: type });
    this.d.emit({ type: "sprint_start", input: input.slice(0, 200), classification: type, timestamp: Date.now() });
    this.d.sendMessage(`Classified as **${type}**: ${reason}`);

    switch (type) {
      case "bug": return this.fastPath(input);
      case "implementation-spec": return this.implFastPath(input);
      case "requirements": return this.fullPipeline(input, true);
      case "plan": return this.fullPipeline(input, false);
      case "epic": case "feature": return this.fullPipeline(input, false);
    }
  }

  // ─── Classification ─────────────────────────────────────────────────────

  /**
   * Classify the input into one of six categories using an LLM call.
   *
   * Uses a structured `TYPE: <category>\nREASON: <sentence>` prompt. Falls back to
   * `"feature"` if the response is missing or contains an unrecognized category.
   *
   * The most common confusion: a document with `Overview` / `Acceptance Criteria` sections
   * is `"requirements"`, NOT `"implementation-spec"`. An implementation-spec must have
   * literal file paths and code diffs.
   *
   * @param input - The user's raw input text.
   * @returns The classification type and a one-sentence reason.
   */
  private async classify(input: string): Promise<{ type: Classification; reason: string }> {
    const response = await this.llm(
      `Classify into one category. Respond: TYPE: <category>\nREASON: <one sentence>

Categories:
- bug — describes a DEFECT with expected vs actual behavior, error messages, stack traces
- implementation-spec — gives EXACT file paths AND line-by-line code changes to make. Very rare. A PRD is NOT this.
- requirements — a PRD, spec, or feature description with acceptance criteria. This is the most common for documents.
- plan — multiple features or a roadmap
- epic — a large system or multi-component body of work
- feature — a single feature described in plain language

IMPORTANT: If the input is a document with sections like "Overview", "Tech Stack", "Acceptance Criteria", "Constraints" — it is "requirements", NOT "implementation-spec". An implementation-spec must have literal file paths and code diffs.`,
      input,
    );

    const type = response.match(/TYPE:\s*(\w[\w-]*)/i)?.[1]?.toLowerCase();
    const reason = response.match(/REASON:\s*(.+)/i)?.[1]?.trim() ?? "";
    const valid = ["bug", "implementation-spec", "requirements", "plan", "epic", "feature"];

    return { type: (valid.includes(type ?? "") ? type : "feature") as Classification, reason };
  }

  // ─── Fast Paths ─────────────────────────────────────────────────────────

  /**
   * Fast-path execution for bug fixes.
   *
   * Skips all pipeline phases. Flow:
   * 1. `mlst-impl-engineer` with bug-fix prompt (write failing test → fix → verify).
   * 2. `ensureTestsPass` auto-fix loop.
   * 3. `runLint`.
   * 4. `reviewLoop`.
   *
   * @param input - Bug description from the user.
   * @returns `"Bug fix complete."` on success.
   */
  private async fastPath(input: string): Promise<string> {
    this.setPhase("fast-path");
    this.d.sendMessage("**Fast Path** (bug fix)");

    const orientation = await this.getProjectOrientation();
    let impl = await this.spawn("mlst-impl-engineer", this.d.context.buildBugFixPrompt(input, orientation));
    impl = await this.ensureTestsPass(impl, input);
    await this.runLint();
    await this.reviewLoop(impl, input, "bug-fix");

    // Post-review gate for fast paths
    await this.humanGate("post-review", impl, "fast-path bug-fix review");

    this.d.state.complete();
    this.d.emit({ type: "sprint_end", summary: "Bug fix complete", timestamp: Date.now() });
    return "Bug fix complete.";
  }

  /**
   * Fast-path execution for `implementation-spec` inputs.
   *
   * Like {@link fastPath} but uses the impl-from-spec prompt (explicit spec,
   * no bug-hunt framing). Flow:
   * 1. `mlst-impl-engineer` with impl-from-spec prompt.
   * 2. `ensureTestsPass` auto-fix loop.
   * 3. `runLint`.
   * 4. `reviewLoop`.
   *
   * @param input - Exact implementation specification from the user.
   * @returns `"Implementation complete."` on success.
   */
  private async implFastPath(input: string): Promise<string> {
    this.setPhase("impl-fast-path");
    this.d.sendMessage("**Implementation Fast Path**");

    const orientation = await this.getProjectOrientation();
    let impl = await this.spawn("mlst-impl-engineer", this.d.context.buildImplFromSpecPrompt(input, orientation));
    impl = await this.ensureTestsPass(impl, input);
    await this.runLint();
    await this.reviewLoop(impl, input, "impl-spec");

    // Post-review gate for fast paths
    await this.humanGate("post-review", impl, "fast-path impl-spec review");

    this.d.state.complete();
    this.d.emit({ type: "sprint_end", summary: "Implementation complete", timestamp: Date.now() });
    return "Implementation complete.";
  }

  // ─── Full Pipeline ──────────────────────────────────────────────────────

  /**
   * Full five-phase pipeline for features, epics, plans, and requirements.
   *
   * Phases:
   * 0. Idea refinement (optional, controlled by `profile.enablePhase0` and `skipPhase0`).
   * 1. Specification — `mlst-spec-writer` produces a full project spec.
   * 2. Task breakdown — `mlst-scrum-master` converts spec to tasks; persisted to SQLite.
   * 3. Execution — scaffold + Group 1 (design/infra/docs) + Group 2 (impl/testing).
   * 4. Completion — sprint summary generated and sprint marked complete in SQLite.
   *
   * @param input       - User input (may already be structured for `requirements` type).
   * @param skipPhase0  - `true` for `requirements` inputs (already structured; no refinement needed).
   * @param skipPhase1  - `true` when input is a PRD from `/prd`; the PRD content is used directly
   *   as the specification, skipping the spec-writer agent entirely.
   * @returns The LLM-generated sprint summary string from Phase 4.
   */
  private async fullPipeline(input: string, skipPhase0: boolean, skipPhase1 = false): Promise<string> {
    if (!skipPhase0 && this.d.profile.enablePhase0) await this.phase0(input);

    let spec: string;
    if (skipPhase1) {
      // PRD input: use the PRD content directly as the spec
      spec = input;
      this.d.state.setSpecification(spec);
      this.d.db.updateSprint(this.sprintId, { specification: spec });
      this.d.sendMessage("**Phase 1: Specification** — skipped (using PRD as spec)");
    } else {
      spec = await this.phase1(input);
    }

    const tasks = await this.phase2(spec);

    // review-only mode: stop after Phase 2 (spec + tasks for human review)
    if (this.d.profile.pipelineMode === "review-only") {
      this.d.sendMessage("**Review-only mode** — stopping after Phase 2. Use /build --resume to continue.");
      this.d.state.complete();
      this.d.db.updateSprint(this.sprintId, { status: "completed", completed_at: new Date().toISOString() });
      // Persist resume state
      this.persistResumeState(spec, tasks);
      this.d.emit({ type: "sprint_end", summary: "Review-only: spec + tasks produced. Resume with --resume.", timestamp: Date.now() });
      return "Review-only complete. Run /build --resume to continue from Phase 3.";
    }

    this.sprintContext = await this.buildSprintContext(spec, tasks);
    await this.phase3(tasks, spec);
    return this.phase4(tasks);
  }

  /**
   * Phase 0: Idea refinement.
   *
   * Non-blocking — if the idea is unclear, sends a message to the user listing
   * clarifying questions but does NOT halt the pipeline. The build continues
   * regardless of the refinement output.
   *
   * @param input - Raw user input to evaluate.
   */
  private async phase0(input: string): Promise<void> {
    this.setPhase("phase0");
    this.d.sendMessage("**Phase 0: Idea Refinement**");

    const refinement = await this.llm(
      this.d.skills.getOrchestratorSkill("idea-refiner"),
      `Analyze this idea. If clear enough, say "READY TO PROCEED" and summarize. Otherwise list top 3 clarifying questions.\n\n${input}`,
      "balanced",
    );

    if (!/ready to proceed/i.test(refinement)) {
      this.d.sendMessage(`Needs refinement:\n\n${refinement}`);
    }
  }

  /**
   * Phase 1: Specification.
   *
   * Spawns `mlst-spec-writer` with the spec prompt. If `enableSpecGate` is true,
   * runs an LLM completeness check (PASS/FAIL) and emits the result as a gate event.
   * Persists the spec to SQLite and to `StateManager`.
   *
   * @param input - User input to hand off to the spec-writer.
   * @returns The full specification text produced by the agent.
   */
  private async phase1(input: string): Promise<string> {
    this.setPhase("phase1");
    this.d.sendMessage("**Phase 1: Specification**");

    const orientation = await this.getProjectOrientation();
    let spec = await this.spawn("mlst-spec-writer", this.d.context.buildSpecPrompt(input, undefined, undefined, orientation));

    if (this.d.profile.enableSpecGate) {
      const eval_ = await this.llm(
        "Evaluate if this spec is complete. Check: overview, requirements, technical approach, acceptance criteria. Respond PASS or FAIL with bullet points.",
        spec,
      );
      const specPassed = !/^FAIL/i.test(eval_.trim());
      this.emitGate("spec-completeness", specPassed, specPassed ? [] : [eval_]);
      if (!specPassed) this.d.notify(`Spec gate: ${eval_}`, "warning");
    }

    // Human gate: post-spec
    const gateResult = await this.humanGate("post-spec", spec);
    if (gateResult.revisedArtifact) {
      spec = gateResult.revisedArtifact;
    }

    this.d.state.setSpecification(spec);
    this.d.db.updateSprint(this.sprintId, { specification: spec });
    // Persist gate annotations for resume support
    this.persistGateAnnotations();
    return spec;
  }

  /**
   * Phase 2: Task breakdown.
   *
   * Spawns `mlst-scrum-master` and passes the spec. Parses the agent output into
   * `TaskState[]` via `parseTasks()`. Persists every task to SQLite as an issue
   * (labelled by type). Runs the task-breakdown gate and warns on failure.
   *
   * @param spec - Specification text from Phase 1.
   * @returns The parsed and persisted task list.
   */
  private async phase2(spec: string): Promise<TaskState[]> {
    this.setPhase("phase2");
    this.d.sendMessage("**Phase 2: Task Breakdown**");

    // Inject gate annotations from Phase 1 into scrum-master prompt
    const annotations = this.getGateAnnotationsForPrompt();
    const taskOutput = await this.spawn("mlst-scrum-master", this.d.context.buildTaskBreakdownPrompt(spec, annotations || undefined));
    let tasks = await parseTasks(taskOutput, this.llm.bind(this));
    this.d.state.setTasks(tasks);

    // Persist tasks to SQLite
    this.persistTasksToDb(tasks);

    const gate = this.d.gates.taskBreakdownValid(tasks);
    this.emitGate("task-breakdown", gate.passed, gate.issues);
    if (!gate.passed) this.d.notify(`Task gate: ${gate.issues.join(", ")}`, "warning");

    this.d.sendMessage(`Created **${tasks.length}** tasks.`);

    // Human gate: post-tasks
    const taskSummary = tasks.map((t) => `- ${t.label}: ${t.title} [${t.type}] deps=${t.dependencies.length}`).join("\n");
    const gateResult = await this.humanGate("post-tasks", taskSummary, spec);
    if (gateResult.revisedArtifact) {
      // Re-parse the revised task list
      tasks = await parseTasks(gateResult.revisedArtifact, this.llm.bind(this));
      this.d.state.setTasks(tasks);
      // Re-persist to SQLite (clear old ones by re-creating)
      this.issueIds.clear();
      this.persistTasksToDb(tasks);
      this.d.sendMessage(`Tasks updated after human review: **${tasks.length}** tasks.`);
    }

    // Persist gate annotations for resume support
    this.persistGateAnnotations();
    return tasks;
  }

  /**
   * Persist tasks to SQLite and build issue ID map.
   * Extracted to support re-persistence after gate revision.
   */
  private persistTasksToDb(tasks: TaskState[]): void {
    for (const task of tasks) {
      const issue = this.d.db.createIssue({
        project_id: this.projectId,
        sprint_id: this.sprintId,
        title: task.title,
        body: task.acceptanceCriteria.join("\n"),
        type: task.type,
        assigned_agent: task.assignedAgent,
        dependencies: task.dependencies,
        acceptance_criteria: task.acceptanceCriteria,
        files_affected: task.filesAffected,
      });
      this.issueIds.set(task.id, issue.id);

      // Add type as a label
      const label = this.d.db.getOrCreateLabel(this.projectId, task.type);
      this.d.db.addLabelToIssue(issue.id, label.id);
    }
  }

  /**
   * Build the sprint context string (tech stack, tasks, coding guidelines) to be
   * injected into every agent subprocess via --append-system-prompt.
   *
   * Does NOT write to the filesystem. The project's existing AGENTS.md (if any)
   * is left completely untouched.
   *
   * When `profile.skipAgentsMdExtraction` is `true` (local profile), the LLM call
   * that extracts tech stack and conventions from the spec is skipped and placeholder
   * values are used instead, saving context tokens on hardware-bound runs.
   *
   * @param spec  - Full specification text from Phase 1 (source for stack/convention extraction).
   * @param tasks - Task list from Phase 2 (written as a numbered list into the context string).
   * @returns The assembled sprint context string.
   */
  private async buildSprintContext(spec: string, tasks: TaskState[]): Promise<string> {
    const taskList = tasks.map((t, i) => `${i + 1}. ${t.label}: ${t.title}`).join("\n");

    let stackLine = "Not specified";
    let convSection = "- Follow the specification";

    if (!this.d.profile.skipAgentsMdExtraction) {
      // Use LLM to extract tech stack and conventions — just the facts
      const extracted = await this.llm(
        `From this specification, extract two lists. Format exactly as shown:
STACK: item1, item2, item3
CONVENTIONS: convention1 | convention2 | convention3

STACK = languages, frameworks, build tools, test frameworks, package managers mentioned.
CONVENTIONS = syntax rules, API patterns, naming conventions specific to this project.

Output ONLY these two lines, nothing else.`,
        spec,
      );

      stackLine = extracted.match(/STACK:\s*(.+)/i)?.[1] ?? "Not specified";
      const convLine = extracted.match(/CONVENTIONS:\s*(.+)/i)?.[1] ?? "";
      const conventions = convLine.split("|").map((c) => c.trim()).filter(Boolean);
      if (conventions.length > 0) {
        convSection = conventions.map((c) => `- ${c}`).join("\n");
      }
    }

    const content = `# Project

## Tech Stack
${stackLine}

## Conventions
${convSection}

## Tasks
${taskList}

## Coding Guidelines

### Core Principles
- Simplicity First: generate the most direct solution that meets requirements
- Established Tech: default to proven technologies unless newer approaches requested
- Explicit Code: write straightforward code; avoid clever one-liners
- Reason Then Code: show logic before implementing complex solutions

### Implementation
- Implement Only What's Asked: no extra features or future-proofing unless requested
- Contract-First Development: define interfaces and contracts before implementation when building integrations
- Start with Happy Path: handle edge cases later unless security concerns
- Lean Code: skip retry logic and other complexity unless explicitly needed
- Modern Tooling: use pnpm for Node (not npm), uv for Python (not pip), current stable language versions

### Code Structure
- Limit Nesting: keep conditionals/loops under 3 layers
- Function Length: 25-30 lines max; break up longer functions
- Favor Pure Functions: minimize side effects
- Concrete Over Abstract: avoid abstraction unless it adds real value
- Unix Philosophy: each function should do one thing well; prefer composition
- Early Return: use guard clauses to reduce complexity

### Testing
- Test-Driven Development: write tests first when requirements are clear
- Tests as Specifications: structure tests to clearly articulate what the code should do, not how
- Test Levels: unit tests for domain logic, integration tests for API contracts and component interactions

### Security
- Validate Inputs: include reasonable validation, especially for user data
- Secrets Management: NEVER commit secrets, API keys, or credentials; use environment variables
`;


    this.d.notify("Sprint context ready — injecting into all agents via system prompt.", "info");
    return content;
  }

  /**
   * Scaffold the project if it has no source files yet.
   *
   * Checks `getProjectOrientation()` first; if the project already has files (non-empty
   * orientation string), scaffolding is skipped entirely. When it runs, it invalidates
   * the orientation cache so subsequent calls see the newly created files.
   *
   * @param spec - Specification for tech-stack reference (not full implementation).
   */
  private async scaffold(spec: string): Promise<void> {
    const orientation = await this.getProjectOrientation();

    // Skip scaffolding if the project already has source files (e.g., adding to existing codebase)
    if (orientation) return;

    this.d.sendMessage("**Scaffolding** — wiring tech stack");
    this.setPhase("scaffold");

    await this.spawn("mlst-impl-engineer", this.d.context.buildScaffoldPrompt(spec));

    // Invalidate orientation cache — project now has files
    this.orientationCache = null;
  }

  /**
   * Phase 3: Execution.
   *
   * Runs scaffold (if the project is empty), then Group 1 (design/infra/docs in parallel),
   * then Group 2 (implementation/testing tasks in topological batches).
   *
   * @param tasks - All tasks from Phase 2.
   * @param spec  - Specification text used as context for all agents.
   */
  private async phase3(tasks: TaskState[], spec: string): Promise<void> {
    this.setPhase("phase3");
    this.d.sendMessage("**Phase 3: Execution**");

    await this.scaffold(spec);
    await this.executeGroup1(tasks, spec);

    // Human gate: post-design (between Group 1 and Group 2)
    const designTasks = tasks.filter((t) => t.type === "Design");
    if (designTasks.length > 0) {
      const designSummary = designTasks
        .map((t) => {
          const state = this.d.state.getTask(t.id);
          return `### ${t.label}: ${t.title}\n${state?.designOutput ?? "(no output)"}`.slice(0, 2000);
        })
        .join("\n\n");
      const gateResult = await this.humanGate("post-design", designSummary, spec);
      if (gateResult.revisedArtifact) {
        // Update design outputs from revised content
        for (const t of designTasks) {
          this.updateTask(t.id, { designOutput: gateResult.revisedArtifact });
        }
      }
    }

    // Check abort before starting Group 2
    if (this.controller.signal.aborted) {
      this.d.sendMessage("**Sprint aborted** — skipping Group 2 execution.");
      return;
    }

    await this.executeGroup2(tasks, spec);
  }

  /**
   * Phase 4: Completion.
   *
   * Generates an LLM sprint summary (what completed, what escalated, follow-ups),
   * marks the sprint `completed` in SQLite, emits `sprint_end`, and calls
   * `StateManager.complete()` to clear the TUI widgets.
   *
   * @param tasks - All tasks; their final statuses drive the summary prompt.
   * @returns The LLM-generated sprint summary string.
   */
  private async phase4(tasks: TaskState[]): Promise<string> {
    this.setPhase("phase4");

    const isAborted = this.controller.signal.aborted;

    const lines = tasks.map((t) => {
      const s = this.d.state.getTask(t.id);
      const icon = s?.status === "complete" ? "✓" : s?.status === "escalated" ? "✗" : "○";
      return `- ${icon} ${t.label}: ${t.title} [${s?.status}]`;
    });

    const completed = this.d.state.getTasksByStatus("complete").length;
    const abortReason = isAborted ? (this.abortReason ?? "Sprint aborted by user") : undefined;
    let summary: string;
    try {
      const prompt = isAborted
        ? "This sprint was aborted. Summarize: what was accomplished, what was in progress, and the abort reason."
        : "Summarize this sprint concisely. What completed, what escalated, follow-ups.";
      const context = isAborted
        ? `${lines.join("\n")}\n\nCompleted: ${completed}/${tasks.length}\nAbort reason: ${abortReason}`
        : `${lines.join("\n")}\n\nCompleted: ${completed}/${tasks.length}`;
      summary = await this.llm(prompt, context);
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      this.d.notify(`Sprint summary unavailable: ${reason}`, "warning");
      summary = isAborted
        ? `Sprint aborted. ${completed}/${tasks.length} tasks completed. Reason: ${abortReason}. (Summary unavailable: ${reason})`
        : `Sprint complete. ${completed}/${tasks.length} tasks completed. (Summary unavailable: ${reason})`;
    }

    this.d.state.complete();
    const sprintUpdate: Record<string, string> = {
      status: isAborted ? "aborted" : "completed",
      completed_at: new Date().toISOString(),
    };
    if (abortReason) sprintUpdate.abort_reason = abortReason;
    this.d.db.updateSprint(this.sprintId, sprintUpdate as any);
    this.d.emit({ type: "sprint_end", summary, aborted: isAborted || undefined, abortReason: abortReason || undefined, timestamp: Date.now() });
    this.d.sendMessage(summary);
    return summary;
  }

  // ─── Phase 3 Groups ─────────────────────────────────────────────────────

  /**
   * Execute Group 1 tasks: Design, Infrastructure/Deployment, and Documentation.
   *
   * All three task types run in parallel (or sequentially when `profile.sequentialGroup1`
   * is true). Jobs are built in this order: `design[]`, `infra[]`, `docs[]`, and result
   * indices mirror that same order so results are mapped back correctly.
   *
   * Design output is stored as `designOutput` (injected into impl GREEN-phase prompts).
   * Infra and docs output is stored as `output`.
   *
   * @param tasks - All sprint tasks (filtered internally to Group 1 types).
   * @param spec  - Specification for agent context.
   */
  private async executeGroup1(tasks: TaskState[], spec: string): Promise<void> {
    const design = tasks.filter((t) => t.type === "Design");
    const infra = tasks.filter((t) => t.type === "Infrastructure" || t.type === "Deployment");
    const docs = tasks.filter((t) => t.type === "Documentation");
    if (design.length === 0 && infra.length === 0 && docs.length === 0) return;

    this.d.sendMessage(`Group 1: ${design.length} design + ${infra.length} infra + ${docs.length} docs (parallel)`);

    const jobs = [
      ...design.map((t) => ({ agent: this.getAgent("mlst-designer"), task: this.d.context.buildDesignPrompt(t, spec) })),
      ...infra.map((t) => ({ agent: this.getAgent("mlst-infra-engineer"), task: this.d.context.buildInfraPrompt(t, spec) })),
      ...docs.map((t) => ({ agent: this.getAgent("mlst-impl-engineer"), task: this.d.context.buildDocPrompt(t, spec) })),
    ];

    const spawnOpts = { cwd: this.d.cwd, model: this.d.model, signal: this.controller.signal, sprintContext: this.sprintContext, onProgress: this.d.onAgentProgress };
    const results = this.d.profile.sequentialGroup1
      ? await sequentialSpawn(jobs, this.d.skills, spawnOpts)
      : await spawnAgentsParallel(jobs, this.d.skills, spawnOpts);

    design.forEach((t, i) => this.updateTask(t.id, {
      status: results[i].exitCode === 0 ? "complete" : "escalated",
      designOutput: results[i].output,
    }));
    infra.forEach((t, i) => this.updateTask(t.id, {
      status: results[design.length + i].exitCode === 0 ? "complete" : "escalated",
      output: results[design.length + i].output,
    }));
    docs.forEach((t, i) => this.updateTask(t.id, {
      status: results[design.length + infra.length + i].exitCode === 0 ? "complete" : "escalated",
      output: results[design.length + infra.length + i].output,
    }));
  }

  /**
   * Execute Group 2 tasks: Implementation and Testing.
   *
   * Tasks are sorted into topological batches by `topologicalBatches()`. Each batch
   * runs with up to `profile.group2Concurrency` tasks in parallel. Within each batch,
   * tasks run via `mapConcurrent` — a pool-based concurrency limiter.
   *
   * @param tasks - All sprint tasks (filtered internally to Implementation and Testing types).
   * @param spec  - Specification for agent context.
   */
  private async executeGroup2(tasks: TaskState[], spec: string): Promise<void> {
    const impl = tasks.filter((t) =>
      t.type === "Implementation" || t.type === "Testing",
    );
    if (impl.length === 0) return;

    this.d.sendMessage(`Group 2: ${impl.length} implementation tasks`);

    for (const batch of topologicalBatches(impl, tasks)) {
      // Check abort before starting each batch
      if (this.controller.signal.aborted) {
        this.d.sendMessage("**Batch skipped** — sprint aborted.");
        break;
      }
      this.d.sendMessage(`Batch: ${batch.map((t) => t.label).join(", ")}`);
      await mapConcurrent(batch, this.d.profile.group2Concurrency, (t) =>
        this.controller.signal.aborted ? Promise.resolve() : this.executeImplTask(t, spec),
      );
    }
  }

  // ─── Task Execution (TDD: RED → GREEN → verify → lint → review) ─────

  /**
   * Execute a single implementation/testing task through the full TDD loop.
   *
   * Flow:
   * 1. `createCheckpoint` — git stash push+pop for a reflog recovery point.
   * 2. `writeTaskTests` — RED: test-runner writes failing tests.
   * 3. `implementTask` — GREEN: impl-engineer makes tests pass.
   * 4. `checkDeletions` — classify scope of changes via `git diff --stat`.
   * 5. `ensureTestsPassForTask` — auto-fix loop with retries.
   * 6. `runLint`.
   * 7. `reviewTask` — review loop (up to `maxReviewIterations`).
   *
   * On any unrecoverable error, the task is escalated.
   *
   * @param task - The task to execute.
   * @param spec - Sprint specification for agent context.
   */
  private async executeImplTask(task: TaskState, spec: string): Promise<void> {
    // Check abort before starting each task
    if (this.controller.signal.aborted) return;

    this.updateTask(task.id, { status: "in-progress" });

    try {
      // Checkpoint: snapshot working tree so we can recover from bad deletions
      await this.createCheckpoint(task.id);

      // Inject gate annotations into task context
      const annotations = this.getGateAnnotationsForPrompt();
      const designOutput = this.getDependentDesignOutput(task);
      const taskContext = this.getTaskContext(task);
      const testSpec = await this.writeTaskTests(task, spec, taskContext);
      let impl = await this.implementTask(task, spec, testSpec, designOutput);
      this.updateTask(task.id, { output: impl });

      // Deletion check: classify scope of changes before proceeding to review
      const deletionCheck = await this.checkDeletions(task.id);

      impl = await this.ensureTestsPassForTask(impl, task);
      await this.runLint();
      await this.reviewTask(task, spec, impl, deletionCheck);
    } catch (err: unknown) {
      this.d.notify(`${task.label}: ${err instanceof Error ? err.message : err}`, "error");

      // On-escalation gate: let the human decide what to do
      const lastReview = this.d.state.getTask(task.id)?.reviewOutput ?? "(no review output)";
      const iteration = this.d.state.getTask(task.id)?.iterationCount ?? 0;
      const action = await this.handleEscalationGate(task, lastReview, iteration);

      switch (action) {
        case "retry": {
          // Reset and retry with guidance
          this.updateTask(task.id, { status: "pending", iterationCount: 0 });
          this.d.notify(`${task.label}: Retrying with fresh approach`, "info");
          return this.executeImplTask(task, spec);
        }
        case "skip": {
          this.d.notify(`${task.label}: Skipped by user`, "warning");
          this.updateTask(task.id, { status: "complete" });
          return;
        }
        case "abort": {
          this.abortReason = `User aborted at task ${task.label}: ${err instanceof Error ? err.message : String(err)}`;
          this.controller.abort();
          this.updateTask(task.id, { status: "escalated" });
          return;
        }
        case "escalate":
        default: {
          this.updateTask(task.id, { status: "escalated" });
          return;
        }
      }
    }
  }

  /**
   * Find the design output from a Group 1 Design task that this task depends on.
   *
   * Looks up the task's `dependencies` list against all Design-type tasks in state.
   * Returns `undefined` when the task has no Design dependency or that task has no output yet.
   *
   * @param task - The implementation task whose design dependency to resolve.
   * @returns The matched Design task's `designOutput`, or `undefined` if none.
   */
  private getDependentDesignOutput(task: TaskState): string | undefined {
    return this.d.state
      .getTasksByType("Design")
      .find((candidate) => task.dependencies.includes(candidate.id))
      ?.designOutput;
  }

  /**
   * Build a compact task context string (title + acceptance criteria) for prompt injection.
   *
   * @param task - The task to summarise.
   * @returns Newline-separated string of the task title followed by its acceptance criteria.
   */
  private getTaskContext(task: TaskState): string {
    return `${task.title}\n${task.acceptanceCriteria.join("\n")}`;
  }

  /**
   * RED phase: spawn `mlst-test-runner` to write failing tests for the task's acceptance criteria.
   *
   * Sets task status to `"testing"` before spawning. Returns the test-runner agent's output
   * (the written test code and confirmation they fail).
   *
   * @param task     - The task whose acceptance criteria drive the test cases.
   * @param spec     - Sprint specification for context.
   * @param enriched - Task context string (title + acceptance criteria, for the prompt).
   * @returns The test-runner agent's output (failing test code).
   */
  private async writeTaskTests(task: TaskState, spec: string, enriched: string): Promise<string> {
    this.d.notify(`${task.label}: RED — writing tests`, "info");
    this.updateTask(task.id, { status: "testing" });
    return this.spawn(
      "mlst-test-runner",
      this.d.context.buildTestFromCriteriaPrompt(task, spec, enriched),
      task,
    );
  }

  /**
   * GREEN phase: spawn `mlst-impl-engineer` to make the failing tests pass.
   *
   * Sets task status to `"in-progress"` before spawning. Returns the impl agent's output
   * (description of changes made).
   *
   * @param task         - The task being implemented.
   * @param spec         - Sprint specification for context.
   * @param testSpec     - RED-phase output (failing test code) for the agent to satisfy.
   * @param designOutput - Optional Group 1 design output to inject into the prompt.
   * @returns The impl-engineer agent's output.
   */
  private async implementTask(
    task: TaskState,
    spec: string,
    testSpec: string,
    designOutput: string | undefined,
  ): Promise<string> {
    this.d.notify(`${task.label}: GREEN — implementing`, "info");
    this.updateTask(task.id, { status: "in-progress" });
    return this.spawn("mlst-impl-engineer", this.d.context.buildImplFromTestsPrompt(task, spec, testSpec, designOutput), task);
  }

  /**
   * Mark task as `"reviewing"` and enter the review loop.
   *
   * Thin wrapper that sets the task status before delegating to {@link reviewLoop}.
   *
   * @param task          - The task being reviewed.
   * @param spec          - Sprint specification for reviewer context.
   * @param impl          - Current implementation summary.
   * @param deletionCheck - Optional deletion analysis to forward to the reviewer prompt.
   */
  private async reviewTask(task: TaskState, spec: string, impl: string, deletionCheck?: DeletionCheckResult): Promise<void> {
    this.updateTask(task.id, { status: "reviewing" });
    await this.reviewLoop(impl, spec, task.id, task, deletionCheck);
  }

  // ─── Review Loop (single implementation) ────────────────────────────────

  /**
   * Run the review loop for a single implementation.
   *
   * Iterates up to `maxReviewIterations`. On each iteration:
   * 1. `runReview` — spawns `mlst-code-reviewer`.
   * 2. `reviewApproved` — LLM verdict (or auto-approve if `enableReviewGate` is false).
   * 3. If approved: marks complete and returns.
   * 4. If max iterations reached: escalates and returns.
   * 5. Otherwise: `applyReviewFixes` — spawns impl-engineer + retests.
   *
   * @param implOutput    - Current implementation summary text.
   * @param contextOrSpec - Sprint spec (task-aware path) or user input (fast-path).
   * @param taskId        - Task UUID or descriptive string for non-task contexts.
   * @param task          - Optional task for status tracking and task-aware review prompt.
   * @param deletionCheck - Optional deletion check result to append as a reviewer warning.
   * @returns The final implementation string (may differ from input if fixes were applied).
   */
  private async reviewLoop(
    implOutput: string,
    contextOrSpec: string,
    taskId: string,
    task?: TaskState,
    deletionCheck?: DeletionCheckResult,
  ): Promise<string> {
    const displayId = task?.label ?? taskId;
    const max = this.d.state.getState().maxReviewIterations;
    let impl = implOutput;

    for (let i = 1; i <= max; i++) {
      if (task) this.updateTask(taskId, { iterationCount: i });

      const review = await this.runReview(impl, contextOrSpec, task, deletionCheck);
      const approved = await this.reviewApproved(review);
      const escalated = !approved && i >= max;
      const reason: ReviewReason = approved ? "approved" : escalated ? "max-iterations" : "needs-fixes";
      this.emitReviewResult(taskId, task, i, max, approved, escalated, reason);

      if (approved) {
        this.completeReview(taskId, displayId, task, review, i);
        return impl;
      }

      if (escalated) {
        this.escalateReview(taskId, displayId, task, review, max);
        return impl;
      }

      impl = await this.applyReviewFixes(taskId, displayId, task, review, impl, i, max);
    }

    return impl;
  }

  /**
   * Spawn `mlst-code-reviewer` for one review pass.
   *
   * When a `deletionCheck` with `tier === "large"` is provided, its warning is appended
   * to the reviewer's prompt so the reviewer explicitly validates the deletions.
   * Uses the task-aware prompt ({@link ContextAssembler.buildReviewPrompt}) when a task
   * is provided; falls back to the simple prompt for fast-path contexts.
   *
   * @param impl          - Implementation summary to review.
   * @param contextOrSpec - Sprint spec or user input for domain context.
   * @param task          - Optional task (enables task-aware prompt with files + criteria).
   * @param deletionCheck - Optional deletion analysis; appends warning when tier is `"large"`.
   * @returns The code-reviewer agent's output text.
   */
  private async runReview(impl: string, contextOrSpec: string, task?: TaskState, deletionCheck?: DeletionCheckResult): Promise<string> {
    const deletionWarning = deletionCheck?.warning
      ? `\n\n## ⚠️ Deletion Safety Flag\n${deletionCheck.warning}\nPlease verify these deletions are intentional and no functionality was lost.\n`
      : "";

    if (task) {
      return this.spawn("mlst-code-reviewer", this.d.context.buildReviewPrompt(impl, task, contextOrSpec) + deletionWarning, task);
    }

    return this.spawn("mlst-code-reviewer", this.d.context.buildReviewPromptSimple(impl, contextOrSpec) + deletionWarning);
  }

  /**
   * Determine whether a review pass approved the implementation.
   *
   * Short-circuits to `true` when `profile.enableReviewGate` is `false` (local profile
   * and config overrides), allowing the pipeline to proceed without an LLM verdict call.
   * Otherwise sends a simple APPROVED/NEEDS_FIXES prompt to the LLM.
   *
   * @param review - The code-reviewer agent's output text.
   * @returns `true` if approved (or gate is disabled), `false` if fixes are needed.
   */
  private async reviewApproved(review: string): Promise<boolean> {
    if (!this.d.profile.enableReviewGate) return true;

    const verdict = await this.llm(
      "Does this review approve the code? Respond APPROVED or NEEDS_FIXES.",
      review,
    );
    return /APPROVED/i.test(verdict);
  }

  /**
   * Emit a `review` dashboard event summarising the outcome of one review iteration.
   *
   * @param taskId    - Task UUID or descriptive string for non-task contexts.
   * @param task      - Optional task (used to extract `label` and `title` for the event).
   * @param iteration - Current review iteration number.
   * @param max       - Maximum iterations allowed.
   * @param approved  - Whether the review verdict was APPROVED.
   * @param escalated - Whether the task was escalated due to reaching `max` iterations.
   * @param reason    - Structured reason code for the review outcome.
   */
  private emitReviewResult(
    taskId: string,
    task: TaskState | undefined,
    iteration: number,
    max: number,
    approved: boolean,
    escalated: boolean,
    reason: ReviewReason,
  ): void {
    const label = task?.label ?? taskId;
    const title = task?.title ?? "";
    this.d.emit({ type: "review", taskId, label, title, iteration, max, approved, escalated, reason, timestamp: Date.now() });
  }

  /**
   * Finalise a successful review: notify the user, mark task `"complete"`, and
   * store the reviewer's output as `reviewOutput` in state + SQLite.
   *
   * @param taskId    - Task UUID for state sync.
   * @param displayId - Human-readable label shown in the notification.
   * @param task      - Optional task; if absent (fast-path), status sync is skipped.
   * @param review    - Reviewer agent output to persist as `reviewOutput`.
   * @param iteration - Iteration number at which approval was granted (for the notification).
   */
  private completeReview(
    taskId: string,
    displayId: string,
    task: TaskState | undefined,
    review: string,
    iteration: number,
  ): void {
    this.d.notify(`${displayId}: Approved (iteration ${iteration})`, "success");
    if (task) {
      this.updateTask(taskId, { status: "complete", reviewOutput: review });
    }
  }

  /**
   * Finalise an exhausted review loop: notify the user, mark task `"escalated"`, and
   * store the final reviewer output as `reviewOutput`.
   *
   * @param taskId    - Task UUID for state sync.
   * @param displayId - Human-readable label shown in the notification.
   * @param task      - Optional task; if absent (fast-path), status sync is skipped.
   * @param review    - Final reviewer agent output to persist as `reviewOutput`.
   * @param max       - Maximum iterations that were reached (shown in the notification).
   */
  private escalateReview(
    taskId: string,
    displayId: string,
    task: TaskState | undefined,
    review: string,
    max: number,
  ): void {
    this.d.notify(`${displayId}: Max iterations (${max}). Escalating.`, "error");
    if (task) {
      this.updateTask(taskId, { status: "escalated", reviewOutput: review });
    }
  }

  /**
   * Apply review-requested fixes, then immediately retest.
   *
   * Flow:
   * 1. Spawn `mlst-impl-engineer` with the review-fix prompt.
   * 2. Run tests. If they pass, return the new implementation.
   * 3. If tests still fail, spawn a second `mlst-impl-engineer` with the test-fix prompt
   *    before returning (one additional auto-fix attempt before handing back to the loop).
   *
   * @param taskId      - Task UUID (for status sync).
   * @param displayId   - Human-readable label for notifications.
   * @param task        - Optional task for status sync.
   * @param review      - Reviewer's feedback text.
   * @param impl        - Previous implementation summary.
   * @param iteration   - Current review iteration (shown in notification).
   * @param max         - Max iterations cap (shown in notification).
   * @returns The updated implementation summary after fixes.
   */
  private async applyReviewFixes(
    taskId: string,
    displayId: string,
    task: TaskState | undefined,
    review: string,
    impl: string,
    iteration: number,
    max: number,
  ): Promise<string> {
    this.d.notify(`${displayId}: Review iteration ${iteration}/${max}`, "info");

    let nextImpl = await this.spawn(
      "mlst-impl-engineer",
      this.d.context.buildReviewFixPrompt(review, impl, iteration, max),
    );
    this.syncTaskOutput(taskId, task, nextImpl);

    const retest = await this.runTests();
    if (retest.code === 0) {
      return nextImpl;
    }

    nextImpl = await this.spawn(
      "mlst-impl-engineer",
      this.d.context.buildTestFixPrompt(joinOutput(retest.stdout, retest.stderr), nextImpl),
    );
    this.syncTaskOutput(taskId, task, nextImpl);
    return nextImpl;
  }

  /**
   * Sync a task's output text to both in-memory state and SQLite.
   * No-op when `task` is undefined (non-task fast-path contexts).
   */
  private syncTaskOutput(taskId: string, task: TaskState | undefined, output: string): void {
    if (task) {
      this.updateTask(taskId, { output });
    }
  }

  // ─── Git Checkpoints & Deletion Safety ──────────────────────────────────

  /**
   * Create a lightweight git checkpoint before a task runs.
   *
   * Performs a `git stash push --include-untracked` followed immediately by
   * `git stash pop`. This leaves no persistent stash but creates a reflog entry
   * that can be used to recover the pre-task state if something goes wrong.
   * Skips silently if the working tree is clean. Emits a `checkpoint` event.
   *
   * @param taskId - Task UUID; used as part of the stash label and event payload.
   * @returns The stash label string, or `null` if the working tree was clean or stash failed.
   */
  private async createCheckpoint(taskId: string): Promise<string | null> {
    // Check if there are changes to checkpoint
    const status = await this.execQuiet("git", ["status", "--porcelain"]);
    if (!status.stdout.trim()) return null;

    const label = `mlst-checkpoint-${taskId}`;
    const result = await this.execQuiet("git", ["stash", "push", "-m", label, "--include-untracked"]);
    if (result.code !== 0) {
      this.d.notify(`Checkpoint failed: ${result.stderr}`, "warning");
      return null;
    }

    // Immediately pop — we just want the reflog entry as a recovery point
    await this.execQuiet("git", ["stash", "pop"]);

    this.d.emit({ type: "checkpoint", taskId, ref: label, timestamp: Date.now() });
    return label;
  }

  /**
   * Run `git diff --stat` and classify the scope of deletions since the last checkpoint.
   *
   * Delegates to `QualityGates.checkDeletions()` for tier classification. Emits a
   * `deletion_check` event regardless of tier. If tier is `"large"`, also sends a
   * user-visible warning notification. The returned result should be passed to
   * `reviewTask()` so the reviewer receives the warning in its prompt.
   *
   * @param taskId - Task UUID; included in the emitted event.
   * @returns The deletion check result with tier, file list, and line counts.
   */
  private async checkDeletions(taskId: string): Promise<DeletionCheckResult> {
    const diffStat = await this.execQuiet("git", ["diff", "--stat"]);
    const result = this.d.gates.checkDeletions(diffStat.stdout);

    this.d.emit({
      type: "deletion_check",
      taskId,
      tier: result.tier,
      filesDeleted: result.filesDeleted,
      linesRemoved: result.linesRemoved,
      linesAdded: result.linesAdded,
      warning: result.warning,
      timestamp: Date.now(),
    });

    if (result.warning) {
      this.d.notify(result.warning, "warning");
    }

    return result;
  }

  // ─── Test + Lint (deterministic) ────────────────────────────────────────

  /**
   * Ensure tests pass for non-task contexts (fast-path and impl-fast-path).
   *
   * Two automatic fix attempts before escalating to a full agent invocation:
   * 1. Run tests. If passing, return original impl.
   * 2. Spawn `mlst-impl-engineer` with test-fix prompt. Retest.
   * 3. If still failing, spawn `mlst-test-runner` as the final arbiter.
   * 4. Throw if the test-runner agent also reports failure.
   *
   * @param impl        - Current implementation summary.
   * @param description - User input description (for the simple test prompt).
   * @returns The implementation string (may be the fixed version from attempt 2).
   * @throws If tests are still failing after all attempts.
   */
  private async ensureTestsPass(impl: string, description: string): Promise<string> {
    const result = await this.runTests();
    if (result.code === 0) return impl;

    const fixed = await this.spawn(
      "mlst-impl-engineer",
      this.d.context.buildTestFixPrompt(result.stdout + result.stderr, impl),
    );

    const retest = await this.runTests();
    if (retest.code === 0) return fixed;

    const agentOutput = await this.spawn(
      "mlst-test-runner",
      this.d.context.buildTestPromptSimple(fixed, description),
    );
    if (!this.d.gates.testsPass(agentOutput)) {
      throw new Error("Tests still failing after retry");
    }
    return fixed;
  }

  /**
   * Ensure tests pass for a specific task, respecting `maxTestRetries`.
   *
   * Loops up to `maxTestRetries` times: run tests, on failure spawn `mlst-impl-engineer`
   * with the test-fix prompt and update the task output. After exhausting retries, makes
   * one final attempt via a full `mlst-test-runner` agent invocation. Escalates the task
   * and throws if that also fails.
   *
   * @param impl - Current implementation summary.
   * @param task - The task being tested (used for status updates and prompt building).
   * @returns The implementation string (may be a fixed version from a retry).
   * @throws If tests are still failing after `maxTestRetries` + 1 total attempts.
   */
  private async ensureTestsPassForTask(impl: string, task: TaskState): Promise<string> {
    const max = this.d.state.getState().maxTestRetries;

    for (let attempt = 1; attempt <= max; attempt++) {
      const result = await this.runTests();
      if (result.code === 0) return impl;

      this.d.notify(`${task.label}: Tests failed (${attempt}/${max})`, "warning");
      if (attempt < max) {
        impl = await this.spawn(
          "mlst-impl-engineer",
          this.d.context.buildTestFixPrompt(result.stdout + "\n" + result.stderr, impl),
        );
        this.updateTask(task.id, { output: impl });
      }
    }

    const agentOutput = await this.spawn("mlst-test-runner", this.d.context.buildTestPrompt(impl, task));
    if (!this.d.gates.testsPass(agentOutput)) {
      this.updateTask(task.id, { status: "escalated" });
      throw new Error(`${task.label}: Tests failing after ${max} attempts`);
    }
    return impl;
  }

  /** Auto-detect and run the project's test suite. Delegates to {@link runTests}. */
  private async runTests(): Promise<{ stdout: string; stderr: string; code: number }> {
    return runTests(this.d.cwd, this.exec.bind(this), this.d.notify);
  }

  /** Auto-detect and run the project's linter. Delegates to {@link runLint}. */
  private async runLint(): Promise<void> {
    return runLint(this.d.cwd, this.exec.bind(this), this.d.notify);
  }

  // ─── Context Pre-Hydration ──────────────────────────────────────────────

  /**
   * Return a listing of all source files in the project for agent orientation context.
   *
   * Cached after the first call (invalidated by {@link scaffold} when new files are created).
   * Runs `find` to collect source files, excluding build artifacts and vendor directories.
   * Returns an empty string for empty projects (no matching files), which signals
   * {@link scaffold} to run the scaffolding step.
   *
   * Returned format:
   * ```
   * ## Project Structure
   * ```
   * path/to/file.ts
   * ...
   * ```
   * ```
   *
   * @returns The formatted project structure string, or `""` if the project is empty.
   */
  private orientationCache: string | null = null;
  /**
   * Return a listing of all source files in the project for agent orientation context.
   *
   * Cached after the first call; invalidated by {@link scaffold} when new files are created.
   * Delegates the actual detection to {@link detectProjectOrientation}.
   */
  private async getProjectOrientation(): Promise<string> {
    if (this.orientationCache !== null) return this.orientationCache;
    this.orientationCache = await detectProjectOrientation(this.d.cwd, this.execQuiet.bind(this));
    return this.orientationCache;
  }

  // ─── Resume State Persistence ────────────────────────────────────────

  /**
   * Persist current gate annotations to SQLite for resume support.
   * Called after each gate completes so annotations survive process restarts.
   */
  private persistGateAnnotations(): void {
    const annotations: Record<string, string> = {};
    for (const [key, value] of this.gateAnnotations) {
      annotations[key] = value;
    }
    this.d.db.updateSprint(this.sprintId, {
      gate_annotations: JSON.stringify(annotations),
    } as any);
  }

  /**
   * Persist full resume state to SQLite so the sprint can be resumed later.
   * Called in review-only mode and at key checkpoints.
   */
  private persistResumeState(spec: string, tasks: TaskState[]): void {
    this.persistGateAnnotations();
    this.d.db.updateSprint(this.sprintId, {
      execution_profile: JSON.stringify(this.d.profile),
      sprint_context: this.sprintContext,
      model: this.d.model ?? null,
    } as any);
  }

  /**
   * Restore gate annotations from a JSON string (loaded from SQLite on resume).
   */
  restoreGateAnnotations(json: string): void {
    try {
      const parsed = JSON.parse(json);
      if (parsed && typeof parsed === "object") {
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof value === "string") {
            this.gateAnnotations.set(key, value);
          }
        }
      }
    } catch {
      // Ignore malformed JSON
    }
  }

  /**
   * Resume a sprint from Phase 3 with pre-loaded state.
   * Called by the --resume handler after restoring sprint data from SQLite.
   */
  async resumeFromPhase3(
    spec: string,
    tasks: TaskState[],
    sprintId: number,
    projectId: number,
  ): Promise<string> {
    this.sprintId = sprintId;
    this.projectId = projectId;
    this.d.state.setSpecification(spec);
    this.d.state.setTasks(tasks);

    // Rebuild issue ID map
    for (const task of tasks) {
      // Tasks from resume don't have DB issue IDs mapped; create fresh entries
      const issue = this.d.db.createIssue({
        project_id: this.projectId,
        sprint_id: this.sprintId,
        title: task.title,
        body: task.acceptanceCriteria.join("\n"),
        type: task.type,
        assigned_agent: task.assignedAgent,
        dependencies: task.dependencies,
        acceptance_criteria: task.acceptanceCriteria,
        files_affected: task.filesAffected,
      });
      this.issueIds.set(task.id, issue.id);
    }

    this.sprintContext = await this.buildSprintContext(spec, tasks);
    await this.phase3(tasks, spec);
    return this.phase4(tasks);
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

interface IssueUpdatePayload {
  status?: Issue["status"];
  closed_at?: string;
  output?: string;
  review_output?: string;
  design_output?: string;
  iteration_count?: number;
}
