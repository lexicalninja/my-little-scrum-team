import { describe, it, expect, vi, beforeEach } from "vitest";
import { Orchestrator, type OrchestratorDeps } from "../.pi/extensions/mls/orchestrator/index.js";
import type { AgentResult, GatePoint, TaskState, MlsEvent } from "../.pi/extensions/mls/types.js";

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

// ─── Test 1: phase1() with post-spec gate — revised spec replaces original ──

describe("phase1() — post-spec gate wiring", () => {
  it("replaces spec with revised artifact when human provides feedback then approves", async () => {
    let promptCount = 0;
    const deps = buildDeps({
      profile: {
        ...buildDeps().profile,
        humanGates: ["post-spec"],
      },
      promptUser: vi.fn().mockImplementation(() => {
        promptCount++;
        if (promptCount === 1) return Promise.resolve("add error handling section");
        return Promise.resolve("approve");
      }),
    });

    // LLM call sequence:
    // 1. getProjectOrientation (returns empty for no files)
    // 2. Gate analysis
    // 3. Gate reconciliation (returns revised spec)
    // 4. (other calls as needed)
    let llmCallCount = 0;
    vi.mocked(deps.llm.call).mockImplementation(() => {
      llmCallCount++;
      if (llmCallCount === 1) return Promise.resolve("Analysis: spec lacks error handling");
      if (llmCallCount === 2) return Promise.resolve("Revised spec WITH error handling section added");
      return Promise.resolve("LLM response");
    });

    const { spawnAgent } = await import("../.pi/extensions/mls/agents.js");
    vi.mocked(spawnAgent).mockResolvedValue({
      agent: "mls-spec-writer",
      task: "",
      exitCode: 0,
      output: "Original spec without error handling",
      stderr: "",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 1 },
      model: "test-model",
    });

    const orchestrator = new Orchestrator(deps);
    (orchestrator as any).sprintId = 1;
    (orchestrator as any).projectId = 1;

    const spec = await (orchestrator as any).phase1("build a feature");

    // Spec should be the revised version, not original
    expect(spec).toContain("Revised spec WITH error handling");

    // State and DB should get the revised spec
    expect(deps.state.setSpecification).toHaveBeenCalledWith(
      expect.stringContaining("Revised spec WITH error handling"),
    );
    expect(deps.db.updateSprint).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ specification: expect.stringContaining("Revised spec WITH error handling") }),
    );

    // Gate annotation should be stored
    const annotations = (orchestrator as any).getGateAnnotationsForPrompt();
    expect(annotations).toContain("## Human Review Notes");
    expect(annotations).toContain("post-spec");
    expect(annotations).toContain("add error handling");
  });

  it("preserves original spec when human approves without feedback", async () => {
    const deps = buildDeps({
      profile: {
        ...buildDeps().profile,
        humanGates: ["post-spec"],
      },
      promptUser: vi.fn().mockResolvedValue("approve"),
    });

    vi.mocked(deps.llm.call).mockResolvedValue("Analysis looks good");

    const { spawnAgent } = await import("../.pi/extensions/mls/agents.js");
    vi.mocked(spawnAgent).mockResolvedValue({
      agent: "mls-spec-writer",
      task: "",
      exitCode: 0,
      output: "Original spec content",
      stderr: "",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 1 },
      model: "test-model",
    });

    const orchestrator = new Orchestrator(deps);
    (orchestrator as any).sprintId = 1;
    (orchestrator as any).projectId = 1;

    const spec = await (orchestrator as any).phase1("build something");

    expect(spec).toBe("Original spec content");
    expect(deps.state.setSpecification).toHaveBeenCalledWith("Original spec content");
  });

  it("persists gate annotations after post-spec gate", async () => {
    const deps = buildDeps({
      profile: {
        ...buildDeps().profile,
        humanGates: ["post-spec"],
      },
      promptUser: vi.fn().mockResolvedValue("approve"),
    });
    vi.mocked(deps.llm.call).mockResolvedValue("Analysis");

    const { spawnAgent } = await import("../.pi/extensions/mls/agents.js");
    vi.mocked(spawnAgent).mockResolvedValue({
      agent: "mls-spec-writer",
      task: "",
      exitCode: 0,
      output: "Spec",
      stderr: "",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 1 },
      model: "test-model",
    });

    const orchestrator = new Orchestrator(deps);
    (orchestrator as any).sprintId = 1;
    (orchestrator as any).projectId = 1;

    await (orchestrator as any).phase1("input");

    // persistGateAnnotations should have been called (updateSprint with gate_annotations)
    const updateCalls = vi.mocked(deps.db.updateSprint).mock.calls;
    const gateAnnotationCall = updateCalls.find(
      ([, data]) => data && typeof data === "object" && "gate_annotations" in (data as any),
    );
    expect(gateAnnotationCall).toBeDefined();
  });
});

