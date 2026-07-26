import { describe, it, expect, vi } from "vitest";
import { Orchestrator, type OrchestratorDeps } from "../.pi/extensions/mls/orchestrator/index.js";
import type { AgentResult, MlsEvent, TaskState } from "../.pi/extensions/mls/types.js";

// Mock spawnAgent
vi.mock("../.pi/extensions/mls/agents.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../.pi/extensions/mls/agents.js")>();
  return {
    ...actual,
    spawnAgent: vi.fn().mockResolvedValue({
      agent: "mock-agent",
      task: "",
      exitCode: 0,
      output: "mock agent output",
      stderr: "",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 1 },
      model: "test-model",
    } satisfies AgentResult),
    spawnAgentsParallel: vi.fn().mockResolvedValue([]),
  };
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTask(overrides: Partial<TaskState> = {}): TaskState {
  return {
    id: overrides.id ?? "task-001",
    label: overrides.label ?? "TASK-001",
    title: overrides.title ?? "Implement feature",
    type: "Implementation" as const,
    status: "pending" as const,
    dependencies: [],
    parallelWith: [],
    acceptanceCriteria: ["criterion"],
    filesAffected: ["src/index.ts"],
    assignedAgent: "mls-impl-engineer",
    iterationCount: 0,
    ...overrides,
  };
}

