/**
 * MLST Pi Extension — Context Assembly
 *
 * Builds complete prompts for each agent handoff, following the
 * delegation prompt templates from build.md.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { TaskState } from "./types.js";

/**
 * Assembles complete prompts for each agent handoff and LLM call in the pipeline.
 *
 * Loads four Markdown templates at construction time:
 * - `specification.md`   — Output template for the spec-writer agent.
 * - `task-breakdown.md`  — Output template for the scrum-master agent.
 * - `decision-record.md` — Template for injecting ADR context (loaded but currently unused directly).
 * - `scaffold.md`        — Instructions for the scaffold phase.
 *
 * All `build*Prompt` methods return a complete prompt string ready to pass to an agent
 * via {@link spawnAgent} or to an LLM via {@link LlmClient.call}.
 */
export class ContextAssembler {
  private templates: {
    specification: string;
    taskBreakdown: string;
    decisionRecord: string;
    scaffold: string;
  };

  /**
   * @param templatesDir - Absolute path to the `templates/` directory.
   *   Template files are loaded eagerly at construction time. If a file is missing,
   *   that template's content is replaced with a `"(Template <name> not found)"` placeholder;
   *   no error is thrown so the extension degrades gracefully.
   */
  constructor(templatesDir: string) {
    this.templates = {
      specification: this.loadTemplate(templatesDir, "specification.md"),
      taskBreakdown: this.loadTemplate(templatesDir, "task-breakdown.md"),
      decisionRecord: this.loadTemplate(templatesDir, "decision-record.md"),
      scaffold: this.loadTemplate(templatesDir, "scaffold.md"),
    };
  }

  private loadTemplate(dir: string, filename: string): string {
    const filepath = path.join(dir, filename);
    try {
      return fs.readFileSync(filepath, "utf-8");
    } catch {
      return `(Template ${filename} not found)`;
    }
  }

  // ─── Specification Writer ───────────────────────────────────────────────

  /**
   * Build the Phase 1 prompt for the `mlst-spec-writer` agent.
   *
   * Assembles up to four sections in order:
   * 1. `## Idea` — the raw user input.
   * 2. `## Project Structure` — the file listing from `getProjectOrientation()` (if provided).
   * 3. `## Decision Record` — prior ADR text (if provided).
   * 4. `## Known Constraints` — constraint notes (if provided).
   * 5. `## Output Template` — the `specification.md` template, always appended.
   *
   * @param input         - Raw user input (idea, feature description, or requirements doc).
   * @param decisionRecord - Optional ADR text from a prior architectural decision.
   * @param constraints    - Optional constraint notes to inject.
   * @param orientation    - Optional project file listing from `Orchestrator.getProjectOrientation()`.
   * @returns Complete prompt string for the spec-writer agent.
   */
  buildSpecPrompt(
    input: string,
    decisionRecord?: string,
    constraints?: string,
    orientation?: string,
  ): string {
    let prompt = `## Idea\n${input}\n`;

    if (orientation) {
      prompt += `\n${orientation}\n`;
    }

    if (decisionRecord) {
      prompt += `\n## Decision Record\n${decisionRecord}\n`;
    }

    if (constraints) {
      prompt += `\n## Known Constraints\n${constraints}\n`;
    }

    prompt += `\n## Output Template\nUse this structure for your specification:\n\n${this.templates.specification}\n`;

    return prompt;
  }

  // ─── Scrum Master ─────────────────────────────────────────────────────

  /**
   * Build the Phase 2 prompt for the `mlst-scrum-master` agent.
   *
   * Combines the specification with the `task-breakdown.md` output template so the agent
   * knows exactly the JSON-line format expected by `Orchestrator.parseTasks()`.
   *
   * @param specification - Full spec text from Phase 1.
   * @param notes         - Optional additional guidance to inject before the template.
   * @returns Complete prompt string for the scrum-master agent.
   */
  buildTaskBreakdownPrompt(specification: string, notes?: string): string {
    let prompt = `## Specification\n${specification}\n`;

    if (notes) {
      prompt += `\n## Notes\n${notes}\n`;
    }

    prompt += `\n## Output Template\nUse this structure for your task breakdown:\n\n${this.templates.taskBreakdown}\n`;

    return prompt;
  }

  // ─── Implementation Engineer ──────────────────────────────────────────

