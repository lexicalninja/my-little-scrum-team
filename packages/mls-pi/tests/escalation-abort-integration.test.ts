/**
 * TASK-008: Integration tests — escalation gate paths & abort propagation
 *
 * Tests the connected flow from escalation gate actions through to sprint_end events,
 * verifying that abort metadata propagates correctly across the pipeline.
 *
 * All tests use sprint_end event with aborted: true (requires TASK-001).
 */
import { describe, it, expect, vi } from "vitest";
import { Orchestrator, type OrchestratorDeps } from "../.pi/extensions/mls/orchestrator/index.js";
import type { AgentResult, MlsEvent, TaskState } from "../.pi/extensions/mls/types.js";

// Mock spawnAgent & friends
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
    agents: [
      { name: "mls-spec-writer", description: "", systemPrompt: "", filePath: "/agents/mls-spec-writer.md" },
      { name: "mls-scrum-master", description: "", systemPrompt: "", filePath: "/agents/mls-scrum-master.md" },
      { name: "mls-impl-engineer", description: "", systemPrompt: "", filePath: "/agents/mls-impl-engineer.md" },
      { name: "mls-test-runner", description: "", systemPrompt: "", filePath: "/agents/mls-test-runner.md" },
      { name: "mls-code-reviewer", description: "", systemPrompt: "", filePath: "/agents/mls-code-reviewer.md" },
      { name: "mls-designer", description: "", systemPrompt: "", filePath: "/agents/mls-designer.md" },
      { name: "mls-infra-engineer", description: "", systemPrompt: "", filePath: "/agents/mls-infra-engineer.md" },
    ],
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

function getHumanGateEvents(deps: OrchestratorDeps) {
  return getEmittedEvents(deps).filter((ev) => ev.type === "human_gate");
}

// ─── Test 4: Retry path resets iteration count and re-runs ──────────────────

describe("executeImplTask escalation retry path", () => {
  it("resets iteration count to zero and re-runs the task on retry", async () => {
    const deps = buildDeps({
      profile: {
        ...buildDeps().profile,
        humanGates: ["on-escalation"],
      },
      promptUser: vi.fn().mockResolvedValue("retry"),
    });

    // LLM for escalation analysis
    vi.mocked(deps.llm.call).mockResolvedValue("Task failed due to type errors");

    const { spawnAgent } = await import("../.pi/extensions/mls/agents.js");
    let spawnCount = 0;
    vi.mocked(spawnAgent).mockImplementation(() => {
      spawnCount++;
      // First 2 calls fail (test-runner + impl or just impl), triggering escalation
      if (spawnCount <= 2) {
        return Promise.reject(new Error("Agent crashed"));
      }
      // After retry, succeed for all subsequent calls
      return Promise.resolve({
        agent: "mock-agent",
        task: "",
        exitCode: 0,
        output: "Success output",
        stderr: "",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 1 },
        model: "test-model",
      });
    });

    const task = makeTask({ iterationCount: 2 });
    const orchestrator = new Orchestrator(deps);
    (orchestrator as any).sprintId = 1;
    (orchestrator as any).projectId = 1;
    (orchestrator as any).sprintContext = "";

    await (orchestrator as any).executeImplTask(task, "spec");

    // Verify iteration count was reset to 0 before re-run
    const updateCalls = vi.mocked(deps.state.updateTask).mock.calls;
    const resetCall = updateCalls.find(
      ([id, updates]) => id === task.id && (updates as any).iterationCount === 0 && (updates as any).status === "pending",
    );
    expect(resetCall).toBeDefined();

    // Verify the task was re-attempted (spawnAgent called more than the initial failure count)
    expect(spawnCount).toBeGreaterThan(2);

    // Verify controller was NOT aborted (retry should recover, not abort)
    const controller = (orchestrator as any).controller as AbortController;
    expect(controller.signal.aborted).toBe(false);

    // Verify no sprint_end with aborted: true was emitted (retry recovered successfully)
    const sprintEndEvents = getEmittedEvents(deps).filter((ev) => ev.type === "sprint_end");
    const abortedEnd = sprintEndEvents.find(
      (ev) => ev.type === "sprint_end" && (ev as any).aborted === true,
    );
    expect(abortedEnd).toBeUndefined();
  });
});