function buildDeps(overrides: Partial<OrchestratorDeps> = {}): OrchestratorDeps {
  const tasks: TaskState[] = [];
  const taskMap = new Map<string, TaskState>();

  const state = {
    setPhase: vi.fn(),
    getPhase: vi.fn().mockReturnValue("idle"),
    getState: vi.fn().mockReturnValue({
      phase: "idle",
      tasks,
      input: "",
      maxReviewIterations: 3,
      maxTestRetries: 3,
      startedAt: new Date().toISOString(),
    }),
    setTasks: vi.fn().mockImplementation((newTasks: TaskState[]) => {
      tasks.length = 0;
      tasks.push(...newTasks);
      taskMap.clear();
      for (const t of newTasks) taskMap.set(t.id, t);
    }),
    getTask: vi.fn().mockImplementation((id: string) => {
      const t = taskMap.get(id);
      return t ? { ...t } : { status: "complete", label: id, title: "task title", id };
    }),
    getTasksByStatus: vi.fn().mockImplementation((status: string) =>
      tasks.filter((t) => t.status === status),
    ),
    getTasksByType: vi.fn().mockImplementation((type: string) =>
      tasks.filter((t) => t.type === type),
    ),
    updateTask: vi.fn().mockImplementation((id: string, updates: Partial<TaskState>) => {
      const t = taskMap.get(id);
      if (t) Object.assign(t, updates);
    }),
    setSpecification: vi.fn(),
    setClassification: vi.fn(),
    setMaxIterations: vi.fn(),
    reset: vi.fn(),
    restore: vi.fn(),
    complete: vi.fn(),
    getStatusSummary: vi.fn().mockReturnValue(""),
    setWidget: vi.fn(),
  } as unknown as OrchestratorDeps["state"];

  const defaults: OrchestratorDeps = {
    state,
    skills: {
      getOrchestratorSkill: vi.fn().mockReturnValue(""),
      getSkillsForAgent: vi.fn().mockReturnValue(""),
      getAgentSkills: vi.fn().mockReturnValue(""),
      load: vi.fn(),
    } as unknown as OrchestratorDeps["skills"],
    context: {
      buildSpecPrompt: vi.fn().mockReturnValue("spec prompt"),
      buildTaskBreakdownPrompt: vi.fn().mockReturnValue("task breakdown prompt"),
      buildBugFixPrompt: vi.fn().mockReturnValue("bug fix prompt"),
      buildImplFromSpecPrompt: vi.fn().mockReturnValue("impl from spec prompt"),
      buildScaffoldPrompt: vi.fn().mockReturnValue("scaffold prompt"),
      buildDesignPrompt: vi.fn().mockReturnValue("design prompt"),
      buildInfraPrompt: vi.fn().mockReturnValue("infra prompt"),
      buildDocPrompt: vi.fn().mockReturnValue("doc prompt"),
      buildTestFromCriteriaPrompt: vi.fn().mockReturnValue("test from criteria prompt"),
      buildImplFromTestsPrompt: vi.fn().mockReturnValue("impl from tests prompt"),
      buildReviewPrompt: vi.fn().mockReturnValue("review prompt"),
      buildReviewPromptSimple: vi.fn().mockReturnValue("review prompt simple"),
      buildReviewFixPrompt: vi.fn().mockReturnValue("review fix prompt"),
      buildTestFixPrompt: vi.fn().mockReturnValue("test fix prompt"),
      buildTestPrompt: vi.fn().mockReturnValue("test prompt"),
      buildTestPromptSimple: vi.fn().mockReturnValue("test prompt simple"),
    } as unknown as OrchestratorDeps["context"],
    gates: {
      taskBreakdownValid: vi.fn().mockReturnValue({ passed: true, issues: [] }),
      checkDeletions: vi.fn().mockReturnValue({ tier: "normal", filesDeleted: [], linesRemoved: 0, linesAdded: 0 }),
      testsPass: vi.fn().mockReturnValue(true),
    } as unknown as OrchestratorDeps["gates"],
    llm: {
      call: vi.fn().mockResolvedValue("LLM summary text"),
    } as unknown as OrchestratorDeps["llm"],
    db: {
      getOrCreateProject: vi.fn().mockReturnValue({ id: 1 }),
      createSprint: vi.fn().mockReturnValue({ id: 1 }),
      updateSprint: vi.fn(),
      createIssue: vi.fn().mockReturnValue({ id: 1 }),
      updateIssue: vi.fn(),
      getOrCreateLabel: vi.fn().mockReturnValue({ id: 1 }),
      addLabelToIssue: vi.fn(),
      getSprint: vi.fn().mockReturnValue(null),
      getLatestSprint: vi.fn().mockReturnValue(null),
      getSprintIssues: vi.fn().mockReturnValue([]),
    } as unknown as OrchestratorDeps["db"],
    agents: [],
    profile: {
      name: "test",
      group1Concurrency: 1,
      group2Concurrency: 1,
      maxReviewIterations: 3,
      maxTestRetries: 3,
      enablePhase0: false,
      enableSpecGate: false,
      enableReviewGate: false,
      sequentialGroup1: true,
      skipAgentsMdExtraction: true,
      humanGates: [],
      pipelineMode: "full",
    },
    cwd: "/tmp",
    model: undefined,
    signal: undefined,
    notify: vi.fn(),
    sendMessage: vi.fn(),
    exec: vi.fn().mockResolvedValue({ stdout: "", stderr: "", code: 0 }),
    emit: vi.fn(),
    onAgentProgress: undefined,
    setWorkingMessage: vi.fn(),
    promptUser: vi.fn().mockResolvedValue(null),
  };

  return { ...defaults, ...overrides };
}

function getEmittedEvents(deps: OrchestratorDeps): MlsEvent[] {
  return vi.mocked(deps.emit).mock.calls.map(([ev]) => ev);
}

// ─── AC1: MlsEvent sprint_end variant includes aborted?: boolean and abortReason?: string ──