  /**
   * Build the legacy (non-TDD) implementation prompt for the `mlst-impl-engineer` agent.
   *
   * Wraps all task fields (title, files, acceptance criteria, spec, optional design output)
   * into a single prompt. **This is NOT the TDD path** — for TDD use
   * {@link buildImplFromTestsPrompt} instead. Not currently called by the pipeline;
   * retained as a non-TDD fallback for future use.
   *
   * @param task          - The task to implement.
   * @param specification - Full sprint specification for context.
   * @param designOutput  - Optional design agent output to include as `## Design Specifications`.
   * @returns Complete prompt string for the impl-engineer agent.
   */
  buildImplPrompt(
    task: TaskState,
    specification: string,
    designOutput?: string,
  ): string {
    let prompt = `## Task\n${task.title}\n`;

    if (task.filesAffected.length > 0) {
      prompt += `\n## Files\n${task.filesAffected.map((f) => `- ${f}`).join("\n")}\n`;
    }

    prompt += `\n## Acceptance Criteria\n${task.acceptanceCriteria.map((c) => `- [ ] ${c}`).join("\n")}\n`;

    prompt += `\n## Context\n### Specification\n${specification}\n`;

    if (designOutput) {
      prompt += `\n### Design Specifications\n${designOutput}\n`;
    }

    return prompt;
  }

  /**
   * Build the fast-path bug-fix prompt for the `mlst-impl-engineer` agent.
   *
   * Instructs the agent to: (1) write a failing test that reproduces the bug (RED),
   * (2) fix the bug (GREEN), (3) verify the test passes, and (4) list changed files
   * without committing. Optional project orientation is appended if provided.
   *
   * @param input       - Bug description from the user.
   * @param orientation - Optional project file listing from `Orchestrator.getProjectOrientation()`.
   * @returns Complete prompt string for the impl-engineer agent.
   */
  buildBugFixPrompt(input: string, orientation?: string): string {
    let prompt = `## Bug Fix\n${input}\n\nWrite a failing test that reproduces the bug. Fix the bug. Verify the test passes. Do NOT commit — list files changed.`;
    if (orientation) prompt += `\n\n${orientation}`;
    return prompt;
  }

  /**
   * Build the impl-fast-path prompt for `implementation-spec` inputs.
   *
   * Instructs the agent to follow strict RED→GREEN TDD: write failing tests from the
   * acceptance criteria first, then implement the minimum code to make them pass.
   * The agent must not commit. Optional project orientation is appended if provided.
   *
   * @param input       - Exact implementation spec from the user.
   * @param orientation - Optional project file listing from `Orchestrator.getProjectOrientation()`.
   * @returns Complete prompt string for the impl-engineer agent.
   */
  buildImplFromSpecPrompt(input: string, orientation?: string): string {
    let prompt = `## Implementation Specification\n${input}\n\nWrite failing tests from the acceptance criteria first (RED). Then implement the minimum code to make them pass (GREEN). Do NOT commit — list files changed.`;
    if (orientation) prompt += `\n\n${orientation}`;
    return prompt;
  }

  // ─── Scaffolding ──────────────────────────────────────────────────────

  /**
   * Build the scaffold phase prompt for the `mlst-impl-engineer` agent.
   *
   * Uses the `scaffold.md` template for structural instructions. The specification is
   * included for tech-stack reference only — the agent should wire the project skeleton,
   * not implement any features. Only called when `getProjectOrientation()` returns an
   * empty string (project has no source files yet).
   *
   * @param spec        - Full sprint specification (tech-stack reference only).
   * @param orientation - Optional project file listing (will be empty for new projects).
   * @returns Complete prompt string for the impl-engineer agent.
   */
  buildScaffoldPrompt(spec: string, orientation?: string): string {
    let prompt = `${this.templates.scaffold}\n\n## Specification (for tech stack reference only)\n${spec}`;
    if (orientation) prompt += `\n\n${orientation}`;
    return prompt;
  }

  // ─── TDD: RED Phase (test-runner writes tests first) ──────────────────

  /**
   * Build the RED-phase TDD prompt for the `mlst-test-runner` agent.
   *
   * **Phase: RED.** The agent must write exactly one test per acceptance criterion,
   * must not invent scenarios beyond what the criteria specify, and must run the tests
   * to confirm they FAIL before returning. Tests for README files, config files, or
   * HTML structure are explicitly excluded.
   *
   * @param task          - The task whose acceptance criteria drive the test cases.
   * @param specification - Full sprint specification for domain context.
   * @param codeContext   - Summary of existing code relevant to the task (from `getTaskContext()`).
   * @returns Complete prompt string for the test-runner agent.
   */
  buildTestFromCriteriaPrompt(
    task: TaskState,
    specification: string,
    codeContext: string,
  ): string {
    return `## Write Failing Tests (RED Phase)

## Task
${task.title}

## Acceptance Criteria
${task.acceptanceCriteria.map((c) => `- ${c}`).join("\n")}

## Specification Context
${specification}

## Existing Code
${codeContext}

Write ONE test per acceptance criterion. Do not invent scenarios beyond what the criteria specify. Do not test READMEs, config files, or HTML structure. Run tests to confirm they FAIL (RED).`;
  }