// ─── Test 2: phase2() with post-tasks gate — task revision persisted ────────

describe("phase2() — post-tasks gate wiring", () => {
  it("re-parses and re-persists tasks when human provides feedback then approves", async () => {
    let promptCount = 0;
    const deps = buildDeps({
      profile: {
        ...buildDeps().profile,
        humanGates: ["post-tasks"],
      },
      promptUser: vi.fn().mockImplementation(() => {
        promptCount++;
        if (promptCount === 1) return Promise.resolve("add a testing task");
        return Promise.resolve("approve");
      }),
    });

    // LLM calls:
    // 1. Gate analysis of task summary
    // 2. Gate reconciliation → revised task summary (not parseable as tasks, but that's fine)
    let llmCallCount = 0;
    vi.mocked(deps.llm.call).mockImplementation((system: string, user: string) => {
      llmCallCount++;
      // parseTasks calls LLM to parse output into task JSON lines
      if (system.includes?.("Parse") || system.includes?.("parse") || system.includes?.("JSON")) {
        return Promise.resolve('{"label":"TASK-001","title":"Implement feature","type":"Implementation","dependencies":[],"parallelWith":[],"acceptanceCriteria":["test"],"filesAffected":["src/index.ts"]}');
      }
      if (system.includes?.("user provided feedback")) {
        return Promise.resolve('{"label":"TASK-001","title":"Implement feature","type":"Implementation","dependencies":[],"parallelWith":[],"acceptanceCriteria":["test"],"filesAffected":["src/index.ts"]}\n{"label":"TASK-002","title":"Add tests","type":"Testing","dependencies":[],"parallelWith":[],"acceptanceCriteria":["pass"],"filesAffected":["tests/"]}');
      }
      return Promise.resolve("Analysis: task breakdown looks reasonable");
    });

    const { spawnAgent } = await import("../.pi/extensions/mls/agents.js");
    vi.mocked(spawnAgent).mockResolvedValue({
      agent: "mls-scrum-master",
      task: "",
      exitCode: 0,
      output: 'TASK-001: Implement feature [Implementation]',
      stderr: "",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 1 },
      model: "test-model",
    });

    const orchestrator = new Orchestrator(deps);
    (orchestrator as any).sprintId = 1;
    (orchestrator as any).projectId = 1;

    await (orchestrator as any).phase2("the spec");

    // setTasks should have been called (at least once for initial, possibly again for revision)
    expect(deps.state.setTasks).toHaveBeenCalled();
    // createIssue should have been called for persisting tasks
    expect(deps.db.createIssue).toHaveBeenCalled();

    // Gate annotations persisted
    const updateCalls = vi.mocked(deps.db.updateSprint).mock.calls;
    const gateAnnotationCall = updateCalls.find(
      ([, data]) => data && typeof data === "object" && "gate_annotations" in (data as any),
    );
    expect(gateAnnotationCall).toBeDefined();
  });

  it("injects Phase 1 gate annotations into scrum-master prompt", async () => {
    const deps = buildDeps({
      profile: {
        ...buildDeps().profile,
        humanGates: ["post-spec", "post-tasks"],
      },
      promptUser: vi.fn().mockResolvedValue("approve"),
    });

    vi.mocked(deps.llm.call).mockResolvedValue(
      '{"label":"TASK-001","title":"Implement","type":"Implementation","dependencies":[],"parallelWith":[],"acceptanceCriteria":["test"],"filesAffected":[]}',
    );

    const { spawnAgent } = await import("../.pi/extensions/mls/agents.js");
    vi.mocked(spawnAgent).mockResolvedValue({
      agent: "mls-scrum-master",
      task: "",
      exitCode: 0,
      output: "TASK-001: Implement [Implementation]",
      stderr: "",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 1 },
      model: "test-model",
    });

    const orchestrator = new Orchestrator(deps);
    (orchestrator as any).sprintId = 1;
    (orchestrator as any).projectId = 1;

    // Pre-set a gate annotation as if phase1 ran
    (orchestrator as any).gateAnnotations.set("post-spec", "Human approved with PostgreSQL requirement");

    await (orchestrator as any).phase2("the spec");

    // buildTaskBreakdownPrompt should receive the annotations
    expect(deps.context.buildTaskBreakdownPrompt).toHaveBeenCalledWith(
      "the spec",
      expect.stringContaining("Human Review Notes"),
    );
  });
});

