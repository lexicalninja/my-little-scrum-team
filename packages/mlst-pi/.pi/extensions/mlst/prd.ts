/**
 * MLST Pi Extension — PRD (Product Requirements Document) Session
 *
 * A structured, conversational planning session that produces a PRD file.
 * The resulting PRD can be passed directly to `/build` as a rich, pre-validated
 * specification instead of a one-liner.
 *
 * This module is a planning tool only — no code execution, no agents spawned.
 * It is a pure conversation → document workflow.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { LlmClient } from "./llm.js";

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * State of a PRD draft, one field per section of the final document.
 * Empty strings indicate sections that have not yet been answered.
 */
export interface PrdDraftState {
  title: string;
  problemStatement: string;
  goalsAndNonGoals: string;
  usersAndContext: string;
  requirementsMustHave: string;
  requirementsNiceToHave: string;
  acceptanceCriteria: string;
  constraintsAndAssumptions: string;
  openQuestions: string;
}

/** A single question in the PRD session flow. */
export interface PrdQuestion {
  /** Key into PrdDraftState where the answer is stored. */
  key: keyof Omit<PrdDraftState, "title">;
  /** Short human-readable label for display. */
  label: string;
  /** Full question prompt shown to the user. */
  prompt: string;
}

/** Result of a completed PRD session. */
export interface PrdResult {
  /** Relative path to the generated PRD file (e.g., `.mlst/prd-my-feature.md`). */
  filePath: string;
  /** Title extracted from the user's input. */
  title: string;
}

/** Dependencies injected into PrdSession for testability. */
export interface PrdSessionDeps {
  /** Absolute path to the project working directory. */
  cwd: string;
  /** LLM client for title extraction and follow-up generation. */
  llm: Pick<LlmClient, "call">;
  /**
   * Prompt the user for input. Returns the user's response string.
   * The prompt string is displayed before the input field.
   */
  promptUser: (prompt: string) => Promise<string>;
  /** Display a notification to the user. */
  notify: (message: string, level: "info" | "warning" | "error" | "success") => void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Ordered list of questions asked during the PRD session.
 * Each question maps to a field in {@link PrdDraftState}.
 */
export const PRD_QUESTIONS: PrdQuestion[] = [
  {
    key: "problemStatement",
    label: "Problem Statement",
    prompt: "What problem does this solve? Describe the current pain point or gap.",
  },
  {
    key: "goalsAndNonGoals",
    label: "Goals & Non-Goals",
    prompt: "What are the must-have goals? What is explicitly out of scope (non-goals)?",
  },
  {
    key: "usersAndContext",
    label: "Users & Context",
    prompt: "Who are the users? What is the context in which this will be used?",
  },
  {
    key: "requirementsMustHave",
    label: "Must-Have Requirements",
    prompt: "What are the must-have features or requirements? List them as bullet points.",
  },
  {
    key: "requirementsNiceToHave",
    label: "Nice-to-Have Requirements",
    prompt: "Any nice-to-have features? (Press enter to skip)",
  },
  {
    key: "acceptanceCriteria",
    label: "Acceptance Criteria",
    prompt: 'What does "done" look like? List the acceptance criteria (e.g., "- [ ] Dashboard loads in under 2s").',
  },
  {
    key: "constraintsAndAssumptions",
    label: "Constraints & Assumptions",
    prompt: "Any known constraints — tech stack, existing APIs, file structure? Any assumptions?",
  },
  {
    key: "openQuestions",
    label: "Open Questions",
    prompt: "Any open questions or ambiguities that need resolution? (Press enter if none)",
  },
];

// ─── Pure Helpers ────────────────────────────────────────────────────────────

/**
 * Convert a title string to a URL-safe slug for use in file names.
 *
 * Rules:
 * - Lowercased
 * - Non-alphanumeric characters replaced with dashes
 * - Multiple consecutive dashes collapsed to one
 * - Leading/trailing dashes trimmed
 * - Truncated to 50 characters
 * - Falls back to `"untitled"` for empty/whitespace-only input
 *
 * @param title - Human-readable title string.
 * @returns A lowercase, dash-separated slug.
 */
export function generateSlug(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);

