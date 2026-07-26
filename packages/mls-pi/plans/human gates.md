# MLS Pi Extension — Data/Process Flow Map & Human Quality Gate Plan

Current Architecture Summary

Data Flow

Input → /build <text> or /prd <idea> command

Input Resolution (index.ts): Expand @file refs, GitHub #N issue refs, detect PRD paths

Execution Profile (execution-profiles.ts): Cloud vs Local vs custom .mls/config.json

Dashboard (dashboard.ts): SSE server on :4242, JSONL run logs in .mls/runs/

Classification (orchestrator LLM call): bug | feature | epic | plan | implementation-spec | requirements

Routing: Classification → fast-path OR impl-fast-path OR full 5-phase pipeline

Persistence: SQLite (projects, sprints, issues/tasks, labels), in-memory StateManager (UI), SSE events

Process Flow — Full Pipeline

Plain Text Copy

Phase 0 (optional): Idea Refinement — LLM evaluates clarity

Phase 1: Specification — mls-spec-writer agent

  └─ Spec-completeness LLM gate (optional, cloud profile)

Phase 2: Task Breakdown — mls-scrum-master agent → parse tasks → persist to SQLite

  └─ Task-breakdown deterministic gate

Phase 3: Execution

  ├─ Scaffold (if empty repo)

  ├─ Group 1 (parallel): Design + Infra + Docs agents

  └─ Group 2 (topological batches): For each impl task:

       Checkpoint → RED (test-runner) → GREEN (impl-engineer) → Deletion check → Ensure tests pass → Lint → Review loop

Phase 4: Sprint summary → mark complete

Process Flow — Fast Paths

Plain Text Copy

Bug fast-path:      impl-engineer (bug fix) → ensureTestsPass → lint → review loop

Impl-spec fast-path: impl-engineer (spec) → ensureTestsPass → lint → review loop

Current Quality Gates

Spec-completeness (LLM, optional via profile): PASS/FAIL after Phase 1

Task-breakdown (deterministic): Validates task structure after Phase 2

Deletion check (deterministic): Classifies git diff as normal/large after each impl task

testsPass (deterministic heuristic): Regex pattern matching on agent output

Review loop (LLM verdict): APPROVED/NEEDS_FIXES up to maxReviewIterations, then escalate

Clarification protocol (agent-initiated): CLARIFICATION_NEEDED: marker → prompt user → re-invoke

Current Human Touchpoints

Phase 0: Non-blocking — sends refinement message but doesn't halt

Clarification: Agent output contains CLARIFICATION_NEEDED: → TUI input dialog (60s timeout) → autonomous fallback

PRD session: Interactive 8-question walkthrough (fully human-driven)

Escalation: Task marked escalated after max iterations — visible in dashboard but no pause

Gaps for Human Quality Gates

No human approval gate between Phase 1 (spec) and Phase 2 (task breakdown)

No human approval gate between Phase 2 (tasks) and Phase 3 (execution)

No human approval gate for Group 1 design output before Group 2 impl begins

Phase 0 refinement questions are non-blocking — pipeline continues regardless

Escalated tasks don't pause the pipeline or ask for human intervention

No ability to approve/reject/modify individual task plans before execution

No checkpoint-based rollback prompt when deletion tier is "large"

Plan: Human Quality Gates & Pipeline Path Changes

TL;DR

Add configurable human approval checkpoints at key pipeline boundaries (post-spec, post-task-breakdown, post-design) so the pipeline can pause for review before committing to expensive execution phases. Also restructure the pipeline to support checkpoint-gated mode vs fully-autonomous mode via the ExecutionProfile.

Steps

Phase A: Type & Profile Foundation

Add new types to types.ts:

HumanGateResult type: { approved: boolean; revisedArtifact?: string; gateAnnotation?: string; feedbackRounds: number; autonomous: boolean }

GatePoint enum: "post-spec" | "post-tasks" | "post-design" | "pre-execution" | "on-escalation" | "post-review"

New MlsEvent variant: { type: "human_gate"; gate: GatePoint; status: "waiting" | "analyzing" | "reviewing" | "approved" | "rejected" | "timeout"; feedbackRounds: number; autonomous: boolean; conversationSummary?: string }

Add to ExecutionProfile: humanGates: GatePoint[] — list of enabled human gates (empty = fully autonomous)

Update execution-profiles.ts:

CLOUD_PROFILE: humanGates: ["post-spec", "post-tasks"] (default gates for cloud)