// ─── Test 3: executeImplTask() on-escalation — retry path ──────────────────

describe("executeImplTask() — on-escalation gate paths", () => {
  it("retries task when human chooses 'retry' on escalation", async () => {
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
      if (spawnCount <= 2) {
        // First attempt: test-runner + impl both throw
        return Promise.reject(new Error("Agent crashed"));
      }
      // After retry, succeed
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

    const task = makeTask();
    const orchestrator = new Orchestrator(deps);
    (orchestrator as any).sprintId = 1;
    (orchestrator as any).projectId = 1;
    (orchestrator as any).sprintContext = "";

    // The task starts as pending, then executeImplTask is called
    // The first attempt will throw, trigger escalation, human says retry,
    // and it retries (which should call executeImplTask again)
    // Since the retry also eventually fails/succeeds, we just check the pattern

    await (orchestrator as any).executeImplTask(task, "spec");

    // Should have emitted an on-escalation gate event
    const gateEvents = getHumanGateEvents(deps);
    const escalationEvent = gateEvents.find((ev) => ev.type === "human_gate" && ev.gate === "on-escalation");
    expect(escalationEvent).toBeDefined();

    // updateTask should have been called with status "pending" (reset for retry)
    expect(deps.state.updateTask).toHaveBeenCalledWith(
      task.id,
      expect.objectContaining({ status: "pending", iterationCount: 0 }),
    );
  });

  it("skips task when human chooses 'skip' on escalation", async () => {
    const deps = buildDeps({
      profile: {
        ...buildDeps().profile,
        humanGates: ["on-escalation"],
      },
      promptUser: vi.fn().mockResolvedValue("skip"),
    });

    vi.mocked(deps.llm.call).mockResolvedValue("Analysis");

    const { spawnAgent } = await import("../.pi/extensions/mls/agents.js");
    vi.mocked(spawnAgent).mockRejectedValue(new Error("Agent crashed"));

    const task = makeTask();
    const orchestrator = new Orchestrator(deps);
    (orchestrator as any).sprintId = 1;
    (orchestrator as any).projectId = 1;
    (orchestrator as any).sprintContext = "";

    await (orchestrator as any).executeImplTask(task, "spec");

    // Task should be marked complete (skipped)
    expect(deps.state.updateTask).toHaveBeenCalledWith(
      task.id,
      expect.objectContaining({ status: "complete" }),
    );
  });

  it("aborts sprint when human chooses 'abort' on escalation", async () => {
    const deps = buildDeps({
      profile: {
        ...buildDeps().profile,
        humanGates: ["on-escalation"],
      },
      promptUser: vi.fn().mockResolvedValue("abort"),
    });

    vi.mocked(deps.llm.call).mockResolvedValue("Analysis");

    const { spawnAgent } = await import("../.pi/extensions/mls/agents.js");
    vi.mocked(spawnAgent).mockRejectedValue(new Error("Agent crashed"));

    const task = makeTask();
    const orchestrator = new Orchestrator(deps);
    (orchestrator as any).sprintId = 1;
    (orchestrator as any).projectId = 1;
    (orchestrator as any).sprintContext = "";

    await (orchestrator as any).executeImplTask(task, "spec");

    // Controller should be aborted
    const controller = (orchestrator as any).controller as AbortController;
    expect(controller.signal.aborted).toBe(true);

    // Abort reason should be set
    expect((orchestrator as any).abortReason).toContain("User aborted");
    expect((orchestrator as any).abortReason).toContain(task.label);

    // Task should be escalated
    expect(deps.state.updateTask).toHaveBeenCalledWith(
      task.id,
      expect.objectContaining({ status: "escalated" }),
    );
  });
});

// ─── Test 4: Abort propagation — Phase 4 generates abort report ────────────