  return slug || "untitled";
}

/**
 * Build the final PRD Markdown document from a completed draft state.
 *
 * Output structure matches the suggested format from issue #25:
 * ```markdown
 * # PRD: <title>
 *
 * ## Problem Statement
 * ## Goals & Non-Goals
 * ## Users & Context
 * ## Requirements
 * ### Must Have
 * ### Nice to Have
 * ## Acceptance Criteria
 * ## Constraints & Assumptions
 * ## Open Questions
 * ```
 *
 * @param state - Completed PRD draft state with all sections.
 * @returns Formatted Markdown string.
 */
export function buildPrdMarkdown(state: PrdDraftState): string {
  return `# PRD: ${state.title}

## Problem Statement

${state.problemStatement || "_Not specified._"}

## Goals & Non-Goals

${state.goalsAndNonGoals || "_Not specified._"}

## Users & Context

${state.usersAndContext || "_Not specified._"}

## Requirements

### Must Have

${state.requirementsMustHave || "_Not specified._"}

### Nice to Have

${state.requirementsNiceToHave || "_None._"}

## Acceptance Criteria

${state.acceptanceCriteria || "_Not specified._"}

## Constraints & Assumptions

${state.constraintsAndAssumptions || "_None._"}

## Open Questions

${state.openQuestions || "_None._"}
`;
}

/**
 * Check whether a file path looks like a PRD file generated by `/prd`.
 *
 * Matches paths of the form `.mlst/prd-<slug>.md` (relative to project root).
 * Used by `/build` to detect PRD input and skip redundant spec-generation.
 *
 * @param filePath - Relative or absolute file path to check.
 * @returns `true` if the path matches the PRD naming convention.
 */
export function parsePrdFilePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return /(?:^|\/)\.mlst\/prd-[\w-]+\.md$/.test(normalized);
}

// ─── Session Class ───────────────────────────────────────────────────────────

/**
 * Drives an interactive PRD planning session.
 *
 * No code execution, no agents spawned. Pure conversation → document workflow.
 *
 * Usage:
 * ```ts
 * const session = new PrdSession(deps);
 * const result = await session.run("build me a dashboard for sprint metrics");
 * // result.filePath → ".mlst/prd-sprint-metrics-dashboard.md"
 * ```
 */
export class PrdSession {
  private deps: PrdSessionDeps;

  constructor(deps: PrdSessionDeps) {
    this.deps = deps;
  }

  /**
   * Run a full PRD planning session from an initial idea string.
   *
   * Flow:
   * 1. Extract a title from the input via LLM.
   * 2. Walk through {@link PRD_QUESTIONS} one at a time, prompting the user.
   * 3. Save incremental state to `.mlst/prd-<slug>.draft.json` after each answer.
   * 4. Build and write the final PRD to `.mlst/prd-<slug>.md`.
   * 5. Clean up the draft file.
   *
   * @param input - Raw user idea (e.g., "build me a dashboard for sprint metrics").
   * @returns The file path and title of the generated PRD.
   */
  async run(input: string): Promise<PrdResult> {
    const title = await this.extractTitle(input);
    const slug = generateSlug(title);

    const state: PrdDraftState = {
      title,
      problemStatement: "",
      goalsAndNonGoals: "",
      usersAndContext: "",
      requirementsMustHave: "",
      requirementsNiceToHave: "",
      acceptanceCriteria: "",
      constraintsAndAssumptions: "",
      openQuestions: "",
    };

    this.deps.notify(`PRD: "${title}" — answering ${PRD_QUESTIONS.length} questions`, "info");

    await this.walkQuestions(state, slug);

    const filePath = this.writePrd(state, slug);
    this.cleanupDraft(slug);

    this.deps.notify(`PRD saved: ${filePath}`, "success");
    return { filePath, title };
  }

