/**
 * MLST Pi Extension — Quality Gates
 *
 * Only the deterministic gates live here. Gates that need LLM evaluation
 * (spec completeness, review approval) are direct LLM calls in the orchestrator.
 */

import type { DeletionCheckResult, DeletionTier, GateResult, TaskState } from "./types.js";

// ─── Deletion Safety Thresholds ──────────────────────────────────────────

/**
 * Number of fully-deleted files that triggers the `"large"` deletion tier.
 * Three files is enough to warrant a reviewer warning without being too noisy
 * for normal refactors that delete old test fixtures or rename modules.
 */
const LARGE_FILE_THRESHOLD = 3;

/**
 * Net lines removed (removed minus added) that triggers the `"large"` tier.
 * 200 lines is calibrated to catch wholesale file removal while ignoring
 * normal refactors where code is rewritten in a different form.
 */
const LARGE_LINES_THRESHOLD = 200;

/**
 * Removal-to-addition ratio that triggers the `"large"` tier.
 * A ratio above 2× means more than twice as many lines were deleted as added.
 * The guard `netRemoved > 20` prevents flagging tiny refactors (e.g., 5 lines
 * removed, 2 added is a 2.5× ratio but is not meaningfully destructive).
 */
const LARGE_RATIO_THRESHOLD = 2;

/**
 * Deterministic quality gates for the MLST build pipeline.
 *
 * Only gates that can be evaluated without an LLM live here. Gates that require
 * model judgment (spec completeness, review approval) are implemented as direct
 * `llm()` calls in {@link Orchestrator}.
 */
export class QualityGates {
  /**
   * Validate that a parsed task list satisfies the minimum structural requirements
   * for the pipeline to proceed.
   *
   * Checks every task for: a non-empty `id`, a non-empty `title`, a non-empty `type`,
   * and at least one acceptance criterion. Collects all failures rather than failing fast,
   * so callers receive the full list of issues in a single gate result.
   *
   * @param tasks - The task array produced by `Orchestrator.parseTasks()`.
   * @returns `{ passed: true, issues: [] }` when all tasks are valid; otherwise
   *   `{ passed: false, issues: [...] }` with one entry per failing check.
   */
  taskBreakdownValid(tasks: TaskState[]): GateResult {
    if (tasks.length === 0) {
      return { passed: false, issues: ["No tasks generated from specification"] };
    }

    const issues: string[] = [];
    for (const task of tasks) {
      if (!task.id) issues.push("Task missing ID");
      if (!task.title) issues.push(`${task.id}: missing title`);
      if (!task.type) issues.push(`${task.id}: missing type`);
      if (task.acceptanceCriteria.length === 0) {
        issues.push(`${task.id}: missing acceptance criteria`);
      }
    }

    return { passed: issues.length === 0, issues };
  }

  /**
   * Parse raw `git diff --stat` output and classify the scope of deletions.
   *
   * **Parsing strategy:** Individual file lines are scanned first to identify fully-deleted
   * files (lines with deletions but no additions). The summary line
   * (`"N files changed, X insertions(+), Y deletions(-)"`) is parsed separately and its
   * numbers take precedence over per-file counts when present, because the summary is
   * authoritative (git rounds per-file counts differently).
   *
   * **Tiers:**
   * - `"normal"` — No unusual deletion patterns; no special handling needed.
   * - `"large"`  — At least one of: more than {@link LARGE_FILE_THRESHOLD} files deleted,
   *   more than {@link LARGE_LINES_THRESHOLD} net lines removed, or a removal-to-addition
   *   ratio above {@link LARGE_RATIO_THRESHOLD} (with `netRemoved > 20` guard to skip
   *   trivial refactors). The returned `warning` string should be appended to the reviewer's prompt.
   *
   * @param diffStat - Raw stdout of `git diff --stat`.
   * @returns A `DeletionCheckResult` with the tier, deleted files, and line counts.
   */
  checkDeletions(diffStat: string): DeletionCheckResult {
    const lines = diffStat.trim().split("\n");
    const filesDeleted: string[] = [];
    let totalAdded = 0;
    let totalRemoved = 0;

    for (const line of lines) {
      // "file.ts | 0" with a "delete mode" or fully removed
      // git diff --stat lines look like: " src/foo.ts | 42 +++----"
      const match = line.match(/^\s*(.+?)\s*\|\s*(\d+)/);
      if (!match) continue;

      const filePath = match[1].trim();
      const changed = parseInt(match[2], 10);

      // Count insertions (+) and deletions (-)
      const plusses = (line.match(/\+/g) || []).length;
      const minuses = (line.match(/-/g) || []).length;
      totalAdded += plusses;
      totalRemoved += minuses;

      // A file is "deleted" if it has only deletions and no insertions in the stat line
      if (minuses > 0 && plusses === 0 && changed > 0) {
        filesDeleted.push(filePath);
      }
    }

    // Also parse the summary line: "X files changed, Y insertions(+), Z deletions(-)"
    const summaryMatch = diffStat.match(
      /(\d+)\s+files?\s+changed(?:,\s*(\d+)\s+insertions?\(\+\))?(?:,\s*(\d+)\s+deletions?\(-\))?/,
    );
    if (summaryMatch) {
      const summaryAdded = parseInt(summaryMatch[2] || "0", 10);
      const summaryRemoved = parseInt(summaryMatch[3] || "0", 10);
      // Prefer the summary line numbers — they're authoritative
      if (summaryAdded > 0 || summaryRemoved > 0) {
        totalAdded = summaryAdded;
        totalRemoved = summaryRemoved;
      }
    }

    const netRemoved = Math.max(0, totalRemoved - totalAdded);
    const ratio = totalAdded > 0 ? totalRemoved / totalAdded : totalRemoved > 0 ? Infinity : 0;

    const tier: DeletionTier = this.classifyDeletionTier(filesDeleted.length, netRemoved, ratio);
    const warning = tier === "large"
      ? `⚠️ DELETION REVIEW: ${filesDeleted.length} file(s) deleted, ${totalRemoved} lines removed vs ${totalAdded} added (ratio ${ratio === Infinity ? "∞" : ratio.toFixed(1)}x). Deleted: ${filesDeleted.join(", ") || "none fully deleted"}.`
      : undefined;

    return { tier, filesDeleted, linesRemoved: totalRemoved, linesAdded: totalAdded, warning };
  }