// ─── Test 5: Abort path sets controller signal and reason ──────────────────

describe("executeImplTask escalation abort path", () => {
  it("sets controller signal aborted and captures abort reason with task label", async () => {
    const deps = buildDeps({
      profile: {
        ...buildDeps().profile,
        humanGates: ["on-escalation"],
      },
      promptUser: vi.fn().mockResolvedValue("abort"),
    });

    vi.mocked(deps.llm.call).mockResolvedValue("Escalation analysis");

    const { spawnAgent } = await import("../.pi/extensions/mls/agents.js");
    vi.mocked(spawnAgent).mockRejectedValue(new Error("Compilation failed"));

    const task = makeTask({ label: "TASK-007" });
    const orchestrator = new Orchestrator(deps);
    (orchestrator as any).sprintId = 1;
    (orchestrator as any).projectId = 1;
    (orchestrator as any).sprintContext = "";

    await (orchestrator as any).executeImplTask(task, "spec");

    // Controller signal must be aborted
    const controller = (orchestrator as any).controller as AbortController;
    expect(controller.signal.aborted).toBe(true);

    // Abort reason must reference the task label and the error
    const abortReason = (orchestrator as any).abortReason as string;
    expect(abortReason).toContain("TASK-007");
    expect(abortReason).toContain("Compilation failed");

    // Task should be marked as escalated
    expect(deps.state.updateTask).toHaveBeenCalledWith(
      task.id,
      expect.objectContaining({ status: "escalated" }),
    );

    // Verify phase4 would produce correct sprint_end event with abort metadata
    // by calling phase4 with the aborted state in place
    vi.mocked(deps.llm.call).mockResolvedValue("Sprint aborted after TASK-007 failed.");
    vi.mocked(deps.state.getTasksByStatus).mockImplementation((status: string) =>
      status === "escalated" ? [task] : [],
    );

    const summary = await (orchestrator as any).phase4([task]);

    const sprintEndEvents = getEmittedEvents(deps).filter((ev) => ev.type === "sprint_end");
    expect(sprintEndEvents.length).toBeGreaterThanOrEqual(1);
    const endEvent = sprintEndEvents[sprintEndEvents.length - 1] as Extract<MlsEvent, { type: "sprint_end" }>;
    expect(endEvent.aborted).toBe(true);
    expect(endEvent.abortReason).toContain("TASK-007");
  });
});

// ─── Test 6: Phase 4 abort report with correct event fields ────────────────

describe("phase4 abort report event fields", () => {
  it("emits sprint_end with aborted, abortReason, summary, and timestamp fields", async () => {
    const deps = buildDeps();

    const tasks = [
      makeTask({ id: "t1", label: "TASK-001", status: "complete" }),
      makeTask({ id: "t2", label: "TASK-002", status: "escalated" }),
    ];
    vi.mocked(deps.state.getTask).mockImplementation((id: string) => {
      const t = tasks.find((task) => task.id === id);
      return t ? { ...t } : undefined;
    });
    vi.mocked(deps.state.getTasksByStatus).mockImplementation((status: string) =>
      tasks.filter((t) => t.status === status),
    );
    vi.mocked(deps.llm.call).mockResolvedValue("Aborted: 1/2 tasks done, TASK-002 failed.");

    const orchestrator = new Orchestrator(deps);
    (orchestrator as any).sprintId = 1;
    (orchestrator as any).projectId = 1;

    // Set abort state
    (orchestrator as any).abortReason = "User aborted at TASK-002: type error";
    (orchestrator as any).controller.abort();

    const beforeCall = Date.now();
    await (orchestrator as any).phase4(tasks);
    const afterCall = Date.now();

    const sprintEndEvents = getEmittedEvents(deps).filter((ev) => ev.type === "sprint_end");
    expect(sprintEndEvents).toHaveLength(1);

    const endEvent = sprintEndEvents[0] as Extract<MlsEvent, { type: "sprint_end" }>;

    // All required fields present and correct
    expect(endEvent.type).toBe("sprint_end");
    expect(endEvent.aborted).toBe(true);
    expect(endEvent.abortReason).toBe("User aborted at TASK-002: type error");
    expect(endEvent.summary).toContain("Aborted");
    expect(endEvent.timestamp).toBeGreaterThanOrEqual(beforeCall);
    expect(endEvent.timestamp).toBeLessThanOrEqual(afterCall);

    // DB should reflect abort status
    expect(deps.db.updateSprint).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        status: "aborted",
        abort_reason: "User aborted at TASK-002: type error",
      }),
    );

    // LLM prompt should mention "aborted" for proper summary generation
    const llmCalls = vi.mocked(deps.llm.call).mock.calls;
    expect(llmCalls.length).toBeGreaterThanOrEqual(1);
    const [systemPrompt, userPrompt] = llmCalls[0];
    expect(systemPrompt).toContain("aborted");
    expect(userPrompt).toContain("Abort reason");
    expect(userPrompt).toContain("TASK-002");
  });
});

