import { describe, it, expect, vi, beforeEach } from "vitest";
import { StateManager, type StateManagerDeps } from "../.pi/extensions/mls/state.js";
import type { TaskState, TaskStatus } from "../.pi/extensions/mls/types.js";

function makeTask(overrides: Partial<TaskState> = {}): TaskState {
  return {
    id: "TASK-001", label: "T1", title: "Test task", type: "Implementation" as const,
    status: "pending" as const, dependencies: [], parallelWith: [],
    acceptanceCriteria: ["criterion"], filesAffected: [], assignedAgent: "mls-impl",
    iterationCount: 0, ...overrides,
  };
}

function mockDeps(): StateManagerDeps {
  return { appendEntry: vi.fn(), setStatus: vi.fn(), setWidget: vi.fn(), notify: vi.fn() };
}

describe("StateManager", () => {
  let deps: StateManagerDeps;
  let sm: StateManager;

  beforeEach(() => {
    deps = mockDeps();
    sm = new StateManager(deps);
  });

  describe("construction", () => {
    it("starts in idle phase with empty tasks", () => {
      const s = sm.getState();
      expect(s.phase).toBe("idle");
      expect(s.tasks).toEqual([]);
      expect(s.input).toBe("");
    });

    it("has default maxReviewIterations and maxTestRetries", () => {
      const s = sm.getState();
      expect(s.maxReviewIterations).toBe(3);
      expect(s.maxTestRetries).toBe(3);
    });

    it("sets startedAt to an ISO timestamp", () => {
      const s = sm.getState();
      expect(s.startedAt).toBeDefined();
      expect(Number.isNaN(new Date(s.startedAt).getTime())).toBe(false);
    });
  });

  describe("setPhase", () => {
    it("updates the phase in state", () => {
      sm.setPhase("phase1");
      expect(sm.getState().phase).toBe("phase1");
    });

    it("calls setStatus with the correct label", () => {
      sm.setPhase("phase1");
      expect(deps.setStatus).toHaveBeenCalledWith("mls", "MLS: Phase 1: Specification");
    });

    it("includes task progress in status when tasks exist", () => {
      sm.setTasks([makeTask({ status: "complete" }), makeTask({ id: "TASK-002", status: "pending" })]);
      vi.mocked(deps.setStatus).mockClear();
      sm.setPhase("phase3");
      expect(deps.setStatus).toHaveBeenCalledWith("mls", "MLS: Phase 3: Execution (1/2)");
    });

    it("clears status for idle phase", () => {
      sm.setPhase("phase1");
      vi.mocked(deps.setStatus).mockClear();
      sm.setPhase("idle");
      expect(deps.setStatus).toHaveBeenCalledWith("mls", undefined);
    });

    it("clears status for complete phase", () => {
      sm.setPhase("phase3");
      vi.mocked(deps.setStatus).mockClear();
      sm.setPhase("complete");
      expect(deps.setStatus).toHaveBeenCalledWith("mls", undefined);
    });

    it("uses the raw phase name when no label is mapped", () => {
      sm.setPhase("unknown-phase" as any);
      expect(deps.setStatus).toHaveBeenCalledWith("mls", "MLS: unknown-phase");
    });
  });

  describe("task CRUD", () => {
    it("setTasks replaces all tasks", () => {
      const tasks = [makeTask(), makeTask({ id: "TASK-002", title: "Second" })];
      sm.setTasks(tasks);
      expect(sm.getState().tasks).toHaveLength(2);
    });

    it("getTask returns the matching task", () => {
      sm.setTasks([makeTask(), makeTask({ id: "TASK-002" })]);
      expect(sm.getTask("TASK-002")?.id).toBe("TASK-002");
    });

    it("getTask returns undefined for unknown id", () => {
      sm.setTasks([makeTask()]);
      expect(sm.getTask("TASK-999")).toBeUndefined();
    });

    it("updateTask mutates an existing task", () => {
      sm.setTasks([makeTask()]);
      sm.updateTask("TASK-001", { status: "in-progress" as TaskStatus });
      expect(sm.getTask("TASK-001")?.status).toBe("in-progress");
    });

    it("updateTask is a no-op for non-existent task", () => {
      sm.setTasks([makeTask()]);
      sm.updateTask("TASK-999", { status: "complete" as TaskStatus });
      expect(sm.getTask("TASK-001")?.status).toBe("pending");
    });

    it("getTasksByType filters correctly", () => {
      sm.setTasks([
        makeTask({ id: "T1", type: "Implementation" as any }),
        makeTask({ id: "T2", type: "Testing" as any }),
        makeTask({ id: "T3", type: "Implementation" as any }),
      ]);
      expect(sm.getTasksByType("Implementation")).toHaveLength(2);
      expect(sm.getTasksByType("Testing")).toHaveLength(1);
      expect(sm.getTasksByType("Design")).toHaveLength(0);
    });

    it("getTasksByStatus filters correctly", () => {
      sm.setTasks([
        makeTask({ id: "T1", status: "pending" }),
        makeTask({ id: "T2", status: "complete" }),
        makeTask({ id: "T3", status: "pending" }),
      ]);
      expect(sm.getTasksByStatus("pending")).toHaveLength(2);
      expect(sm.getTasksByStatus("complete")).toHaveLength(1);
      expect(sm.getTasksByStatus("in-progress")).toHaveLength(0);
    });
  });

  describe("getStatusSummary", () => {
    it("includes the phase", () => {
      sm.setPhase("phase1");
      expect(sm.getStatusSummary()).toContain("Phase: phase1");
    });

    it("includes classification when set", () => {
      sm.setClassification("feature" as any);
      const summary = sm.getStatusSummary();
      expect(summary).toContain("Type: feature");
    });

    it("omits classification line when not set", () => {
      const summary = sm.getStatusSummary();
      expect(summary).not.toContain("Type:");
    });

    it("counts complete, in-progress, and escalated tasks", () => {
      sm.setTasks([
        makeTask({ id: "T1", status: "complete" }),
        makeTask({ id: "T2", status: "in-progress" }),
        makeTask({ id: "T3", status: "in-progress" }),
        makeTask({ id: "T4", status: "escalated" }),
        makeTask({ id: "T5", status: "pending" }),
      ]);
      const summary = sm.getStatusSummary();
      expect(summary).toContain("Tasks: 1/5 complete, 2 in progress");
      expect(summary).toContain("Escalated: 1");
    });

    it("lists each task with status icon", () => {
      sm.setTasks([
        makeTask({ id: "T1", title: "First", status: "pending" }),
        makeTask({ id: "T2", title: "Second", status: "complete" }),
      ]);
      const summary = sm.getStatusSummary();
      expect(summary).toContain("○ T1: First [pending]");
      expect(summary).toContain("● T2: Second [complete]");
    });

    it("does not show escalated line when none escalated", () => {
      sm.setTasks([makeTask({ status: "complete" })]);
      expect(sm.getStatusSummary()).not.toContain("Escalated:");
    });
  });

  describe("reset", () => {
    it("resets state to default with new input", () => {
      sm.setPhase("phase3");
      sm.setTasks([makeTask()]);
      sm.reset("new feature request");
      const s = sm.getState();
      expect(s.phase).toBe("idle");
      expect(s.input).toBe("new feature request");
      expect(s.tasks).toEqual([]);
    });
  });

  describe("restore", () => {
    it("merges partial data into default state", () => {
      sm.restore({ phase: "phase2", input: "restored input" });
      const s = sm.getState();
      expect(s.phase).toBe("phase2");
      expect(s.input).toBe("restored input");
      expect(s.tasks).toEqual([]);
    });

    it("restores tasks from data", () => {
      const tasks = [makeTask()];
      sm.restore({ tasks });
      expect(sm.getState().tasks).toHaveLength(1);
    });

    it("handles null gracefully", () => {
      sm.restore(null);
      expect(sm.getState().phase).toBe("idle");
    });

    it("handles undefined gracefully", () => {
      sm.restore(undefined);
      expect(sm.getState().phase).toBe("idle");
    });

    it("calls updateUI after restore", () => {
      sm.restore({ phase: "phase3", tasks: [makeTask()] });
      expect(deps.setStatus).toHaveBeenCalled();
      expect(deps.setWidget).toHaveBeenCalled();
    });
  });

  describe("complete", () => {
    it("sets phase to complete", () => {
      sm.setPhase("phase3");
      sm.complete();
      expect(sm.getState().phase).toBe("complete");
    });

    it("sets completedAt timestamp", () => {
      sm.complete();
      expect(sm.getState().completedAt).toBeDefined();
      expect(Number.isNaN(new Date(sm.getState().completedAt!).getTime())).toBe(false);
    });

    it("clears status on complete", () => {
      sm.setPhase("phase3");
      vi.mocked(deps.setStatus).mockClear();
      sm.complete();
      expect(deps.setStatus).toHaveBeenCalledWith("mls", undefined);
    });
  });

  describe("UI: widget", () => {
    it("clears mls-tasks widget (task display handled by mls-live widget)", () => {
      sm.setPhase("phase3");
      sm.setTasks([
        makeTask({ id: "T1", title: "Impl task", status: "in-progress" }),
        makeTask({ id: "T2", title: "Test task", status: "pending" }),
      ]);
      const widgetCalls = vi.mocked(deps.setWidget).mock.calls;
      const lastCall = widgetCalls[widgetCalls.length - 1];
      expect(lastCall[0]).toBe("mls-tasks");
      expect(lastCall[1]).toBeUndefined();
    });

    it("clears widget on idle phase", () => {
      sm.setTasks([makeTask()]);
      sm.setPhase("idle");
      const widgetCalls = vi.mocked(deps.setWidget).mock.calls;
      const lastCall = widgetCalls[widgetCalls.length - 1];
      expect(lastCall).toEqual(["mls-tasks", undefined]);
    });

    it("clears widget on complete phase", () => {
      sm.setTasks([makeTask()]);
      sm.setPhase("phase3");
      vi.mocked(deps.setWidget).mockClear();
      sm.complete();
      const widgetCalls = vi.mocked(deps.setWidget).mock.calls;
      const lastCall = widgetCalls[widgetCalls.length - 1];
      expect(lastCall).toEqual(["mls-tasks", undefined]);
    });

    it("clears widget when there are no tasks", () => {
      sm.setPhase("phase3");
      const widgetCalls = vi.mocked(deps.setWidget).mock.calls;
      const lastCall = widgetCalls[widgetCalls.length - 1];
      expect(lastCall).toEqual(["mls-tasks", undefined]);
    });
  });
});