  /**
   * Classify the deletion tier from parsed diff statistics.
   *
   * Three independent conditions each trigger `"large"`:
   * 1. `fileCount > LARGE_FILE_THRESHOLD`  — too many files fully removed.
   * 2. `netRemoved > LARGE_LINES_THRESHOLD` — too many net lines gone.
   * 3. `ratio > LARGE_RATIO_THRESHOLD && netRemoved > 20` — mostly deletions relative to
   *    additions, with the `netRemoved > 20` guard preventing false positives on tiny refactors
   *    (e.g., removing 5 lines and adding 2 is a 2.5× ratio but is not concerning).
   *
   * @param fileCount - Number of fully-deleted files.
   * @param netRemoved - Lines removed minus lines added (clamped to ≥ 0 by the caller).
   * @param ratio - `linesRemoved / linesAdded`; `Infinity` when `linesAdded === 0`.
   * @returns `"large"` when any threshold is exceeded, `"normal"` otherwise.
   */
  private classifyDeletionTier(fileCount: number, netRemoved: number, ratio: number): DeletionTier {
    if (
      fileCount > LARGE_FILE_THRESHOLD
      || netRemoved > LARGE_LINES_THRESHOLD
      || (ratio > LARGE_RATIO_THRESHOLD && netRemoved > 20)
    ) {
      return "large";
    }
    return "normal";
  }

  /**
   * Determine whether an agent's text output indicates that tests passed.
   *
   * The input is the **agent's own text output**, not raw test-runner stdout. The agent is
   * expected to include a `## Test Results: pass/fail` heading or similar structured output.
   *
   * **Heuristic rules (in order):**
   * 1. Explicit fail signals (regex patterns for failed counts, `FAIL` header) → `false`.
   * 2. Explicit pass signals (`PASS` header, "all tests pass", `failed: 0`) → `true`.
   * 3. Fallback: `true` if the lowercased output contains neither `"error"` nor `"failure"`.
   *
   * Positive patterns override negative patterns only when they both match the same string,
   * because positive checks are applied after negative checks return early.
   *
   * @param testOutput - The agent's full text output after running tests.
   * @returns `true` if the output indicates passing tests, `false` otherwise.
   */
  testsPass(testOutput: string): boolean {
    if (/## test results:\s*fail/i.test(testOutput)) return false;
    if (/failed:\s*[1-9]/i.test(testOutput)) return false;
    if (/\b\d+\s+fail(ed|ure|ing)\b/i.test(testOutput)) return false;

    if (/## test results:\s*pass/i.test(testOutput)) return true;
    if (/all\s+tests?\s+pass/i.test(testOutput)) return true;
    if (/failed:\s*0\b/.test(testOutput)) return true;

    const lower = testOutput.toLowerCase();
    return !lower.includes("error") && !lower.includes("failure");
  }
}