  // ─── TDD: GREEN Phase (impl-engineer makes tests pass) ────────────────

  /**
   * Build the GREEN-phase TDD prompt for the `mlst-impl-engineer` agent.
   *
   * **Phase: GREEN.** The agent receives the failing test output and must write the
   * minimum code required to make all failing tests pass. It must not add behavior
   * that no test verifies. Optional design output and files list are injected when available.
   *
   * @param task          - The task being implemented.
   * @param specification - Full sprint specification for context.
   * @param testOutput    - Output from the RED-phase test-runner agent (failing test details).
   * @param designOutput  - Optional design agent output to include as `## Design Specifications`.
   * @returns Complete prompt string for the impl-engineer agent.
   */
  buildImplFromTestsPrompt(
    task: TaskState,
    specification: string,
    testOutput: string,
    designOutput?: string,
  ): string {
    let prompt = `## Make Tests Pass (GREEN Phase)

## Failing Tests
${testOutput}

## Task
${task.title}

## Acceptance Criteria
${task.acceptanceCriteria.map((c) => `- [ ] ${c}`).join("\n")}

Write the minimum code to make all failing tests pass. Do not add behavior that no test verifies.`;

    if (task.filesAffected.length > 0) {
      prompt += `\n\n## Files\n${task.filesAffected.map((f) => `- ${f}`).join("\n")}`;
    }

    if (designOutput) {
      prompt += `\n\n## Design Specifications\n${designOutput}`;
    }

    prompt += `\n\n## Specification Context\n${specification}`;
    return prompt;
  }

  // ─── Implementation Engineer — Review Feedback Fix ────────────────────

  /**
   * Build the review-fix prompt for the `mlst-impl-engineer` agent.
   *
   * **Phase: review iteration.** Presents the reviewer's feedback alongside the
   * previous implementation. The agent must: fix Must-Fix and Should-Fix items,
   * push back on invalid feedback with clear explanation, and skip Out-of-Scope items.
   * The iteration counter (`iteration/maxIterations`) is shown so the agent knows
   * how many passes remain.
   *
   * @param reviewOutput    - Full output from the code-reviewer agent.
   * @param previousImpl    - Summary of the implementation being fixed.
   * @param iteration       - Current iteration number (1-based).
   * @param maxIterations   - Cap from the execution profile (shown to the agent).
   * @returns Complete prompt string for the impl-engineer agent.
   */
  buildReviewFixPrompt(
    reviewOutput: string,
    previousImpl: string,
    iteration: number,
    maxIterations: number,
  ): string {
    return `## Address Review Feedback (Iteration ${iteration}/${maxIterations})

## Review Feedback
${reviewOutput}

## Previous Implementation Summary
${previousImpl}

Fix Must-Fix and Should-Fix issues. Push back on invalid feedback with clear explanation. Do not implement Out-of-Scope items.`;
  }

  /**
   * Build the test-failure-fix prompt for the `mlst-impl-engineer` agent.
   *
   * Used in two contexts: `ensureTestsPass()` (non-task fast-path) and
   * `applyReviewFixes()` (after review-driven changes broke tests).
   * The agent must fix the failing tests without breaking passing ones.
   *
   * @param testOutput    - Combined stdout+stderr from the test run.
   * @param previousImpl  - Summary of the implementation to fix.
   * @returns Complete prompt string for the impl-engineer agent.
   */
  buildTestFixPrompt(testOutput: string, previousImpl: string): string {
    return `## Fix Test Failures

## Test Output
${testOutput}

## Previous Implementation Summary
${previousImpl}

Fix the failing tests. Do not break passing tests.`;
  }

  // ─── Test Runner ──────────────────────────────────────────────────────

  /**
   * Build the test-verification prompt for the `mlst-test-runner` agent (task-aware variant).
   *
   * **Fallback path:** used only after `ensureTestsPassForTask()` exhausts all auto-fix
   * attempts and escalates to a full agent invocation. The agent re-verifies the
   * implementation against the task's acceptance criteria.
   *
   * @param implOutput - Summary of the implementation to verify.
   * @param task       - The task whose acceptance criteria and files define scope.
   * @returns Complete prompt string for the test-runner agent.
   */
  buildTestPrompt(implOutput: string, task: TaskState): string {
    let prompt = `## What Changed\n${implOutput}\n`;

    if (task.filesAffected.length > 0) {
      prompt += `\n## Files Modified\n${task.filesAffected.map((f) => `- ${f}`).join("\n")}\n`;
    }

    prompt += `\n## Acceptance Criteria\n${task.acceptanceCriteria.map((c) => `- [ ] ${c}`).join("\n")}\n`;

    return prompt;
  }