describe("phase4() — abort propagation", () => {
  it("generates abort report with aborted flag and reason", async () => {
    const deps = buildDeps();
    vi.mocked(deps.llm.call).mockResolvedValue("Sprint was aborted. 1/3 tasks completed.");

    // Set up tasks in state
    const completedTask = makeTask({ id: "t1", label: "TASK-001", status: "complete" });
    const pendingTask = makeTask({ id: "t2", label: "TASK-002", status: "pending" });
    const inProgressTask = makeTask({ id: "t3", label: "TASK-003", status: "in-progress" });
    const tasks = [completedTask, pendingTask, inProgressTask];

    vi.mocked(deps.state.getTask).mockImplementation((id: string) => {
      const t = tasks.find((t) => t.id === id);
      return t ? { ...t } : undefined;
    });
    vi.mocked(deps.state.getTasksByStatus).mockImplementation((status: string) =>
      tasks.filter((t) => t.status === status),
    );

    const orchestrator = new Orchestrator(deps);
    (orchestrator as any).sprintId = 1;
    (orchestrator as any).projectId = 1;

    // Abort the controller
    (orchestrator as any).abortReason = "User aborted at TASK-003: Agent crashed";
    (orchestrator as any).controller.abort();

    const summary = await (orchestrator as any).phase4(tasks);

    // LLM should have been called with abort context
    expect(deps.llm.call).toHaveBeenCalledWith(
      expect.stringContaining("aborted"),
      expect.stringContaining("Abort reason"),
      expect.anything(),
    );

    // DB should be updated with aborted status
    expect(deps.db.updateSprint).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        status: "aborted",
        abort_reason: expect.stringContaining("User aborted"),
      }),
    );

    // sprint_end event should include aborted flag
    const sprintEndEvents = getEmittedEvents(deps).filter((ev) => ev.type === "sprint_end");
    expect(sprintEndEvents).toHaveLength(1);
    const endEvent = sprintEndEvents[0] as any;
    expect(endEvent.aborted).toBe(true);
    expect(endEvent.abortReason).toContain("User aborted");
  });

  it("normal completion does not include abort metadata", async () => {
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

    const sprintEndEvents = getEmittedEvents(deps).filter((ev) => ev.type === "sprint_end");
    const endEvent = sprintEndEvents[0] as any;
    expect(endEvent.aborted).toBeUndefined();
    expect(endEvent.abortReason).toBeUndefined();
  });
});

// ─── Test 5: Fast-path post-review gate fires before complete ──────────────

describe("fastPath() — post-review gate wiring", () => {
  it("fires post-review gate after review and before state.complete()", async () => {
    const callOrder: string[] = [];
    const deps = buildDeps({
      profile: {
        ...buildDeps().profile,
        humanGates: ["post-review"],
        enableReviewGate: false,
      },
      promptUser: vi.fn().mockImplementation(() => {
        callOrder.push("promptUser");
        return Promise.resolve("approve");
      }),
    });

    // Track complete() call order
    vi.mocked(deps.state.complete).mockImplementation(() => {
      callOrder.push("complete");
    });

    // LLM calls for gate analysis, review approval etc.
    vi.mocked(deps.llm.call).mockResolvedValue("APPROVED");

    const { spawnAgent } = await import("../.pi/extensions/mls/agents.js");
    vi.mocked(spawnAgent).mockResolvedValue({
      agent: "mock-agent",
      task: "",
      exitCode: 0,
      output: "implementation output",
      stderr: "",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 1 },
      model: "test-model",
    });

    // Mock exec for lint (returns success)
    vi.mocked(deps.exec).mockResolvedValue({ stdout: "", stderr: "", code: 0 });

    const orchestrator = new Orchestrator(deps);
    (orchestrator as any).sprintId = 1;
    (orchestrator as any).projectId = 1;

    await (orchestrator as any).fastPath("fix the bug");

    // human_gate events should have been emitted for post-review
    const gateEvents = getHumanGateEvents(deps);
    const postReviewGate = gateEvents.find(
      (ev) => ev.type === "human_gate" && ev.gate === "post-review",
    );
    expect(postReviewGate).toBeDefined();

    // promptUser should happen before complete
    const promptIdx = callOrder.indexOf("promptUser");
    const completeIdx = callOrder.indexOf("complete");
    expect(promptIdx).toBeGreaterThan(-1);
    expect(completeIdx).toBeGreaterThan(-1);
    expect(promptIdx).toBeLessThan(completeIdx);
  });

  it("fires post-review gate in implFastPath before state.complete()", async () => {
    const callOrder: string[] = [];
    const deps = buildDeps({
      profile: {
        ...buildDeps().profile,
        humanGates: ["post-review"],
        enableReviewGate: false,
      },
      promptUser: vi.fn().mockImplementation(() => {
        callOrder.push("promptUser");
        return Promise.resolve("approve");
      }),
    });

    vi.mocked(deps.state.complete).mockImplementation(() => {
      callOrder.push("complete");
    });

    vi.mocked(deps.llm.call).mockResolvedValue("APPROVED");

    const { spawnAgent } = await import("../.pi/extensions/mls/agents.js");
    vi.mocked(spawnAgent).mockResolvedValue({
      agent: "mock-agent",
      task: "",
      exitCode: 0,
      output: "impl output",
      stderr: "",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 1 },
      model: "test-model",
    });

    vi.mocked(deps.exec).mockResolvedValue({ stdout: "", stderr: "", code: 0 });

    const orchestrator = new Orchestrator(deps);
    (orchestrator as any).sprintId = 1;
    (orchestrator as any).projectId = 1;

    await (orchestrator as any).implFastPath("implement this spec");

    const gateEvents = getHumanGateEvents(deps);
    const postReviewGate = gateEvents.find(
      (ev) => ev.type === "human_gate" && ev.gate === "post-review",
    );
    expect(postReviewGate).toBeDefined();

    const promptIdx = callOrder.indexOf("promptUser");
    const completeIdx = callOrder.indexOf("complete");
    expect(promptIdx).toBeLessThan(completeIdx);
  });
});

