import { describe, it, expect, vi, beforeEach } from "vitest";
import { Orchestrator, type OrchestratorDeps } from "../.pi/extensions/mls/orchestrator/index.js";
import type { AgentResult, TaskState } from "../.pi/extensions/mls/types.js";

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
  };
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildDeps(overrides: Partial<OrchestratorDeps> = {}): OrchestratorDeps {
  const tasks: TaskState[] = [];

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
    setTasks: vi.fn(),
    getTask: vi.fn().mockImplementation((id: string) => ({
      status: "complete",
      label: id,
      title: "task title",
      id,
    })),
    getTasksByStatus: vi.fn().mockImplementation((status: string) =>
      tasks.filter((t) => t.status === status),
    ),
    getTasksByType: vi.fn().mockReturnValue([]),
    updateTask: vi.fn(),
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
      buildSpecPrompt: vi.fn().mockReturnValue(""),
      buildTaskBreakdownPrompt: vi.fn().mockReturnValue(""),
      buildBugFixPrompt: vi.fn().mockReturnValue(""),
      buildImplFromSpecPrompt: vi.fn().mockReturnValue(""),
      buildScaffoldPrompt: vi.fn().mockReturnValue(""),
      buildDesignPrompt: vi.fn().mockReturnValue(""),
      buildInfraPrompt: vi.fn().mockReturnValue(""),
      buildDocPrompt: vi.fn().mockReturnValue(""),
      buildTestFromCriteriaPrompt: vi.fn().mockReturnValue(""),
      buildImplFromTestsPrompt: vi.fn().mockReturnValue(""),
      buildReviewPrompt: vi.fn().mockReturnValue(""),
      buildReviewPromptSimple: vi.fn().mockReturnValue(""),
      buildReviewFixPrompt: vi.fn().mockReturnValue(""),
      buildTestFixPrompt: vi.fn().mockReturnValue(""),
      buildTestPrompt: vi.fn().mockReturnValue(""),
      buildTestPromptSimple: vi.fn().mockReturnValue(""),
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

// ─── Gate Cost Tracking ─────────────────────────────────────────────────────

describe("gate cost tracking", () => {
  it("initializes gateCost with llmCalls at zero", () => {
    const deps = buildDeps();
    const orchestrator = new Orchestrator(deps);

    const cost = orchestrator.getGateCost();

    expect(cost).toEqual({ llmCalls: 0 });
  });

  it("increments gateCost.llmCalls for the LLM analysis call in humanGate", async () => {
    const deps = buildDeps({
      profile: {
        ...buildDeps().profile,
        humanGates: ["post-spec"],
      },
      promptUser: vi.fn().mockResolvedValue("approve"),
    });
    vi.mocked(deps.llm.call).mockResolvedValue("Analysis output");
    const orchestrator = new Orchestrator(deps);

    await (orchestrator as any).humanGate("post-spec", "some artifact");

    // One LLM call for analysis
    expect(orchestrator.getGateCost().llmCalls).toBe(1);
  });

  it("increments gateCost.llmCalls for each reconciliation call in humanGate", async () => {
    let promptCount = 0;
    const deps = buildDeps({
      profile: {
        ...buildDeps().profile,
        humanGates: ["post-spec"],
      },
      promptUser: vi.fn().mockImplementation(() => {
        promptCount++;
        if (promptCount <= 2) return Promise.resolve("needs more work");
        return Promise.resolve("approve");
      }),
    });
    vi.mocked(deps.llm.call).mockResolvedValue("LLM output");
    const orchestrator = new Orchestrator(deps);

    await (orchestrator as any).humanGate("post-spec", "artifact");

    // 1 analysis call + 2 reconciliation calls = 3 total
    expect(orchestrator.getGateCost().llmCalls).toBe(3);
  });

  it("returns a copy from getGateCost so external mutation does not affect internal state", () => {
    const deps = buildDeps();
    const orchestrator = new Orchestrator(deps);

    const cost = orchestrator.getGateCost();
    cost.llmCalls = 999;

    expect(orchestrator.getGateCost().llmCalls).toBe(0);
  });
});
