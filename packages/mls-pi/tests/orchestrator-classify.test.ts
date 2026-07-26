import { describe, it, expect, vi, beforeEach } from "vitest";
import { Orchestrator, type OrchestratorDeps } from "../.pi/extensions/mls/orchestrator/index.js";
import type { AgentResult } from "../.pi/extensions/mls/types.js";

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

function makeAgent(name: string) {
  return { name, description: "", systemPrompt: "", filePath: `/agents/${name}.md` };
}

function buildDeps(overrides: Partial<OrchestratorDeps> = {}): OrchestratorDeps {
  const tasks: any[] = [];
  const state = {
    setPhase: vi.fn(),
    getPhase: vi.fn().mockReturnValue("idle"),
    getState: vi.fn().mockReturnValue({ phase: "idle", tasks, input: "", maxReviewIterations: 3, maxTestRetries: 3, startedAt: new Date().toISOString() }),
    setTasks: vi.fn(),
    getTask: vi.fn().mockImplementation((id: string) => ({ status: "complete", label: id, title: "t", id })),
    getTasksByStatus: vi.fn().mockReturnValue([]),
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
    skills: { getOrchestratorSkill: vi.fn().mockReturnValue(""), getSkillsForAgent: vi.fn().mockReturnValue(""), getAgentSkills: vi.fn().mockReturnValue(""), load: vi.fn() } as unknown as OrchestratorDeps["skills"],
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
      buildTestPromptSimple: vi.fn().mockReturnValue(""),
      buildTestPrompt: vi.fn().mockReturnValue(""),
    } as unknown as OrchestratorDeps["context"],
    gates: {
      taskBreakdownValid: vi.fn().mockReturnValue({ passed: true, issues: [] }),
      checkDeletions: vi.fn().mockReturnValue({ tier: "normal", filesDeleted: [], linesRemoved: 0, linesAdded: 0 }),
      testsPass: vi.fn().mockReturnValue(true),
    } as unknown as OrchestratorDeps["gates"],
    llm: { call: vi.fn().mockResolvedValue("TYPE: feature\nREASON: default") } as unknown as OrchestratorDeps["llm"],
    db: {
      getOrCreateProject: vi.fn().mockReturnValue({ id: 1 }),
      createSprint: vi.fn().mockReturnValue({ id: 1 }),
      updateSprint: vi.fn(),
      createIssue: vi.fn().mockReturnValue({ id: 1 }),
      updateIssue: vi.fn(),
      getOrCreateLabel: vi.fn().mockReturnValue({ id: 1 }),
      addLabelToIssue: vi.fn(),
    } as unknown as OrchestratorDeps["db"],
    agents: [
      makeAgent("mls-impl-engineer"),
      makeAgent("mls-spec-writer"),
      makeAgent("mls-scrum-master"),
      makeAgent("mls-code-reviewer"),
      makeAgent("mls-test-runner"),
      makeAgent("mls-designer"),
      makeAgent("mls-infra-engineer"),
    ],
    profile: {
      name: "test",
      group1Concurrency: 1,
      group2Concurrency: 1,
      maxReviewIterations: 2,
      maxTestRetries: 2,
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

// ─── classify() ──────────────────────────────────────────────────────────────

describe("Orchestrator.classify()", () => {
  let deps: OrchestratorDeps;
  let orchestrator: Orchestrator;

  beforeEach(() => {
    deps = buildDeps();
    orchestrator = new Orchestrator(deps);
  });

  it.each([
    ["bug", "bug"],
    ["implementation-spec", "implementation-spec"],
    ["requirements", "requirements"],
    ["plan", "plan"],
    ["epic", "epic"],
    ["feature", "feature"],
  ])("parses TYPE: %s correctly", async (llmType, expected) => {
    vi.mocked(deps.llm.call).mockResolvedValue(`TYPE: ${llmType}\nREASON: because`);
    const result = await (orchestrator as any).classify("some input");
    expect(result.type).toBe(expected);
  });

  it("falls back to 'feature' when TYPE is unrecognized", async () => {
    vi.mocked(deps.llm.call).mockResolvedValue("TYPE: something-weird\nREASON: dunno");
    const result = await (orchestrator as any).classify("input");
    expect(result.type).toBe("feature");
  });

  it("falls back to 'feature' when TYPE is absent", async () => {
    vi.mocked(deps.llm.call).mockResolvedValue("No type here at all");
    const result = await (orchestrator as any).classify("input");
    expect(result.type).toBe("feature");
  });

  it("extracts REASON correctly", async () => {
    vi.mocked(deps.llm.call).mockResolvedValue("TYPE: bug\nREASON: It has a stack trace and error message.");
    const result = await (orchestrator as any).classify("input");
    expect(result.reason).toBe("It has a stack trace and error message.");
  });

  it("returns empty reason when REASON is absent", async () => {
    vi.mocked(deps.llm.call).mockResolvedValue("TYPE: feature");
    const result = await (orchestrator as any).classify("input");
    expect(result.reason).toBe("");
  });

  it("is case-insensitive for TYPE value", async () => {
    vi.mocked(deps.llm.call).mockResolvedValue("TYPE: BUG\nREASON: uppercase");
    const result = await (orchestrator as any).classify("input");
    expect(result.type).toBe("bug");
  });
});

// ─── run() routing ────────────────────────────────────────────────────────────

describe("Orchestrator.run() PRD shortcut", () => {
  it("skips classification and calls fullPipeline when opts.isPrd = true", async () => {
    const deps = buildDeps();
    const orchestrator = new Orchestrator(deps);

    // parseTasks needs an LLM response with JSON tasks
    vi.mocked(deps.llm.call)
      .mockResolvedValueOnce('{"label":"TASK-001","title":"Do thing","type":"Implementation"}') // parseTasks
      .mockResolvedValue("Sprint complete");  // phase4

    await orchestrator.run("PRD content here", { isPrd: true });

    expect(deps.state.setClassification).toHaveBeenCalledWith("requirements");
    expect(deps.db.updateSprint).toHaveBeenCalledWith(1, expect.objectContaining({ classification: "requirements" }));
    expect(deps.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "sprint_start", classification: "requirements" }));
    expect(deps.sendMessage).toHaveBeenCalledWith(expect.stringContaining("skipping classification"));
  });

  it("uses PRD content directly as spec (skips spec-writer agent)", async () => {
    const deps = buildDeps();
    const orchestrator = new Orchestrator(deps);
    vi.mocked(deps.llm.call)
      .mockResolvedValueOnce('{"label":"TASK-001","title":"T","type":"Implementation"}')
      .mockResolvedValue("done");

    await orchestrator.run("My PRD text", { isPrd: true });

    // spec-writer should NOT have been called
    const { spawnAgent } = await import("../.pi/extensions/mls/agents.js");
    const agentCalls = vi.mocked(spawnAgent).mock.calls.map(([agent]) => agent.name);
    expect(agentCalls).not.toContain("mls-spec-writer");
  });
});