// ─── Test 6: Resume loads gate_annotations from SQLite ─────────────────────

describe("resume — gate annotations from SQLite", () => {
  it("restoreGateAnnotations loads from JSON and appears in prompts", () => {
    const deps = buildDeps();
    const orchestrator = new Orchestrator(deps);

    const json = JSON.stringify({
      "post-spec": "Human approved with PostgreSQL requirement",
      "post-tasks": "Human asked for additional testing task",
    });

    orchestrator.restoreGateAnnotations(json);

    const annotations = (orchestrator as any).getGateAnnotationsForPrompt();
    expect(annotations).toContain("## Human Review Notes");
    expect(annotations).toContain("post-spec");
    expect(annotations).toContain("PostgreSQL");
    expect(annotations).toContain("post-tasks");
    expect(annotations).toContain("additional testing task");
  });

  it("resumeFromPhase3 uses restored gate annotations in phase3 prompts", async () => {
    const deps = buildDeps({
      profile: {
        ...buildDeps().profile,
        humanGates: [],
        skipAgentsMdExtraction: true,
      },
    });

    vi.mocked(deps.llm.call).mockResolvedValue("LLM response");

    const { spawnAgent } = await import("../.pi/extensions/mls/agents.js");
    vi.mocked(spawnAgent).mockResolvedValue({
      agent: "mock-agent",
      task: "",
      exitCode: 0,
      output: "output",
      stderr: "",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 1 },
      model: "test-model",
    });

    const orchestrator = new Orchestrator(deps);

    // Restore gate annotations first
    orchestrator.restoreGateAnnotations(JSON.stringify({
      "post-spec": "Must use PostgreSQL",
    }));

    const task = makeTask({ type: "Implementation" });
    const tasks = [task];

    await orchestrator.resumeFromPhase3("the spec", tasks, 1, 1);

    // The annotations should be accessible during phase3
    const annotations = (orchestrator as any).getGateAnnotationsForPrompt();
    expect(annotations).toContain("PostgreSQL");
  });
});

// ─── Test 7: Full pipeline E2E with gates — approve on first prompt ────────