LOCAL_PROFILE: humanGates: [] (fully autonomous for local)

Allow .mls/config.json "humanGates" array override

Phase B: Gate Infrastructure (Orchestrator-Mediated Review)

The gate is NOT a passthrough — the orchestrator actively analyzes the artifact, adds context, and conducts a multi-turn conversation with the human until explicit approval.

Add humanGate() method to Orchestrator:

Accept gate: GatePoint, artifact: string, context?: string

Step 1 — LLM Analysis Pass: Before presenting to the human, run an LLM call that:

Summarizes the artifact (spec outline / task dependency graph / design highlights)

Flags risks, ambiguities, or gaps it detects

Suggests 2-3 specific questions the human should consider

Produces a structured "Gate Review Brief" combining the summary + flags + questions

Step 2 — Present via sendMessage: Show the Gate Review Brief to the human in chat history (full artifact is available; brief is the orchestrator's analysis on top of it)

Step 3 — Multi-turn promptUser loop:

Call promptUser() with: "Review the [spec/tasks/design] above. Reply 'approve' to proceed, or provide feedback."

Parse response:

"approve" / "yes" / "done" / "lgtm" → exit loop, approved

null (timeout/CI) → auto-approve, emit autonomous: true

Anything else → treat as feedback, enter reconciliation cycle: a. Run LLM reconciliation: "The user said: <feedback>. Here is the current artifact: <artifact>. Produce a revised version that addresses the feedback, and summarize what changed." b. Update artifact with LLM-revised version c. sendMessage the delta summary ("Here's what changed based on your feedback: ...") d. Re-prompt: "Updated. Reply 'approve' to proceed, or provide more feedback." e. Max 3 feedback rounds before forcing: "Proceeding with current version after 3 rounds of feedback."

Step 4 — Context shaping: Produce a gateAnnotation string that captures:

What the human approved (or which round they approved at)

Any explicit constraints/preferences from the conversation

This annotation is injected into the next phase's prompt as ## Human Review Notes

Emit human_gate event with final status + conversation summary

Return HumanGateResult (now includes revisedArtifact and gateAnnotation)

Skip entirely (auto-approve, no LLM analysis) if gate not in profile.humanGates

Add LLM analysis prompt templates for each gate point:

Post-spec analysis: "Review this specification for completeness. Summarize the key decisions, flag any missing sections (requirements, acceptance criteria, edge cases, testing strategy), and list 2-3 questions the reviewer should consider."

Post-tasks analysis: "Review this task breakdown. Check: are tasks atomic? Are dependencies correct? Is the critical path reasonable? Are acceptance criteria testable? Flag issues and suggest questions."

Post-design analysis: "Review these design outputs. Check: do they align with the spec? Are accessibility requirements covered? Are responsive breakpoints specified? Flag gaps."

On-escalation analysis: "This task was escalated after N iterations. Here's the review history: <reviews>. Summarize what went wrong, what was tried, and recommend: retry with different approach / skip / abort sprint."

Phase C: Pipeline Integration

Wire post-spec gate into phase1(): depends on 3

After spec is produced and spec-completeness LLM gate passes

Orchestrator analysis highlights: missing sections, ambiguous requirements, untestable criteria

If human provides feedback: LLM reconciliation revises the spec, human re-reviews

Revised spec (if any) replaces the original in state + SQLite before Phase 2 begins

gateAnnotation (human's constraints/preferences) injected into Phase 2 scrum-master prompt as ## Human Review Notes

Wire post-tasks gate into phase2(): depends on 3

After tasks are parsed and persisted

Orchestrator analysis highlights: dependency issues, missing task types, questionable complexity estimates, critical path concerns

Present: task summary table + critical path + parallel groups + orchestrator's risk flags

If human provides feedback: LLM reconciliation can add/remove/reorder tasks, update dependencies

Revised task list replaces the original in state + SQLite; gateAnnotation injected into Phase 3 agent prompts

If rejected: re-invoke scrum-master with feedback, re-parse, re-gate

Wire post-design gate between Group 1 and Group 2 in phase3(): depends on 3

After Group 1 completes, before Group 2 starts

Orchestrator analysis highlights: spec alignment, accessibility gaps, missing responsive specs

If human provides feedback: LLM reconciliation revises design output

Approved (possibly revised) design output is then fed to impl tasks as designOutput

Wire on-escalation gate into executeImplTask() catch block: depends on 3

Orchestrator analysis summarizes: what failed, what was tried across iterations, review history

Human chooses: "retry" (reset iteration count, re-run with different approach hint), "skip" (mark complete without approval), "escalate" (mark escalated, continue sprint), "abort" (stop entire sprint)

For "retry": orchestrator produces a ## Retry Guidance section from the human's feedback + its own analysis of what went wrong, injected into the re-invoked agent's prompt

For "abort": triggers AbortController.abort() to cancel all in-flight agents (see step 8a)

8a. Add AbortController ownership to Orchestrator: depends on 8

Orchestrator creates its own AbortController at construction; passes controller.signal to all spawnAgent / llm calls

If deps.signal is provided (external abort), chain it: external abort → controller abort

on-escalation "abort" response calls controller.abort()

All in-flight spawnAgent calls detect the signal and terminate their pi subprocesses

mapConcurrent checks the signal before starting each new task in the pool

After abort: skip remaining batches, proceed directly to Phase 4 with abort status

8b. Wire post-review gate into fast paths (fastPath / implFastPath): depends on 3

After the review loop completes (before marking sprint complete)

Lightweight gate: orchestrator summarizes what was changed + review outcome

Human approves final result or requests one more pass

Small change: insert humanGate("post-review", impl, "fast-path review") before state.complete()

Phase D: Pipeline Path Restructuring

Add pipeline-mode to ExecutionProfile: "full" | "gated" | "review-only"

full: Current behavior (phases 0-4)

gated: Full pipeline but pauses at every enabled human gate

review-only: Skip execution (phases 0-2 only) — produce spec + tasks for human review without running any agents in Phase 3. Useful for planning.

Add /build --plan flag support in index.ts: depends on 9

Sets pipeline-mode to review-only

Runs through Phase 0-2, presents spec + tasks, then stops

User can later run /build --resume <sprint-id> to continue from Phase 3

Add /build --resume <sprint-id> support: depends on 10

Load sprint from SQLite (spec, tasks, classification, execution_profile, gate_annotations, sprint_context, model)

Restore StateManager from DB state

Restore gate annotations so ## Human Review Notes from prior gates are available for Phase 3 agent prompts

Skip to Phase 3 execution with existing tasks

11a. Add resume-state columns to sprints table in db.ts: depends on 11

execution_profile TEXT — JSON-serialized ExecutionProfile

gate_annotations TEXT — JSON object { "post-spec": "...", "post-tasks": "..." }

sprint_context TEXT — tech stack + conventions string

model TEXT — model override string

abort_reason TEXT — human-provided reason when sprint is aborted (nullable)

Persisted at each gate point (gate_annotations incrementally updated) and at sprint start (profile, context, model)

Migration: new columns are nullable, so existing sprints are unaffected

Phase E: Dashboard Integration

Update dashboard SSE events and dashboard-ui/ to show human gate status: parallel with C

New event card type for human_gate events

Visual indicator: gate waiting (amber), approved (green), rejected (red)

Gate summary in sprint timeline view

Cumulative gate cost: track LLM calls + tokens spent on gate analysis and reconciliation; display in dashboard alongside existing formatUsage totals

12a. Add abort handling to Phase 4 and sprint summary: depends on 8a

If sprint was aborted: Phase 4 generates partial completion report

Report includes: abort reason (from human), task status breakdown (complete/in-progress/pending/escalated), what was accomplished

SQLite sprint record updated with status: "aborted", abort_reason, completed_at

Dashboard sprint_end event includes aborted: true flag + abort reason

Relevant Files

types.ts — Add HumanGateResult, GatePoint (incl. post-review), new MlsEvent variant, extend ExecutionProfile

execution-profiles.ts — Add humanGates to profiles, config parsing

orchestrator.ts — Add humanGate(), AbortController ownership, wire into phase1/2/3, escalation, fast-path post-review, abort flow to Phase 4

index.ts — Add --plan and --resume flag handling

state.ts — Add restore() support for sprint resume

db.ts — Add resume-state columns (execution_profile, gate_annotations, sprint_context, model, abort_reason); query helpers for sprint resume

dashboard.ts — Emit and render human_gate events, cumulative gate cost tracking

dashboard-ui/ — UI for gate status display + gate cost display

Verification

Unit tests: humanGate() returns auto-approve when gate not in profile; emits no LLM analysis call

Unit tests: humanGate() runs LLM analysis pass before first promptUser call; analysis output included in sendMessage

Unit tests: Multi-turn loop — mock promptUser to return feedback then "approve"; verify LLM reconciliation called, artifact revised, feedbackRounds tracked correctly

Unit tests: Max 3 feedback rounds — after 3 non-approve inputs, gate force-proceeds with current artifact

Unit tests: gateAnnotation captures human constraints from conversation and is included in HumanGateResult

Unit tests: phase1() with post-spec gate — revised spec replaces original in state + SQLite; gateAnnotation injected into Phase 2 prompt

Unit tests: phase2() with post-tasks gate — task list revision persisted; annotation injected into Phase 3 agent prompts

Unit tests: executeImplTask() on-escalation gate — retry produces ## Retry Guidance in re-invoked prompt; skip/escalate/abort paths correct

Unit tests: Abort propagation — controller.abort() cancels in-flight agents; mapConcurrent skips remaining tasks; Phase 4 generates abort report with reason

Unit tests: Fast-path post-review gate — fires after review loop, before state.complete()

Unit tests: Resume loads gate_annotations, execution_profile, sprint_context, model from SQLite; restored annotations appear in Phase 3 prompts

Integration test: Full pipeline with humanGates: ["post-spec", "post-tasks"] — mock promptUser to approve on first prompt, verify pipeline completes end-to-end

Integration test: --plan mode stops after Phase 2, --resume continues from Phase 3 with restored gate annotations

Integration test: Abort mid-sprint — verify partial completion report includes abort reason and correct task status counts

vitest run — all existing tests still pass (no regressions)

Decisions

Human gates are opt-in via ExecutionProfile — autonomous by default, no separate code path

Gate model is orchestrator-mediated: orchestrator runs LLM analysis, conducts multi-turn promptUser loop, shapes context for next phase

Reuses promptUser in a loop (same TUI input() primitive) — no new UI primitives required (Tier 1); investigate multiline option during implementation (Tier 1.5)

Multi-turn loop caps at 3 feedback rounds before force-proceeding — prevents infinite loops

gateAnnotation (structured summary of human decisions/constraints) injected as ## Human Review Notes into next-phase prompts — human intent propagates downstream

LLM reconciliation revises artifact in-place; revised version replaces original in state + SQLite

Post-design gate revision: accept risk of git conflicts (Option C) — checkpoint-based recovery + deletion check catches damage; upgrade to file-ownership tracking if needed

Orchestrator owns an AbortController — "abort" from on-escalation gate cancels in-flight agents and terminates subprocesses

Abort produces a partial completion report with human-provided abort reason; sprint record updated with status: "aborted"

Fast-path post-review gate is a lightweight addition — same humanGate() method, minimal wiring

Resume state persisted as explicit columns on sprints table (execution_profile, gate_annotations, sprint_context, model, abort_reason) — nullable columns, backward-compatible

Cumulative gate cost (LLM calls + tokens for analysis/reconciliation) tracked and displayed in dashboard

review-only mode (--plan) is a pipeline truncation, not a new pipeline — reuses existing Phase 0-2 code

--resume loads from SQLite — survives process restarts

Tier 2 (dashboard-based rich review UI with comment threads) is a future enhancement — tracked but not in scope

Excluded: webhook/API-based gates (future CI consideration), per-task approval gates (too noisy)

Further Considerations

Gate timeout policy: Should gates have a configurable timeout (like clarification's 60s), or block indefinitely? Recommendation: configurable in ExecutionProfile with a sensible default (5 minutes for interactive, no timeout for --plan mode).

Notification channel: For long-running builds, should the gate emit a system notification (macOS notification center) in addition to the TUI prompt? Recommendation: Yes, add optional deps.systemNotify() callback.

Sprint resume granularity: Should --resume support resuming from a specific phase (e.g., re-run only Phase 3 Group 2), or always restart from Phase 3? Recommendation: Start with Phase 3 restart; add per-phase resume later if needed.

Tier 2 dashboard gates: The SSE dashboard on :4242 could host a richer review UI (full artifact viewer, inline comments, approve/reject buttons). This would replace the promptUser loop for users who prefer browser-based review. Worth scoping as a follow-on.

Follow-up Tickets (out of scope for this plan)

TICKET: Tier 1.5 — Multiline gate input: Investigate whether pi's input() supports a multiline: true option or text-editor mode. If available, use it for gate prompts to allow richer feedback without a new UI primitive.

TICKET: Tier 2 — Dashboard review UI: Build a browser-based review surface in the SSE dashboard (:4242) with full artifact viewer, inline comment threads, and approve/reject buttons. Replace the promptUser loop for users who prefer async browser-based review.