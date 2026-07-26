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

// ─── Test 8: Annotation restoration from JSON ──────────────────────────────

describe("restoreGateAnnotations — annotation restoration from JSON", () => {
  it("restores gate annotations from JSON and makes them available in prompt format", () => {
    const deps = buildDeps();
    const orchestrator = new Orchestrator(deps);

    const json = JSON.stringify({
      "post-spec": "Human approved with PostgreSQL requirement",
      "post-tasks": "Human asked for additional testing task",
    });

    orchestrator.restoreGateAnnotations(json);

    const annotations = (orchestrator as any).getGateAnnotationsForPrompt();
    expect(annotations).toContain("## Human Review Notes");
    expect(annotations).toContain("### post-spec");
    expect(annotations).toContain("PostgreSQL");
    expect(annotations).toContain("### post-tasks");
    expect(annotations).toContain("additional testing task");
  });
});

// ─── Test 9: Full E2E pipeline with both gates approved ────────────────────

describe("fullPipeline — E2E with both gates approved", () => {
  it("completes full pipeline with post-spec and post-tasks gates when human approves both", async () => {
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
        return Promise.resolve(
          '{"label":"TASK-001","title":"Implement feature","type":"Implementation","dependencies":[],"parallelWith":[],"acceptanceCriteria":["test"],"filesAffected":["src/index.ts"]}',
        );
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

    // Both gates should have fired and ended in approved
    const gateEvents = getHumanGateEvents(deps);
    const postSpecGates = gateEvents.filter((ev) => ev.type === "human_gate" && ev.gate === "post-spec");
    const postTasksGates = gateEvents.filter((ev) => ev.type === "human_gate" && ev.gate === "post-tasks");

    expect(postSpecGates.length).toBeGreaterThanOrEqual(2);
    expect(postTasksGates.length).toBeGreaterThanOrEqual(2);
    expect(postSpecGates[postSpecGates.length - 1].status).toBe("approved");
    expect(postTasksGates[postTasksGates.length - 1].status).toBe("approved");

    // Pipeline should complete with sprint_end
    const sprintEnd = getEmittedEvents(deps).find((ev) => ev.type === "sprint_end");
    expect(sprintEnd).toBeDefined();
    expect(deps.state.complete).toHaveBeenCalled();
  });
});

// ─── Test 10: Plan→resume preserves state across orchestrator instances ────

describe("plan→resume — state preservation across orchestrator instances", () => {
  it("plan mode persists gate annotations and resume state, then a new orchestrator instance resumes from Phase 3 with those annotations", async () => {
    // ─── Step 1: "Plan" orchestrator (review-only mode) ───────────────

    // Simulated DB storage — captures what's persisted by plan mode
    const dbStore: Record<string, any> = {};

    const planDeps = buildDeps({
      profile: {
        ...buildDeps().profile,
        humanGates: ["post-spec"],
        pipelineMode: "review-only",
        skipAgentsMdExtraction: true,
        enablePhase0: false,
        enableSpecGate: false,
      },
      promptUser: vi.fn().mockImplementation(() => {
        // First prompt: provide feedback, second: approve
        if ((planDeps.promptUser as any).callCount === undefined) {
          (planDeps.promptUser as any).callCount = 0;
        }
        (planDeps.promptUser as any).callCount++;
        if ((planDeps.promptUser as any).callCount === 1) {
          return Promise.resolve("must use PostgreSQL not MySQL");
        }
        return Promise.resolve("approve");
      }),
    });

    // Capture DB writes
    vi.mocked(planDeps.db.updateSprint).mockImplementation((_id: number, data: any) => {
      if (data && typeof data === "object") {
        Object.assign(dbStore, data);
      }
    });

    vi.mocked(planDeps.llm.call).mockImplementation((system: string) => {
      if (system.includes("Parse") || system.includes("parse") || system.includes("JSON")) {
        return Promise.resolve(
          '{"label":"TASK-001","title":"Implement auth","type":"Implementation","dependencies":[],"parallelWith":[],"acceptanceCriteria":["test"],"filesAffected":["src/auth.ts"]}',
        );
      }
      return Promise.resolve("LLM analysis or reconciled output");
    });

    const { spawnAgent } = await import("../.pi/extensions/mls/agents.js");
    vi.mocked(spawnAgent).mockResolvedValue({
      agent: "mock-agent",
      task: "",
      exitCode: 0,
      output: "spec output",
      stderr: "",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 1 },
      model: "test-model",
    });

    const planOrchestrator = new Orchestrator(planDeps);
    (planOrchestrator as any).sprintId = 1;
    (planOrchestrator as any).projectId = 1;

    const planResult = await (planOrchestrator as any).fullPipeline("build user auth", false);
    expect(planResult).toContain("Review-only");

    // Verify gate_annotations was persisted to DB
    expect(dbStore.gate_annotations).toBeDefined();
    const persistedAnnotations = JSON.parse(dbStore.gate_annotations);
    expect(persistedAnnotations["post-spec"]).toBeDefined();
    expect(persistedAnnotations["post-spec"]).toContain("PostgreSQL");

    // Verify execution_profile was persisted
    expect(dbStore.execution_profile).toBeDefined();

    // ─── Step 2: "Resume" orchestrator (new instance) ─────────────────

    const resumeDeps = buildDeps({
      profile: {
        ...buildDeps().profile,
        humanGates: [],
        pipelineMode: "full",
        skipAgentsMdExtraction: true,
        enableReviewGate: false,
      },
    });

    vi.mocked(resumeDeps.llm.call).mockResolvedValue("LLM response");
    vi.mocked(spawnAgent).mockResolvedValue({
      agent: "mock-agent",
      task: "",
      exitCode: 0,
      output: "impl output",
      stderr: "",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 1 },
      model: "test-model",
    });
    vi.mocked(resumeDeps.exec).mockResolvedValue({ stdout: "", stderr: "", code: 0 });

    const resumeOrchestrator = new Orchestrator(resumeDeps);

    // Restore gate annotations from what plan mode persisted (simulating SQLite load)
    resumeOrchestrator.restoreGateAnnotations(dbStore.gate_annotations);

    const task = makeTask({ type: "Implementation" });
    const summary = await resumeOrchestrator.resumeFromPhase3("the spec", [task], 1, 1);

    // Verify annotations survived the cross-instance transfer
    const restoredAnnotations = (resumeOrchestrator as any).getGateAnnotationsForPrompt();
    expect(restoredAnnotations).toContain("## Human Review Notes");
    expect(restoredAnnotations).toContain("post-spec");
    expect(restoredAnnotations).toContain("PostgreSQL");

    // Verify Phase 3 and 4 ran to completion
    expect(resumeDeps.state.setPhase).toHaveBeenCalledWith("phase3");
    expect(resumeDeps.state.setPhase).toHaveBeenCalledWith("phase4");

    // Verify sprint_end event was emitted by the resume orchestrator
    const sprintEndEvents = getEmittedEvents(resumeDeps).filter((ev) => ev.type === "sprint_end");
    expect(sprintEndEvents).toHaveLength(1);
  });
});
