/**
 * TASK-007: Integration tests — phase wiring (phase1, phase2, fast-path gates)
 *
 * These tests verify the wiring between pipeline phases and human gates:
 *   1. phase1() post-spec gate produces revised spec that flows to state + SQLite
 *   2. phase2() post-tasks gate re-parses revised tasks and persists them
 *   3. fastPath() post-review gate fires before state.complete()
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Orchestrator, type OrchestratorDeps } from "../.pi/extensions/mls/orchestrator/index.js";
import type { AgentResult, TaskState, MlsEvent } from "../.pi/extensions/mls/types.js";

// ─── Mock spawnAgent globally ────────────────────────────────────────────────

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

// ─── Test 1: phase1() post-spec gate wiring ─────────────────────────────────

describe("phase1() — post-spec gate wiring: revised spec flows to state + SQLite", () => {
  it("replaces original spec with gate-revised artifact in both state and SQLite", async () => {
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

    // LLM calls: 1) gate analysis, 2) gate reconciliation (revised spec)
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

    // Return value should be the revised spec
    expect(spec).toContain("Revised spec WITH error handling");

    // StateManager receives the revised spec (not the original)
    expect(deps.state.setSpecification).toHaveBeenCalledWith(
      expect.stringContaining("Revised spec WITH error handling"),
    );

    // SQLite receives the revised spec
    expect(deps.db.updateSprint).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        specification: expect.stringContaining("Revised spec WITH error handling"),
      }),
    );

    // Gate annotation is stored and available for Phase 2
    const annotations = (orchestrator as any).getGateAnnotationsForPrompt();
    expect(annotations).toContain("post-spec");
  });
});

// ─── Test 2: phase2() post-tasks gate wiring ────────────────────────────────

describe("phase2() — post-tasks gate wiring: revised tasks re-parsed and persisted", () => {
  it("re-parses revised task output and persists new tasks to SQLite", async () => {
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

    // LLM calls for gate analysis / reconciliation / task parsing
    vi.mocked(deps.llm.call).mockImplementation((system: string) => {
      // Task parsing calls (parseTasks uses LLM)
      if (system.includes?.("Parse") || system.includes?.("parse") || system.includes?.("JSON")) {
        return Promise.resolve(
          '{"label":"TASK-001","title":"Implement feature","type":"Implementation","dependencies":[],"parallelWith":[],"acceptanceCriteria":["test"],"filesAffected":["src/index.ts"]}',
        );
      }
      // Gate reconciliation: return revised task list
      if (system.includes?.("user provided feedback")) {
        return Promise.resolve(
          '{"label":"TASK-001","title":"Implement feature","type":"Implementation","dependencies":[],"parallelWith":[],"acceptanceCriteria":["test"],"filesAffected":["src/index.ts"]}\n' +
          '{"label":"TASK-002","title":"Add tests","type":"Testing","dependencies":[],"parallelWith":[],"acceptanceCriteria":["pass"],"filesAffected":["tests/"]}',
        );
      }
      return Promise.resolve("Analysis: task breakdown looks reasonable");
    });

    const { spawnAgent } = await import("../.pi/extensions/mls/agents.js");
    vi.mocked(spawnAgent).mockResolvedValue({
      agent: "mls-scrum-master",
      task: "",
      exitCode: 0,
      output: "TASK-001: Implement feature [Implementation]",
      stderr: "",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 1 },
      model: "test-model",
    });

    const orchestrator = new Orchestrator(deps);
    (orchestrator as any).sprintId = 1;
    (orchestrator as any).projectId = 1;

    await (orchestrator as any).phase2("the spec");

    // Tasks should be set in state (called at least once for initial, then again for revision)
    expect(deps.state.setTasks).toHaveBeenCalled();

    // createIssue should be called for persisting tasks to SQLite
    expect(deps.db.createIssue).toHaveBeenCalled();

    // Gate annotations should be persisted to SQLite for resume support
    const updateCalls = vi.mocked(deps.db.updateSprint).mock.calls;
    const gateAnnotationCall = updateCalls.find(
      ([, data]) => data && typeof data === "object" && "gate_annotations" in (data as any),
    );
    expect(gateAnnotationCall).toBeDefined();
  });
});

// ─── Test 3: fast-path post-review gate fires before state.complete() ───────

describe("fastPath() — post-review gate fires before state.complete()", () => {
  it("emits post-review human_gate events and calls promptUser before state.complete()", async () => {
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

    // Track when complete() is called relative to promptUser
    vi.mocked(deps.state.complete).mockImplementation(() => {
      callOrder.push("complete");
    });

    // LLM for review classification + gate analysis
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

    // promptUser (gate interaction) must occur BEFORE state.complete()
    const promptIdx = callOrder.indexOf("promptUser");
    const completeIdx = callOrder.indexOf("complete");
    expect(promptIdx).toBeGreaterThan(-1);
    expect(completeIdx).toBeGreaterThan(-1);
    expect(promptIdx).toBeLessThan(completeIdx);
  });
});
