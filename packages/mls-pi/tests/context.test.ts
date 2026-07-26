import { describe, it, expect } from "vitest";
import { ContextAssembler } from "../.pi/extensions/mls/context.js";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const templatesDir = path.resolve(__dirname, "fixtures/templates");

function makeCtx() {
  return new ContextAssembler(templatesDir);
}

function makeTask(overrides: Partial<Record<string, any>> = {}) {
  return {
    id: "TASK-001", label: "T1", title: "Test task", type: "Implementation",
    status: "pending", dependencies: [], parallelWith: [],
    acceptanceCriteria: ["AC1: it works", "AC2: it is fast"], filesAffected: ["src/foo.ts", "src/bar.ts"],
    assignedAgent: "mls-impl", iterationCount: 0, ...overrides,
  };
}

describe("ContextAssembler", () => {
  describe("buildSpecPrompt", () => {
    it("includes the idea section", () => {
      const result = makeCtx().buildSpecPrompt("Build a widget");
      expect(result).toContain("## Idea");
      expect(result).toContain("Build a widget");
    });

    it("includes the spec template in output template section", () => {
      const result = makeCtx().buildSpecPrompt("idea");
      expect(result).toContain("## Output Template");
      expect(result).toContain("SPEC_TEMPLATE");
    });

    it("includes decision record when provided", () => {
      const result = makeCtx().buildSpecPrompt("idea", "We chose React");
      expect(result).toContain("## Decision Record");
      expect(result).toContain("We chose React");
    });

    it("omits decision record section when not provided", () => {
      const result = makeCtx().buildSpecPrompt("idea");
      expect(result).not.toContain("## Decision Record");
    });

    it("includes constraints when provided", () => {
      const result = makeCtx().buildSpecPrompt("idea", undefined, "Must use TypeScript");
      expect(result).toContain("## Known Constraints");
      expect(result).toContain("Must use TypeScript");
    });

    it("includes orientation when provided", () => {
      const result = makeCtx().buildSpecPrompt("idea", undefined, undefined, "This is a monorepo");
      expect(result).toContain("This is a monorepo");
    });

    it("omits orientation section when not provided", () => {
      const result = makeCtx().buildSpecPrompt("idea");
      // Should not have stray orientation content
      expect(result).not.toContain("undefined");
    });
  });

  describe("buildTaskBreakdownPrompt", () => {
    it("includes the specification section", () => {
      const result = makeCtx().buildTaskBreakdownPrompt("The spec content");
      expect(result).toContain("## Specification");
      expect(result).toContain("The spec content");
    });

    it("includes the task breakdown template", () => {
      const result = makeCtx().buildTaskBreakdownPrompt("spec");
      expect(result).toContain("## Output Template");
      expect(result).toContain("TASK_TEMPLATE");
    });

    it("includes notes when provided", () => {
      const result = makeCtx().buildTaskBreakdownPrompt("spec", "Keep it simple");
      expect(result).toContain("## Notes");
      expect(result).toContain("Keep it simple");
    });

    it("omits notes section when not provided", () => {
      const result = makeCtx().buildTaskBreakdownPrompt("spec");
      expect(result).not.toContain("## Notes");
    });
  });

  describe("buildImplPrompt", () => {
    it("includes the task title", () => {
      const result = makeCtx().buildImplPrompt(makeTask(), "spec");
      expect(result).toContain("## Task");
      expect(result).toContain("Test task");
    });

    it("includes files affected when present", () => {
      const result = makeCtx().buildImplPrompt(makeTask(), "spec");
      expect(result).toContain("## Files");
      expect(result).toContain("src/foo.ts");
    });

    it("includes acceptance criteria", () => {
      const result = makeCtx().buildImplPrompt(makeTask(), "spec");
      expect(result).toContain("## Acceptance Criteria");
      expect(result).toContain("AC1: it works");
    });

    it("includes spec as context", () => {
      const result = makeCtx().buildImplPrompt(makeTask(), "the spec");
      expect(result).toContain("## Context");
      expect(result).toContain("the spec");
    });

    it("includes design output when provided", () => {
      const result = makeCtx().buildImplPrompt(makeTask(), "spec", "design notes");
      expect(result).toContain("### Design Specifications");
      expect(result).toContain("design notes");
    });

    it("omits design section when not provided", () => {
      const result = makeCtx().buildImplPrompt(makeTask(), "spec");
      expect(result).not.toContain("### Design Specifications");
    });
  });

  describe("buildBugFixPrompt", () => {
    it("includes bug fix section with input", () => {
      const result = makeCtx().buildBugFixPrompt("Button is broken");
      expect(result).toContain("## Bug Fix");
      expect(result).toContain("Button is broken");
    });

    it("includes orientation when provided", () => {
      const result = makeCtx().buildBugFixPrompt("bug", "repo context");
      expect(result).toContain("repo context");
    });

    it("omits orientation when not provided", () => {
      const result = makeCtx().buildBugFixPrompt("bug");
      expect(result).not.toContain("undefined");
    });
  });

  describe("buildImplFromSpecPrompt", () => {
    it("includes implementation specification section", () => {
      const result = makeCtx().buildImplFromSpecPrompt("do the thing");
      expect(result).toContain("## Implementation Specification");
      expect(result).toContain("do the thing");
    });

    it("includes orientation when provided", () => {
      const result = makeCtx().buildImplFromSpecPrompt("input", "orientation text");
      expect(result).toContain("orientation text");
    });
  });

  describe("buildScaffoldPrompt", () => {
    it("includes the scaffold template", () => {
      const result = makeCtx().buildScaffoldPrompt("spec");
      expect(result).toContain("SCAFFOLD_TEMPLATE");
    });

    it("includes the specification section", () => {
      const result = makeCtx().buildScaffoldPrompt("the spec content");
      expect(result).toContain("## Specification");
      expect(result).toContain("the spec content");
    });

    it("includes orientation when provided", () => {
      const result = makeCtx().buildScaffoldPrompt("spec", "orient");
      expect(result).toContain("orient");
    });
  });

  describe("buildTestFromCriteriaPrompt", () => {
    it("includes task and spec context", () => {
      const result = makeCtx().buildTestFromCriteriaPrompt(makeTask(), "spec", "code here");
      expect(result).toContain("Test task");
      expect(result).toContain("AC1: it works");
      expect(result).toContain("code here");
    });
  });

  describe("buildImplFromTestsPrompt", () => {
    it("includes task and test output", () => {
      const result = makeCtx().buildImplFromTestsPrompt(makeTask(), "spec", "test output");
      expect(result).toContain("Test task");
      expect(result).toContain("test output");
    });

    it("includes design output when provided", () => {
      const result = makeCtx().buildImplFromTestsPrompt(makeTask(), "spec", "tests", "design");
      expect(result).toContain("design");
    });
  });

  describe("buildReviewFixPrompt", () => {
    it("includes review output and iteration info", () => {
      const result = makeCtx().buildReviewFixPrompt("review comments", "prev impl", 2, 5);
      expect(result).toContain("review comments");
      expect(result).toContain("prev impl");
      expect(result).toContain("2");
      expect(result).toContain("5");
    });
  });

  describe("buildTestFixPrompt", () => {
    it("includes test output and previous implementation", () => {
      const result = makeCtx().buildTestFixPrompt("test failures", "prev impl");
      expect(result).toContain("test failures");
      expect(result).toContain("prev impl");
    });
  });

  describe("buildTestPrompt", () => {
    it("includes what changed section", () => {
      const result = makeCtx().buildTestPrompt("impl output", makeTask());
      expect(result).toContain("## What Changed");
      expect(result).toContain("impl output");
    });

    it("includes files modified when present", () => {
      const result = makeCtx().buildTestPrompt("impl", makeTask());
      expect(result).toContain("## Files Modified");
      expect(result).toContain("src/foo.ts");
    });

    it("includes acceptance criteria", () => {
      const result = makeCtx().buildTestPrompt("impl", makeTask());
      expect(result).toContain("## Acceptance Criteria");
      expect(result).toContain("AC1: it works");
    });
  });

  describe("buildTestPromptSimple", () => {
    it("includes impl output and description", () => {
      const result = makeCtx().buildTestPromptSimple("impl output", "a simple change");
      expect(result).toContain("impl output");
      expect(result).toContain("a simple change");
    });
  });

  describe("buildReviewPrompt", () => {
    it("includes impl output, task, and spec", () => {
      const result = makeCtx().buildReviewPrompt("impl", makeTask(), "spec");
      expect(result).toContain("impl");
      expect(result).toContain("Test task");
      expect(result).toContain("spec");
    });
  });

  describe("buildReviewPromptSimple", () => {
    it("includes impl output and description", () => {
      const result = makeCtx().buildReviewPromptSimple("impl output", "change desc");
      expect(result).toContain("impl output");
      expect(result).toContain("change desc");
    });
  });

  describe("buildDesignPrompt", () => {
    it("includes task and specification", () => {
      const result = makeCtx().buildDesignPrompt(makeTask(), "the specification");
      expect(result).toContain("Test task");
      expect(result).toContain("the specification");
    });
  });

  describe("buildInfraPrompt", () => {
    it("includes task and specification", () => {
      const result = makeCtx().buildInfraPrompt(makeTask(), "infra spec");
      expect(result).toContain("Test task");
      expect(result).toContain("infra spec");
    });
  });

  describe("buildDocPrompt", () => {
    it("includes task and specification", () => {
      const result = makeCtx().buildDocPrompt(makeTask(), "doc spec");
      expect(result).toContain("Test task");
      expect(result).toContain("doc spec");
    });

    it("includes instruction not to write tests", () => {
      const result = makeCtx().buildDocPrompt(makeTask(), "spec");
      expect(result).toContain("Do not write tests.");
    });
  });

  describe("missing template fallback", () => {
    it("falls back for missing decision-record template", () => {
      const result = makeCtx().buildSpecPrompt("idea", "record");
      // decision-record.md is missing from fixtures, so it should use fallback text
      // (the fallback is only relevant if the code references it; this test ensures no crash)
      expect(result).toBeDefined();
    });
  });
});