describe("Orchestrator.run() classification routing", () => {
  it("routes 'bug' to fastPath", async () => {
    const deps = buildDeps();
    vi.mocked(deps.llm.call).mockResolvedValue("TYPE: bug\nREASON: has a trace");
    const orchestrator = new Orchestrator(deps);
    (orchestrator as any).fastPath = vi.fn().mockResolvedValue("Bug fix complete.");
    const result = await orchestrator.run("some bug");
    expect((orchestrator as any).fastPath).toHaveBeenCalledWith("some bug");
    expect(result).toBe("Bug fix complete.");
  });

  it("routes 'implementation-spec' to implFastPath", async () => {
    const deps = buildDeps();
    vi.mocked(deps.llm.call).mockResolvedValue("TYPE: implementation-spec\nREASON: has file paths");
    const orchestrator = new Orchestrator(deps);
    (orchestrator as any).implFastPath = vi.fn().mockResolvedValue("Implementation complete.");
    await orchestrator.run("spec input");
    expect((orchestrator as any).implFastPath).toHaveBeenCalledWith("spec input");
  });

  it.each(["requirements", "plan", "epic", "feature"] as const)("routes '%s' to fullPipeline", async (type) => {
    const deps = buildDeps();
    vi.mocked(deps.llm.call).mockResolvedValue(`TYPE: ${type}\nREASON: reason`);
    const orchestrator = new Orchestrator(deps);
    (orchestrator as any).fullPipeline = vi.fn().mockResolvedValue("done");
    await orchestrator.run("input");
    expect((orchestrator as any).fullPipeline).toHaveBeenCalled();
  });

  it("sets classification in state and db before routing", async () => {
    const deps = buildDeps();
    vi.mocked(deps.llm.call).mockResolvedValue("TYPE: feature\nREASON: a feature");
    const orchestrator = new Orchestrator(deps);
    (orchestrator as any).fullPipeline = vi.fn().mockResolvedValue("done");
    await orchestrator.run("input");
    expect(deps.state.setClassification).toHaveBeenCalledWith("feature");
    expect(deps.db.updateSprint).toHaveBeenCalledWith(1, expect.objectContaining({ classification: "feature" }));
  });

  it("emits sprint_start with classification and truncated input", async () => {
    const deps = buildDeps();
    vi.mocked(deps.llm.call).mockResolvedValue("TYPE: feature\nREASON: a feature");
    const orchestrator = new Orchestrator(deps);
    (orchestrator as any).fullPipeline = vi.fn().mockResolvedValue("done");
    const longInput = "x".repeat(300);
    await orchestrator.run(longInput);
    expect(deps.emit).toHaveBeenCalledWith(expect.objectContaining({
      type: "sprint_start",
      input: longInput.slice(0, 200),
      classification: "feature",
    }));
  });
});

// ─── phase0() ────────────────────────────────────────────────────────────────