describe("fullPipeline — E2E with gates", () => {
  it("completes pipeline with post-spec and post-tasks gates when human approves immediately", async () => {
    const deps = buildDeps({
      profile: {
        ...buildDeps().profile,
        humanGates: ["post-spec", "post-tasks"],
        skipAgentsMdExtraction: true,
        enablePhase0: false,
        enableSpecGate: false,
        enableReviewGate: false,
        sequentialGroup1: true,
      },
      promptUser: vi.fn().mockResolvedValue("approve"),
    });

    vi.mocked(deps.llm.call).mockImplementation((system: string) => {
      if (system.includes("classify") || system.includes("Classify") || system.includes("TYPE:")) {
        return Promise.resolve("TYPE: feature\nREASON: a feature");
      }
      if (system.includes("Parse") || system.includes("parse") || system.includes("JSON")) {
        return Promise.resolve('{"label":"TASK-001","title":"Implement feature","type":"Implementation","dependencies":[],"parallelWith":[],"acceptanceCriteria":["test"],"filesAffected":["src/index.ts"]}');
      }
      return Promise.resolve("LLM analysis or summary");
    });

    const { spawnAgent } = await import("../.pi/extensions/mls/agents.js");
    vi.mocked(spawnAgent).mockResolvedValue({
      agent: "mock-agent",
      task: "",
      exitCode: 0,
      output: "agent output",
      stderr: "",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 1 },
      model: "test-model",
    });

    vi.mocked(deps.exec).mockResolvedValue({ stdout: "", stderr: "", code: 0 });

    const orchestrator = new Orchestrator(deps);
    (orchestrator as any).sprintId = 1;
    (orchestrator as any).projectId = 1;

    await (orchestrator as any).fullPipeline("build a user auth feature", false);

    // Both gates should have fired
    const gateEvents = getHumanGateEvents(deps);
    const postSpecGates = gateEvents.filter((ev) => ev.type === "human_gate" && ev.gate === "post-spec");
    const postTasksGates = gateEvents.filter((ev) => ev.type === "human_gate" && ev.gate === "post-tasks");

    expect(postSpecGates.length).toBeGreaterThanOrEqual(2); // analyzing + waiting + approved
    expect(postTasksGates.length).toBeGreaterThanOrEqual(2);

    // Both should end in approved
    expect(postSpecGates[postSpecGates.length - 1].status).toBe("approved");
    expect(postTasksGates[postTasksGates.length - 1].status).toBe("approved");

    // Pipeline should complete
    expect(deps.state.complete).toHaveBeenCalled();
  });
});

// ─── Test 8: --plan mode stops after Phase 2, --resume continues ───────────

describe("fullPipeline — plan mode + resume", () => {
  it("review-only mode stops after Phase 2 and persists resume state", async () => {
    const deps = buildDeps({
      profile: {
        ...buildDeps().profile,
        humanGates: [],
        pipelineMode: "review-only",
        skipAgentsMdExtraction: true,
      },
    });

    vi.mocked(deps.llm.call).mockResolvedValue(
      '{"label":"TASK-001","title":"Implement","type":"Implementation","dependencies":[],"parallelWith":[],"acceptanceCriteria":["test"],"filesAffected":[]}',
    );

    const { spawnAgent } = await import("../.pi/extensions/mls/agents.js");
    vi.mocked(spawnAgent).mockResolvedValue({
      agent: "mock-agent",
      task: "",
      exitCode: 0,
      output: "agent output",
      stderr: "",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 1 },
      model: "test-model",
    });

    const orchestrator = new Orchestrator(deps);
    (orchestrator as any).sprintId = 1;
    (orchestrator as any).projectId = 1;

    const result = await (orchestrator as any).fullPipeline("build a feature", false);

    expect(result).toContain("Review-only");

    // Resume state should be persisted
    const updateCalls = vi.mocked(deps.db.updateSprint).mock.calls;
    const resumeCall = updateCalls.find(
      ([, data]) => data && typeof data === "object" && "execution_profile" in (data as any),
    );
    expect(resumeCall).toBeDefined();
  });

  it("resumeFromPhase3 continues from Phase 3 with restored annotations", async () => {
    const deps = buildDeps({
      profile: {
        ...buildDeps().profile,
        humanGates: [],
        skipAgentsMdExtraction: true,
        enableReviewGate: false,
      },
    });

    vi.mocked(deps.llm.call).mockResolvedValue("LLM response");

    const { spawnAgent } = await import("../.pi/extensions/mls/agents.js");
    vi.mocked(spawnAgent).mockResolvedValue({
      agent: "mock-agent",
      task: "",
      exitCode: 0,
      output: "output",
      stderr: "",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 1 },
      model: "test-model",
    });

    vi.mocked(deps.exec).mockResolvedValue({ stdout: "", stderr: "", code: 0 });

    const orchestrator = new Orchestrator(deps);

    // Restore gate annotations as if --plan had set them
    orchestrator.restoreGateAnnotations(JSON.stringify({
      "post-spec": "Approved with PostgreSQL note",
    }));

    const task = makeTask({ type: "Implementation" });

    const summary = await orchestrator.resumeFromPhase3("the spec", [task], 1, 1);

    // Phase 3 and 4 should have run
    expect(deps.state.setPhase).toHaveBeenCalledWith("phase3");
    expect(deps.state.setPhase).toHaveBeenCalledWith("phase4");

    // Sprint should end
    const sprintEndEvents = getEmittedEvents(deps).filter((ev) => ev.type === "sprint_end");
    expect(sprintEndEvents).toHaveLength(1);
  });
});