// ─── Test 7: Partial completion report with task counts ────────────────────

describe("phase4 partial completion report with task counts", () => {
  it("includes correct completed/total counts and abort reason in sprint_end event", async () => {
    const deps = buildDeps();

    // 5 tasks: 2 complete, 1 in-progress, 1 escalated, 1 pending
    const tasks = [
      makeTask({ id: "t1", label: "TASK-001", status: "complete" }),
      makeTask({ id: "t2", label: "TASK-002", status: "complete" }),
      makeTask({ id: "t3", label: "TASK-003", status: "in-progress" }),
      makeTask({ id: "t4", label: "TASK-004", status: "escalated" }),
      makeTask({ id: "t5", label: "TASK-005", status: "pending" }),
    ];
    vi.mocked(deps.state.getTask).mockImplementation((id: string) => {
      const t = tasks.find((task) => task.id === id);
      return t ? { ...t } : undefined;
    });
    vi.mocked(deps.state.getTasksByStatus).mockImplementation((status: string) =>
      tasks.filter((t) => t.status === status),
    );
    vi.mocked(deps.llm.call).mockResolvedValue(
      "Sprint aborted. 2 of 5 tasks completed. TASK-003 was in progress. TASK-004 escalated. TASK-005 not started.",
    );

    const orchestrator = new Orchestrator(deps);
    (orchestrator as any).sprintId = 1;
    (orchestrator as any).projectId = 1;

    // Set abort state
    (orchestrator as any).abortReason = "User aborted at TASK-003: build failure";
    (orchestrator as any).controller.abort();

    const summary = await (orchestrator as any).phase4(tasks);

    // Summary should reference the partial completion
    expect(summary).toContain("2 of 5");

    // LLM was given the correct task count context
    const llmCalls = vi.mocked(deps.llm.call).mock.calls;
    const [, userPrompt] = llmCalls[0];
    expect(userPrompt).toContain("Completed: 2/5");
    expect(userPrompt).toContain("Abort reason: User aborted at TASK-003: build failure");

    // Each task's status icon is present in the LLM context
    expect(userPrompt).toContain("✓ TASK-001");
    expect(userPrompt).toContain("✓ TASK-002");
    expect(userPrompt).toContain("○ TASK-003"); // in-progress gets ○
    expect(userPrompt).toContain("✗ TASK-004"); // escalated gets ✗
    expect(userPrompt).toContain("○ TASK-005"); // pending gets ○

    // sprint_end event has aborted: true
    const sprintEndEvents = getEmittedEvents(deps).filter((ev) => ev.type === "sprint_end");
    expect(sprintEndEvents).toHaveLength(1);
    const endEvent = sprintEndEvents[0] as Extract<MlsEvent, { type: "sprint_end" }>;
    expect(endEvent.aborted).toBe(true);
    expect(endEvent.abortReason).toContain("TASK-003");

    // DB updated with aborted status and reason
    expect(deps.db.updateSprint).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        status: "aborted",
        abort_reason: "User aborted at TASK-003: build failure",
      }),
    );
  });
});