  /**
   * Resume an incomplete PRD session from a draft file.
   *
   * Reads `.mlst/prd-<slug>.draft.json`, skips already-answered questions,
   * and continues from where the user left off.
   *
   * @param slug - The slug portion of the draft file name (e.g., "my-feature").
   * @returns The file path and title of the completed PRD.
   * @throws If no draft file exists for the given slug.
   */
  async resume(slug: string): Promise<PrdResult> {
    const draftPath = this.draftPath(slug);

    if (!fs.existsSync(draftPath)) {
      throw new Error(`No draft found for slug "${slug}". Expected: ${draftPath}`);
    }

    const state: PrdDraftState = JSON.parse(fs.readFileSync(draftPath, "utf-8"));
    this.deps.notify(`Resuming PRD: "${state.title}"`, "info");

    await this.walkQuestions(state, slug);

    const filePath = this.writePrd(state, slug);
    this.cleanupDraft(slug);

    this.deps.notify(`PRD saved: ${filePath}`, "success");
    return { filePath, title: state.title };
  }

  // ─── Internals ─────────────────────────────────────────────────────────

  /**
   * Extract a concise title from the user's initial input via LLM.
   *
   * @param input - Raw user input string.
   * @returns A short title (3-8 words).
   */
  private async extractTitle(input: string): Promise<string> {
    const response = await this.deps.llm.call(
      "Extract a concise title (3-8 words) from this feature idea. Return ONLY the title, nothing else.",
      input,
    );

    return response.trim() || "Untitled Feature";
  }

  /**
   * Walk through all PRD questions, prompting the user for each unanswered one.
   * Saves incremental state to the draft file after each answer.
   *
   * @param state - The mutable draft state to fill in.
   * @param slug  - Slug for the draft file name.
   */
  private async walkQuestions(state: PrdDraftState, slug: string): Promise<void> {
    for (const question of PRD_QUESTIONS) {
      // Skip already-answered questions (for resume)
      if (state[question.key]) {
        continue;
      }

      const answer = await this.deps.promptUser(
        `**${question.label}**\n${question.prompt}`,
      );

      state[question.key] = answer;
      this.saveDraft(state, slug);
    }
  }

  /**
   * Build the PRD Markdown and write it to `.mlst/prd-<slug>.md`.
   *
   * @param state - Completed draft state.
   * @param slug  - File name slug.
   * @returns Relative path to the written PRD file.
   */
  private writePrd(state: PrdDraftState, slug: string): string {
    const mlstDir = path.join(this.deps.cwd, ".mlst");
    fs.mkdirSync(mlstDir, { recursive: true });

    const relativePath = `.mlst/prd-${slug}.md`;
    const fullPath = path.join(this.deps.cwd, relativePath);
    const markdown = buildPrdMarkdown(state);
    fs.writeFileSync(fullPath, markdown, "utf-8");

    return relativePath;
  }

  /**
   * Save incremental draft state for resumability.
   *
   * @param state - Current draft state.
   * @param slug  - File name slug.
   */
  private saveDraft(state: PrdDraftState, slug: string): void {
    const mlstDir = path.join(this.deps.cwd, ".mlst");
    fs.mkdirSync(mlstDir, { recursive: true });

    const draftPath = this.draftPath(slug);
    fs.writeFileSync(draftPath, JSON.stringify(state, null, 2), "utf-8");
  }

  /**
   * Remove the draft file after successful PRD completion.
   *
   * @param slug - File name slug.
   */
  private cleanupDraft(slug: string): void {
    const draftPath = this.draftPath(slug);
    try {
      fs.unlinkSync(draftPath);
    } catch {
      // Draft may not exist if session was fresh and short
    }
  }

  /**
   * Resolve the absolute path to the draft JSON file for a given slug.
   *
   * @param slug - File name slug.
   * @returns Absolute path to `.mlst/prd-<slug>.draft.json`.
   */
  private draftPath(slug: string): string {
    return path.join(this.deps.cwd, ".mlst", `prd-${slug}.draft.json`);
  }
}