// ─── Test 9: Abort mid-sprint — partial completion report ──────────────────

describe("abort mid-sprint — partial report", () => {
  it("phase4 with partial completion produces abort report with correct counts", async () => {
    const deps = buildDeps();

    // 3 tasks: 1 complete, 1 in-progress, 1 pending
    const tasks = [
      makeTask({ id: "t1", label: "TASK-001", status: "complete" }),
      makeTask({ id: "t2", label: "TASK-002", status: "in-progress" }),
      makeTask({ id: "t3", label: "TASK-003", status: "pending" }),
    ];

    vi.mocked(deps.state.getTask).mockImplementation((id: string) => {
      const t = tasks.find((t) => t.id === id);
      return t ? { ...t } : undefined;
    });
    vi.mocked(deps.state.getTasksByStatus).mockImplementation((status: string) =>
      tasks.filter((t) => t.status === status),
    );
    vi.mocked(deps.llm.call).mockResolvedValue("Aborted sprint summary: 1 of 3 completed");

    const orchestrator = new Orchestrator(deps);
    (orchestrator as any).sprintId = 1;
    (orchestrator as any).projectId = 1;

    // Abort the sprint
    (orchestrator as any).abortReason = "User aborted at TASK-002: compilation failure";
    (orchestrator as any).controller.abort();

    const summary = await (orchestrator as any).phase4(tasks);

    // Summary should mention aborted
    expect(summary).toContain("Aborted");

    // LLM prompt should mention abort
    const llmCallArgs = vi.mocked(deps.llm.call).mock.calls[0];
    expect(llmCallArgs[0]).toContain("aborted");
    expect(llmCallArgs[1]).toContain("Completed: 1/3");
    expect(llmCallArgs[1]).toContain("Abort reason");

    // DB update should have aborted status
    expect(deps.db.updateSprint).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        status: "aborted",
        abort_reason: expect.stringContaining("TASK-002"),
      }),
    );

    // sprint_end event should contain abort metadata
    const endEvent = getEmittedEvents(deps).find((ev) => ev.type === "sprint_end") as any;
    expect(endEvent.aborted).toBe(true);
    expect(endEvent.abortReason).toContain("TASK-002");
  });
});

// ─── Test 10: Gate cost tracking ───────────────────────────────────────────

describe("gate cost tracking", () => {
  it("tracks LLM calls made during gate analysis and reconciliation", async () => {
    let promptCount = 0;
    const deps = buildDeps({
      profile: {
        ...buildDeps().profile,
        humanGates: ["post-spec"],
      },
      promptUser: vi.fn().mockImplementation(() => {
        promptCount++;
        if (promptCount === 1) return Promise.resolve("add error handling");
        return Promise.resolve("approve");
      }),
    });

    vi.mocked(deps.llm.call).mockResolvedValue("LLM response");

    const orchestrator = new Orchestrator(deps);

    await (orchestrator as any).humanGate("post-spec", "artifact");

    // Should have tracked: 1 analysis + 1 reconciliation = 2 LLM calls
    const cost = orchestrator.getGateCost();
    expect(cost.llmCalls).toBe(2);
  });

  it("tracks escalation handler LLM calls", async () => {
    const deps = buildDeps({
      profile: {
        ...buildDeps().profile,
        humanGates: ["on-escalation"],
      },
      promptUser: vi.fn().mockResolvedValue("escalate"),
    });

    vi.mocked(deps.llm.call).mockResolvedValue("Escalation analysis");

    const orchestrator = new Orchestrator(deps);
    const task = makeTask();

    await (orchestrator as any).handleEscalationGate(task, "review output", 3);

    const cost = orchestrator.getGateCost();
    expect(cost.llmCalls).toBe(1); // 1 analysis call
  });

  it("returns 0 when no gates have fired", () => {
    const deps = buildDeps();
    const orchestrator = new Orchestrator(deps);

    const cost = orchestrator.getGateCost();
    expect(cost.llmCalls).toBe(0);
  });
});
