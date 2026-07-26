import { describe, it, expect } from "vitest";
import { QualityGates } from "../.pi/extensions/mls/quality-gates.js";
import type { TaskState } from "../.pi/extensions/mls/types.js";

function makeTask(overrides: Partial<TaskState> = {}): TaskState {
  return {
    id: "TASK-001",
    label: "T1",
    title: "Test task",
    type: "Implementation",
    status: "pending",
    dependencies: [],
    parallelWith: [],
    acceptanceCriteria: ["criterion 1"],
    filesAffected: [],
    assignedAgent: "mls-impl",
    iterationCount: 0,
    ...overrides,
  };
}

describe("QualityGates", () => {
  const gates = new QualityGates();

  describe("taskBreakdownValid", () => {
    it("fails on empty task array", () => {
      const result = gates.taskBreakdownValid([]);
      expect(result.passed).toBe(false);
      expect(result.issues).toContain("No tasks generated from specification");
    });

    it("passes for a valid task", () => {
      const result = gates.taskBreakdownValid([makeTask()]);
      expect(result.passed).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it("passes for multiple valid tasks", () => {
      const result = gates.taskBreakdownValid([
        makeTask({ id: "TASK-001" }),
        makeTask({ id: "TASK-002", title: "Second task" }),
      ]);
      expect(result.passed).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it("reports missing ID", () => {
      const result = gates.taskBreakdownValid([makeTask({ id: "" })]);
      expect(result.passed).toBe(false);
      expect(result.issues).toContain("Task missing ID");
    });

    it("reports missing title", () => {
      const result = gates.taskBreakdownValid([makeTask({ title: "" })]);
      expect(result.passed).toBe(false);
      expect(result.issues).toEqual(
        expect.arrayContaining([expect.stringContaining("missing title")]),
      );
    });

    it("reports missing type", () => {
      const result = gates.taskBreakdownValid([makeTask({ type: "" as any })]);
      expect(result.passed).toBe(false);
      expect(result.issues).toEqual(
        expect.arrayContaining([expect.stringContaining("missing type")]),
      );
    });

    it("reports missing acceptance criteria", () => {
      const result = gates.taskBreakdownValid([makeTask({ acceptanceCriteria: [] })]);
      expect(result.passed).toBe(false);
      expect(result.issues).toEqual(
        expect.arrayContaining([expect.stringContaining("missing acceptance criteria")]),
      );
    });

    it("accumulates multiple issues from a single task", () => {
      const result = gates.taskBreakdownValid([
        makeTask({ id: "", title: "", type: "" as any, acceptanceCriteria: [] }),
      ]);
      expect(result.passed).toBe(false);
      expect(result.issues.length).toBeGreaterThanOrEqual(3);
      expect(result.issues).toContain("Task missing ID");
    });

    it("accumulates issues across multiple tasks", () => {
      const result = gates.taskBreakdownValid([
        makeTask({ id: "TASK-001", title: "" }),
        makeTask({ id: "TASK-002", acceptanceCriteria: [] }),
      ]);
      expect(result.passed).toBe(false);
      expect(result.issues).toHaveLength(2);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.stringContaining("TASK-001: missing title"),
          expect.stringContaining("TASK-002: missing acceptance criteria"),
        ]),
      );
    });
  });

  describe("checkDeletions", () => {
    it("classifies a normal diff as normal tier", () => {
      const diffStat = [
        " src/index.ts | 10 ++++------",
        " 1 file changed, 4 insertions(+), 6 deletions(-)",
      ].join("\n");
      const result = gates.checkDeletions(diffStat);
      expect(result.tier).toBe("normal");
      expect(result.warning).toBeUndefined();
    });

    it("classifies >3 fully deleted files as large tier", () => {
      const diffStat = [
        " a.ts | 5 -----",
        " b.ts | 3 ---",
        " c.ts | 8 --------",
        " d.ts | 2 --",
        " 4 files changed, 0 insertions(+), 18 deletions(-)",
      ].join("\n");
      const result = gates.checkDeletions(diffStat);
      expect(result.tier).toBe("large");
      expect(result.filesDeleted).toHaveLength(4);
      expect(result.warning).toBeDefined();
      expect(result.warning).toContain("DELETION REVIEW");
    });

    it("classifies >200 net lines removed as large tier", () => {
      const diffStat = [
        " big-file.ts | 250 " + "-".repeat(250),
        " 1 file changed, 0 insertions(+), 250 deletions(-)",
      ].join("\n");
      const result = gates.checkDeletions(diffStat);
      expect(result.tier).toBe("large");
      expect(result.linesRemoved).toBe(250);
    });

    it("classifies ratio >2x with net >20 removed as large tier", () => {
      const diffStat = [
        " refactor.ts | 80 ++++" + "-".repeat(60),
        " 1 file changed, 10 insertions(+), 70 deletions(-)",
      ].join("\n");
      const result = gates.checkDeletions(diffStat);
      expect(result.tier).toBe("large");
      expect(result.linesRemoved).toBe(70);
      expect(result.linesAdded).toBe(10);
    });

    it("stays normal when ratio >2x but net removed <=20", () => {
      const diffStat = [
        " small.ts | 15 ++-----",
        " 1 file changed, 2 insertions(+), 5 deletions(-)",
      ].join("\n");
      const result = gates.checkDeletions(diffStat);
      expect(result.tier).toBe("normal");
    });

    it("prefers summary line counts over per-line counting", () => {
      // The per-line +/- characters may not match exact counts;
      // the summary line should override
      const diffStat = [
        " file.ts | 100 +++++-----",
        " 1 file changed, 50 insertions(+), 50 deletions(-)",
      ].join("\n");
      const result = gates.checkDeletions(diffStat);
      expect(result.linesAdded).toBe(50);
      expect(result.linesRemoved).toBe(50);
    });

    it("handles pure additions", () => {
      const diffStat = [
        " new-file.ts | 30 ++++++++++++++++++++++++++++++",
        " 1 file changed, 30 insertions(+)",
      ].join("\n");
      const result = gates.checkDeletions(diffStat);
      expect(result.tier).toBe("normal");
      expect(result.linesAdded).toBe(30);
      expect(result.linesRemoved).toBe(0);
      expect(result.filesDeleted).toHaveLength(0);
    });

    it("handles empty input", () => {
      const result = gates.checkDeletions("");
      expect(result.tier).toBe("normal");
      expect(result.filesDeleted).toHaveLength(0);
      expect(result.warning).toBeUndefined();
    });

    it("produces Infinity ratio when no additions and some deletions", () => {
      const diffStat = [
        " gone.ts | 10 ----------",
        " 1 file changed, 10 deletions(-)",
      ].join("\n");
      const result = gates.checkDeletions(diffStat);
      expect(result.linesAdded).toBe(0);
      expect(result.linesRemoved).toBe(10);
      // net removed is 10, which is <=20, so still normal despite Infinity ratio
      expect(result.tier).toBe("normal");
    });

    it("Infinity ratio with net >20 deletions triggers large", () => {
      const diffStat = [
        " gone.ts | 50 " + "-".repeat(50),
        " 1 file changed, 50 deletions(-)",
      ].join("\n");
      const result = gates.checkDeletions(diffStat);
      expect(result.tier).toBe("large");
      expect(result.warning).toContain("∞");
    });

    it("warning includes deleted file names", () => {
      const diffStat = [
        " old-a.ts | 10 ----------",
        " old-b.ts | 10 ----------",
        " old-c.ts | 10 ----------",
        " old-d.ts | 10 ----------",
        " 4 files changed, 40 deletions(-)",
      ].join("\n");
      const result = gates.checkDeletions(diffStat);
      expect(result.tier).toBe("large");
      expect(result.warning).toContain("old-a.ts");
      expect(result.warning).toContain("old-d.ts");
    });
  });

  describe("testsPass", () => {
    it("returns false for '## test results: fail'", () => {
      expect(gates.testsPass("## test results: fail")).toBe(false);
    });

    it("returns false for '## test results: FAIL' (case insensitive)", () => {
      expect(gates.testsPass("## test results: FAIL")).toBe(false);
    });

    it("returns false for 'failed: 3'", () => {
      expect(gates.testsPass("failed: 3")).toBe(false);
    });

    it("returns false for '2 failed'", () => {
      expect(gates.testsPass("2 failed")).toBe(false);
    });

    it("returns false for '1 failure'", () => {
      expect(gates.testsPass("1 failure")).toBe(false);
    });

    it("returns false for '5 failing'", () => {
      expect(gates.testsPass("5 failing")).toBe(false);
    });

    it("returns true for '## test results: pass'", () => {
      expect(gates.testsPass("## test results: pass")).toBe(true);
    });

    it("returns true for '## test results: PASS'", () => {
      expect(gates.testsPass("## test results: PASS")).toBe(true);
    });

    it("returns true for 'all tests pass'", () => {
      expect(gates.testsPass("all tests pass")).toBe(true);
    });

    it("returns true for 'all test pass'", () => {
      expect(gates.testsPass("all test pass")).toBe(true);
    });

    it("returns true for 'failed: 0'", () => {
      expect(gates.testsPass("failed: 0")).toBe(true);
    });

    it("returns false when output contains 'error'", () => {
      expect(gates.testsPass("compilation error in test suite")).toBe(false);
    });

    it("returns false when output contains 'failure'", () => {
      expect(gates.testsPass("there was a failure during setup")).toBe(false);
    });

    it("returns true for clean output with no keywords", () => {
      expect(gates.testsPass("10 tests completed successfully")).toBe(true);
    });

    it("fail patterns take precedence over pass patterns", () => {
      // Both a fail and pass indicator present: fail should win
      expect(gates.testsPass("## test results: fail\n## test results: pass")).toBe(false);
    });

    it("'failed: N' takes precedence over 'failed: 0'", () => {
      expect(gates.testsPass("failed: 2\nfailed: 0")).toBe(false);
    });
  });
});