describe("Orchestrator.phase0()", () => {
  let deps: OrchestratorDeps;
  let orchestrator: Orchestrator;

  beforeEach(() => {
    deps = buildDeps();
    orchestrator = new Orchestrator(deps);
  });

  it("sets phase to 'phase0'", async () => {
    vi.mocked(deps.llm.call).mockResolvedValue("READY TO PROCEED. Everything is clear.");
    await (orchestrator as any).phase0("input");
    expect(deps.state.setPhase).toHaveBeenCalledWith("phase0");
    expect(deps.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "phase", phase: "phase0" }));
  });

  it("does not send refinement message when LLM says READY TO PROCEED", async () => {
    vi.mocked(deps.llm.call).mockResolvedValue("READY TO PROCEED. Very clear.");
    await (orchestrator as any).phase0("clear input");
    const msgCalls = vi.mocked(deps.sendMessage).mock.calls.map(([m]) => m);
    expect(msgCalls).not.toContain(expect.stringContaining("Needs refinement"));
  });

  it("sends refinement message when LLM lists clarifying questions", async () => {
    vi.mocked(deps.llm.call).mockResolvedValue("Here are 3 questions:\n1. What?\n2. Why?\n3. How?");
    await (orchestrator as any).phase0("vague input");
    expect(deps.sendMessage).toHaveBeenCalledWith(expect.stringContaining("Needs refinement"));
  });
});

// ─── private llm() wrapper ───────────────────────────────────────────────────

describe("Orchestrator private llm()", () => {
  it("throws when llm.call returns empty string", async () => {
    const deps = buildDeps();
    vi.mocked(deps.llm.call).mockResolvedValue("");
    const orchestrator = new Orchestrator(deps);
    await expect((orchestrator as any).llm("system", "user")).rejects.toThrow("LLM returned empty response");
  });

  it("emits llm_start and llm_end events", async () => {
    const deps = buildDeps();
    vi.mocked(deps.llm.call).mockResolvedValue("response text");
    const orchestrator = new Orchestrator(deps);
    await (orchestrator as any).llm("my system prompt", "user input");
    expect(deps.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "llm_start" }));
    expect(deps.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "llm_end", response: "response text" }));
  });

  it("returns the LLM response text", async () => {
    const deps = buildDeps();
    vi.mocked(deps.llm.call).mockResolvedValue("  answer  ");
    const orchestrator = new Orchestrator(deps);
    const result = await (orchestrator as any).llm("sys", "usr");
    expect(result).toBe("  answer  ");
  });
});

// ─── private exec() / execQuiet() ───────────────────────────────────────────

describe("Orchestrator private exec()", () => {
  it("emits exec_start and exec_end", async () => {
    const deps = buildDeps();
    vi.mocked(deps.exec).mockResolvedValue({ stdout: "out", stderr: "", code: 0 });
    const orchestrator = new Orchestrator(deps);
    await (orchestrator as any).exec("git", ["status"]);
    expect(deps.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "exec_start", command: "git", args: ["status"] }));
    expect(deps.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "exec_end", command: "git", code: 0 }));
  });

  it("execQuiet does not emit events", async () => {
    const deps = buildDeps();
    vi.mocked(deps.exec).mockResolvedValue({ stdout: "out", stderr: "", code: 0 });
    const orchestrator = new Orchestrator(deps);
    const emitSpy = vi.mocked(deps.emit);
    emitSpy.mockClear();
    await (orchestrator as any).execQuiet("git", ["log"]);
    expect(emitSpy).not.toHaveBeenCalled();
  });
});

// ─── private setPhase() / emitGate() ─────────────────────────────────────────

describe("Orchestrator private setPhase()", () => {
  it("calls state.setPhase and emits phase event", () => {
    const deps = buildDeps();
    const orchestrator = new Orchestrator(deps);
    (orchestrator as any).setPhase("phase1");
    expect(deps.state.setPhase).toHaveBeenCalledWith("phase1");
    expect(deps.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "phase", phase: "phase1" }));
  });
});

describe("Orchestrator private emitGate()", () => {
  it("emits gate event with passed=true and no issues", () => {
    const deps = buildDeps();
    const orchestrator = new Orchestrator(deps);
    (orchestrator as any).emitGate("spec-completeness", true);
    expect(deps.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "gate", name: "spec-completeness", passed: true, issues: [] }));
  });

  it("emits gate event with passed=false and issues list", () => {
    const deps = buildDeps();
    const orchestrator = new Orchestrator(deps);
    (orchestrator as any).emitGate("task-breakdown", false, ["missing tests"]);
    expect(deps.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "gate", passed: false, issues: ["missing tests"] }));
  });
});

// ─── private getAgent() ───────────────────────────────────────────────────────

describe("Orchestrator private getAgent()", () => {
  it("returns the agent config when found", () => {
    const deps = buildDeps();
    const orchestrator = new Orchestrator(deps);
    const agent = (orchestrator as any).getAgent("mls-impl-engineer");
    expect(agent.name).toBe("mls-impl-engineer");
  });

  it("throws when agent is not found", () => {
    const deps = buildDeps({ agents: [] });
    const orchestrator = new Orchestrator(deps);
    expect(() => (orchestrator as any).getAgent("nonexistent-agent")).toThrow('Agent "nonexistent-agent" not found');
  });
});