describe("sprint_end MlsEvent type", () => {
  it("includes aborted and abortReason as optional fields on sprint_end variant", () => {
    // Type-level assertion: constructing a sprint_end event with abort metadata
    // must be valid TypeScript. If the fields don't exist on the type, this file
    // won't compile — satisfying AC1 and AC4 (TypeScript compiles cleanly).
    const abortedEvent: MlsEvent = {
      type: "sprint_end",
      summary: "Sprint aborted",
      aborted: true,
      abortReason: "User chose to abort",
      timestamp: Date.now(),
    };

    // And without abort metadata (backward compatible shape)
    const normalEvent: MlsEvent = {
      type: "sprint_end",
      summary: "Sprint complete",
      timestamp: Date.now(),
    };

    expect(abortedEvent.type).toBe("sprint_end");
    expect(normalEvent.type).toBe("sprint_end");

    // Verify the abort fields are accessible via type narrowing
    if (abortedEvent.type === "sprint_end") {
      expect(abortedEvent.aborted).toBe(true);
      expect(abortedEvent.abortReason).toBe("User chose to abort");
    }
    if (normalEvent.type === "sprint_end") {
      expect(normalEvent.aborted).toBeUndefined();
      expect(normalEvent.abortReason).toBeUndefined();
    }
  });
});

// ─── AC2: phase4() emits aborted: true and the abortReason string when sprint was aborted ──

describe("phase4() sprint_end event when aborted", () => {
  it("emits sprint_end with aborted: true and abortReason when sprint was aborted", async () => {
    const deps = buildDeps();
    vi.mocked(deps.llm.call).mockResolvedValue("Sprint was aborted. 1/2 tasks completed.");

    const tasks = [
      makeTask({ id: "t1", label: "TASK-001", status: "complete" }),
      makeTask({ id: "t2", label: "TASK-002", status: "in-progress" }),
    ];
    vi.mocked(deps.state.getTask).mockImplementation((id: string) => {
      const t = tasks.find((task) => task.id === id);
      return t ? { ...t } : undefined;
    });
    vi.mocked(deps.state.getTasksByStatus).mockImplementation((status: string) =>
      tasks.filter((t) => t.status === status),
    );

    const orchestrator = new Orchestrator(deps);
    (orchestrator as any).sprintId = 1;
    (orchestrator as any).projectId = 1;

    // Abort the controller with a specific reason
    (orchestrator as any).abortReason = "User aborted: too many failures";
    (orchestrator as any).controller.abort();

    await (orchestrator as any).phase4(tasks);

    // Find the sprint_end event
    const sprintEndEvents = getEmittedEvents(deps).filter((ev) => ev.type === "sprint_end");
    expect(sprintEndEvents).toHaveLength(1);

    const endEvent = sprintEndEvents[0];
    expect(endEvent.type).toBe("sprint_end");
    if (endEvent.type === "sprint_end") {
      expect(endEvent.aborted).toBe(true);
      expect(endEvent.abortReason).toBe("User aborted: too many failures");
    }
  });
});

// ─── AC3: When not aborted, aborted and abortReason are undefined (backward compatible) ──

describe("phase4() sprint_end event when not aborted", () => {
  it("emits sprint_end without aborted or abortReason when sprint completes normally", async () => {
    const deps = buildDeps();
    vi.mocked(deps.llm.call).mockResolvedValue("Sprint complete. All tasks done.");

    const tasks = [
      makeTask({ id: "t1", label: "TASK-001", status: "complete" }),
    ];
    vi.mocked(deps.state.getTask).mockReturnValue({ ...tasks[0] });
    vi.mocked(deps.state.getTasksByStatus).mockImplementation((status: string) =>
      tasks.filter((t) => t.status === status),
    );

    const orchestrator = new Orchestrator(deps);
    (orchestrator as any).sprintId = 1;
    (orchestrator as any).projectId = 1;

    await (orchestrator as any).phase4(tasks);

    // Find the sprint_end event
    const sprintEndEvents = getEmittedEvents(deps).filter((ev) => ev.type === "sprint_end");
    expect(sprintEndEvents).toHaveLength(1);

    const endEvent = sprintEndEvents[0];
    expect(endEvent.type).toBe("sprint_end");
    if (endEvent.type === "sprint_end") {
      expect(endEvent.aborted).toBeUndefined();
      expect(endEvent.abortReason).toBeUndefined();
    }
  });
});