  /**
   * Build the test-verification prompt for the `mlst-test-runner` agent (simple variant).
   *
   * Used in the fast-path and impl-fast-path where no task object is available.
   * The agent writes and runs tests to validate the changes against the plain description.
   *
   * @param implOutput  - Summary of the implementation to verify.
   * @param description - Plain-text description of what was changed (from user input).
   * @returns Complete prompt string for the test-runner agent.
   */
  buildTestPromptSimple(implOutput: string, description: string): string {
    return `## What Changed\n${implOutput}\n\n## Context\n${description}\n\nWrite and run tests to validate the changes.`;
  }

  // ─── Code Reviewer ────────────────────────────────────────────────────

  /**
   * Build the full code-review prompt for the `mlst-code-reviewer` agent (task-aware variant).
   *
   * **Phase: review.** Includes what changed, the full list of files to inspect,
   * the task title and acceptance criteria, and the complete specification for
   * domain context. Used in Group 2 task execution.
   *
   * @param implOutput    - Summary of what the implementation agent did.
   * @param task          - The task being reviewed (provides files and acceptance criteria).
   * @param specification - Full sprint specification for domain context.
   * @returns Complete prompt string for the code-reviewer agent.
   */
  buildReviewPrompt(
    implOutput: string,
    task: TaskState,
    specification: string,
  ): string {
    return `## What Changed\n${implOutput}\n\n## Files to Review\n${task.filesAffected.map((f) => `- ${f}`).join("\n")}\n\n## Context\n${task.title}\n\n## Specification\n${specification}`;
  }

  /**
   * Build the code-review prompt for the `mlst-code-reviewer` agent (simple variant).
   *
   * Used in fast-path and impl-fast-path where no task object is available.
   * The reviewer evaluates the changes against the plain description only.
   *
   * @param implOutput  - Summary of what the implementation agent did.
   * @param description - Plain-text context (original user input).
   * @returns Complete prompt string for the code-reviewer agent.
   */
  buildReviewPromptSimple(implOutput: string, description: string): string {
    return `## What Changed\n${implOutput}\n\n## Context\n${description}`;
  }

  // ─── Designer ─────────────────────────────────────────────────────────

  /**
   * Build the Group 1 design prompt for the `mlst-designer` agent.
   *
   * The designer produces architecture, component, or UI/UX design output that is
   * stored as `designOutput` and injected into the corresponding implementation
   * agent's GREEN-phase prompt via `buildImplFromTestsPrompt`.
   *
   * @param task          - The design task to execute.
   * @param specification - Full sprint specification for domain context.
   * @returns Complete prompt string for the designer agent.
   */
  buildDesignPrompt(task: TaskState, specification: string): string {
    return `## Design Task\n${task.title}\n\n## Acceptance Criteria\n${task.acceptanceCriteria.map((c) => `- ${c}`).join("\n")}\n\n## Specification Context\n${specification}`;
  }

  // ─── Infrastructure Engineer ──────────────────────────────────────────

  /**
   * Build the Group 1 infrastructure prompt for the `mlst-infra-engineer` agent.
   *
   * Infrastructure tasks cover CI/CD, cloud resources, Docker, and other platform concerns.
   *
   * @param task          - The infrastructure task to execute.
   * @param specification - Full sprint specification for domain context.
   * @returns Complete prompt string for the infra-engineer agent.
   */
  buildInfraPrompt(task: TaskState, specification: string): string {
    return `## Infrastructure Task\n${task.title}\n\n## Acceptance Criteria\n${task.acceptanceCriteria.map((c) => `- ${c}`).join("\n")}\n\n## Specification Context\n${specification}`;
  }

  // ─── Documentation ──────────────────────────────────────────────────

  /**
   * Build the Group 1 documentation prompt for the `mlst-impl-engineer` agent.
   *
   * Explicitly instructs the agent to write documentation only — no tests should
   * be written for documentation tasks.
   *
   * @param task          - The documentation task to execute.
   * @param specification - Full sprint specification for domain context.
   * @returns Complete prompt string for the impl-engineer agent (in documentation mode).
   */
  buildDocPrompt(task: TaskState, specification: string): string {
    return `## Documentation Task\n${task.title}\n\n## Acceptance Criteria\n${task.acceptanceCriteria.map((c) => `- ${c}`).join("\n")}\n\n## Specification Context\n${specification}\n\nWrite the documentation. Do not write tests.`;
  }
}
