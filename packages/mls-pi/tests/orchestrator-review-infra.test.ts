import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Orchestrator, type OrchestratorDeps } from "../.pi/extensions/mls/orchestrator/index.js";
import type { AgentResult, TaskState } from "../.pi/extensions/mls/types.js";

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

function makeTask(overrides: Partial<TaskState> = {}): TaskState {
  return {
    id: "task-uuid-001",
    label: "TASK-001",
    title: "task title",
    type: "Implementation",
    status: "pending",
    dependencies: [],
    parallelWith: [],
    acceptanceCriteria: ["criterion"],
    filesAffected: [],
    assignedAgent: "mls-impl-engineer",
    iterationCount: 0,
    ...overrides,
  };
}

function buildDeps(overrides: Partial<OrchestratorDeps> = {}): OrchestratorDeps {
  const tasks: TaskState[] = [];
  const state = {
    setPhase: vi.fn(),
    getPhase: vi.fn().mockReturnValue("idle"),
    getState: vi.fn().mockReturnValue({ phase: "idle", tasks, input: "", maxReviewIterations: 2, maxTestRetries: 2, startedAt: new Date().toISOString() }),
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
    llm: { call: vi.fn().mockResolvedValue("APPROVED") } as unknown as OrchestratorDeps["llm"],
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

// ─── reviewApproved() ────────────────────────────────────────────────────────

describe("Orchestrator.reviewApproved()", () => {
  it("returns true immediately when enableReviewGate = false (no LLM call)", async () => {
    const deps = buildDeps();
    const orchestrator = new Orchestrator(deps);
    const result = await (orchestrator as any).reviewApproved("any review text");
    expect(result).toBe(true);
    expect(deps.llm.call).not.toHaveBeenCalled();
  });

  it("calls LLM and returns true on APPROVED when enableReviewGate = true", async () => {
    const deps = buildDeps({ profile: { name: "t", group1Concurrency: 1, group2Concurrency: 1, maxReviewIterations: 2, maxTestRetries: 2, enablePhase0: false, enableSpecGate: false, enableReviewGate: true, sequentialGroup1: true, skipAgentsMdExtraction: true } });
    vi.mocked(deps.llm.call).mockResolvedValue("APPROVED - looks great");
    const orchestrator = new Orchestrator(deps);
    const result = await (orchestrator as any).reviewApproved("review text");
    expect(result).toBe(true);
  });

  it("calls LLM and returns false on NEEDS_FIXES when enableReviewGate = true", async () => {
    const deps = buildDeps({ profile: { name: "t", group1Concurrency: 1, group2Concurrency: 1, maxReviewIterations: 2, maxTestRetries: 2, enablePhase0: false, enableSpecGate: false, enableReviewGate: true, sequentialGroup1: true, skipAgentsMdExtraction: true } });
    vi.mocked(deps.llm.call).mockResolvedValue("NEEDS_FIXES - missing tests");
    const orchestrator = new Orchestrator(deps);
    const result = await (orchestrator as any).reviewApproved("review text");
    expect(result).toBe(false);
  });
});

// ─── reviewLoop() ────────────────────────────────────────────────────────────

describe("Orchestrator.reviewLoop()", () => {
  it("approves on first iteration when reviewApproved returns true", async () => {
    const deps = buildDeps();
    const orchestrator = new Orchestrator(deps);
    const task = makeTask();
    const result = await (orchestrator as any).reviewLoop("impl output", "spec", "task-uuid-001", task);
    expect(result).toBe("impl output");
    expect(deps.notify).toHaveBeenCalledWith(expect.stringContaining("Approved"), "success");
  });

  it("emits a review event on each iteration", async () => {
    const deps = buildDeps();
    const orchestrator = new Orchestrator(deps);
    await (orchestrator as any).reviewLoop("impl", "spec", "task-id");
    expect(deps.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "review", approved: true }));
  });

  it("marks task complete when approved with a task", async () => {
    const deps = buildDeps();
    const orchestrator = new Orchestrator(deps);
    const task = makeTask({ id: "task-uuid-001" });
    await (orchestrator as any).reviewLoop("impl", "spec", "task-uuid-001", task);
    expect(deps.state.updateTask).toHaveBeenCalledWith("task-uuid-001", expect.objectContaining({ status: "complete" }));
  });

  it("escalates after max iterations when review gate enabled and always NEEDS_FIXES", async () => {
    const deps = buildDeps({
      profile: { name: "t", group1Concurrency: 1, group2Concurrency: 1, maxReviewIterations: 2, maxTestRetries: 2, enablePhase0: false, enableSpecGate: false, enableReviewGate: true, sequentialGroup1: true, skipAgentsMdExtraction: true },
    });
    vi.mocked(deps.llm.call).mockResolvedValue("NEEDS_FIXES");
    vi.mocked(deps.exec).mockResolvedValue({ stdout: "", stderr: "", code: 0 }); // tests pass during fix
    const orchestrator = new Orchestrator(deps);
    const task = makeTask();
    await (orchestrator as any).reviewLoop("impl", "spec", "task-uuid-001", task);
    expect(deps.notify).toHaveBeenCalledWith(expect.stringContaining("Max iterations"), "error");
    expect(deps.state.updateTask).toHaveBeenCalledWith("task-uuid-001", expect.objectContaining({ status: "escalated" }));
  });

  it("escalates emits review event with escalated=true", async () => {
    const deps = buildDeps({
      profile: { name: "t", group1Concurrency: 1, group2Concurrency: 1, maxReviewIterations: 1, maxTestRetries: 2, enablePhase0: false, enableSpecGate: false, enableReviewGate: true, sequentialGroup1: true, skipAgentsMdExtraction: true },
    });
    vi.mocked(deps.llm.call).mockResolvedValue("NEEDS_FIXES");
    vi.mocked(deps.exec).mockResolvedValue({ stdout: "", stderr: "", code: 0 });
    const orchestrator = new Orchestrator(deps);
    await (orchestrator as any).reviewLoop("impl", "spec", "task-uuid-001");
    expect(deps.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "review", escalated: true }));
  });

  it("works without a task (fast-path context)", async () => {
    const deps = buildDeps();
    const orchestrator = new Orchestrator(deps);
    const result = await (orchestrator as any).reviewLoop("impl", "input", "bug-fix");
    expect(result).toBe("impl");
    // No task means no state.updateTask call for status
    expect(deps.state.updateTask).not.toHaveBeenCalledWith("bug-fix", expect.objectContaining({ status: "complete" }));
  });
});

// ─── runReview() ─────────────────────────────────────────────────────────────

describe("Orchestrator.runReview()", () => {
  it("uses task-aware prompt when task provided", async () => {
    const deps = buildDeps();
    const orchestrator = new Orchestrator(deps);
    const task = makeTask();
    await (orchestrator as any).runReview("impl", "spec", task);
    expect(deps.context.buildReviewPrompt).toHaveBeenCalledWith("impl", task, "spec");
  });

  it("uses simple prompt when no task", async () => {
    const deps = buildDeps();
    const orchestrator = new Orchestrator(deps);
    await (orchestrator as any).runReview("impl", "spec");
    expect(deps.context.buildReviewPromptSimple).toHaveBeenCalledWith("impl", "spec");
  });

  it("appends deletion warning to prompt when tier is large", async () => {
    const deps = buildDeps();
    vi.mocked(deps.context.buildReviewPromptSimple).mockReturnValue("base prompt");
    const orchestrator = new Orchestrator(deps);
    const deletionCheck = { tier: "large" as const, filesDeleted: ["a.ts"], linesRemoved: 200, linesAdded: 5, warning: "Large deletion detected" };
    const { spawnAgent } = await import("../.pi/extensions/mls/agents.js");
    vi.mocked(spawnAgent).mockClear();
    await (orchestrator as any).runReview("impl", "spec", undefined, deletionCheck);
    const calledTask = vi.mocked(spawnAgent).mock.calls[0]?.[1];
    expect(calledTask).toContain("Large deletion detected");
  });
});

// ─── createCheckpoint() ──────────────────────────────────────────────────────

describe("Orchestrator.createCheckpoint()", () => {
  it("returns null when working tree is clean", async () => {
    const deps = buildDeps();
    vi.mocked(deps.exec).mockResolvedValue({ stdout: "", stderr: "", code: 0 });
    const orchestrator = new Orchestrator(deps);
    const result = await (orchestrator as any).createCheckpoint("task-uuid-001");
    expect(result).toBeNull();
  });

  it("creates a stash and pops it when working tree is dirty", async () => {
    const deps = buildDeps();
    vi.mocked(deps.exec)
      .mockResolvedValueOnce({ stdout: " M src/file.ts\n", stderr: "", code: 0 })  // git status
      .mockResolvedValueOnce({ stdout: "Saved working directory", stderr: "", code: 0 })  // git stash push
      .mockResolvedValueOnce({ stdout: "Dropped stash@{0}", stderr: "", code: 0 });  // git stash pop
    const orchestrator = new Orchestrator(deps);
    const result = await (orchestrator as any).createCheckpoint("task-uuid-001");
    expect(result).toContain("mls-checkpoint-task-uuid-001");
    expect(deps.exec).toHaveBeenCalledWith("git", expect.arrayContaining(["stash", "push"]));
    expect(deps.exec).toHaveBeenCalledWith("git", ["stash", "pop"]);
  });

  it("emits checkpoint event when checkpoint succeeds", async () => {
    const deps = buildDeps();
    vi.mocked(deps.exec)
      .mockResolvedValueOnce({ stdout: " M file.ts\n", stderr: "", code: 0 })
      .mockResolvedValueOnce({ stdout: "Saved", stderr: "", code: 0 })
      .mockResolvedValueOnce({ stdout: "Dropped", stderr: "", code: 0 });
    const orchestrator = new Orchestrator(deps);
    await (orchestrator as any).createCheckpoint("task-uuid-001");
    expect(deps.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "checkpoint", taskId: "task-uuid-001" }));
  });

  it("returns null and warns when stash push fails", async () => {
    const deps = buildDeps();
    vi.mocked(deps.exec)
      .mockResolvedValueOnce({ stdout: " M file.ts\n", stderr: "", code: 0 })
      .mockResolvedValueOnce({ stdout: "", stderr: "stash failed", code: 1 });
    const orchestrator = new Orchestrator(deps);
    const result = await (orchestrator as any).createCheckpoint("task-uuid-001");
    expect(result).toBeNull();
    expect(deps.notify).toHaveBeenCalledWith(expect.stringContaining("Checkpoint failed"), "warning");
  });
});

// ─── checkDeletions() ────────────────────────────────────────────────────────

describe("Orchestrator.checkDeletions()", () => {
  it("calls gates.checkDeletions with git diff --stat output", async () => {
    const deps = buildDeps();
    vi.mocked(deps.exec).mockResolvedValue({ stdout: " 1 file changed, 2 insertions(+), 100 deletions(-)", stderr: "", code: 0 });
    vi.mocked(deps.gates.checkDeletions).mockReturnValue({ tier: "normal", filesDeleted: [], linesRemoved: 100, linesAdded: 2 });
    const orchestrator = new Orchestrator(deps);
    await (orchestrator as any).checkDeletions("task-uuid-001");
    expect(deps.gates.checkDeletions).toHaveBeenCalledWith(expect.any(String));
  });

  it("emits deletion_check event with tier and counts", async () => {
    const deps = buildDeps();
    vi.mocked(deps.exec).mockResolvedValue({ stdout: "diff stat", stderr: "", code: 0 });
    vi.mocked(deps.gates.checkDeletions).mockReturnValue({ tier: "large", filesDeleted: ["old.ts"], linesRemoved: 500, linesAdded: 10, warning: "Large deletion" });
    const orchestrator = new Orchestrator(deps);
    await (orchestrator as any).checkDeletions("task-uuid-001");
    expect(deps.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "deletion_check", tier: "large", taskId: "task-uuid-001" }));
  });

  it("notifies with warning when tier has a warning message", async () => {
    const deps = buildDeps();
    vi.mocked(deps.exec).mockResolvedValue({ stdout: "", stderr: "", code: 0 });
    vi.mocked(deps.gates.checkDeletions).mockReturnValue({ tier: "large", filesDeleted: [], linesRemoved: 400, linesAdded: 0, warning: "Significant deletion detected" });
    const orchestrator = new Orchestrator(deps);
    await (orchestrator as any).checkDeletions("task-uuid-001");
    expect(deps.notify).toHaveBeenCalledWith("Significant deletion detected", "warning");
  });

  it("does not notify when tier has no warning", async () => {
    const deps = buildDeps();
    vi.mocked(deps.exec).mockResolvedValue({ stdout: "", stderr: "", code: 0 });
    vi.mocked(deps.gates.checkDeletions).mockReturnValue({ tier: "normal", filesDeleted: [], linesRemoved: 5, linesAdded: 10 });
    const orchestrator = new Orchestrator(deps);
    await (orchestrator as any).checkDeletions("task-uuid-001");
    expect(deps.notify).not.toHaveBeenCalled();
  });
});

// ─── ensureTestsPass() ───────────────────────────────────────────────────────

describe("Orchestrator.ensureTestsPass()", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mls-etp-"));
    // Create package.json with test script so runTests() calls exec instead of returning early
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns impl immediately when tests pass on first run", async () => {
    const deps = buildDeps({ cwd: tmpDir });
    vi.mocked(deps.exec).mockResolvedValue({ stdout: "Tests passed", stderr: "", code: 0 });
    const orchestrator = new Orchestrator(deps);
    const result = await (orchestrator as any).ensureTestsPass("impl output", "build a feature");
    expect(result).toBe("impl output");
  });

  it("spawns impl-engineer fix and returns fixed impl when second run passes", async () => {
    const deps = buildDeps({ cwd: tmpDir });
    vi.mocked(deps.exec)
      .mockResolvedValueOnce({ stdout: "Tests failed", stderr: "", code: 1 })  // exec_start/end for first run
      .mockResolvedValueOnce({ stdout: "Tests failed", stderr: "", code: 1 })  // exec for the actual test cmd
      .mockResolvedValueOnce({ stdout: "ok", stderr: "", code: 0 })            // exec_start/end retest
      .mockResolvedValueOnce({ stdout: "ok", stderr: "", code: 0 });           // exec retest
    const orchestrator = new Orchestrator(deps);
    const result = await (orchestrator as any).ensureTestsPass("original impl", "description");
    // When second run passes, returns the fixed impl (from spawn mock: "mock agent output")
    expect(result).toBe("mock agent output");
  });

  it("throws when tests still fail after all attempts and testsPass returns false", async () => {
    const deps = buildDeps({ cwd: tmpDir });
    vi.mocked(deps.exec).mockResolvedValue({ stdout: "Tests failed", stderr: "", code: 1 });
    vi.mocked(deps.gates.testsPass).mockReturnValue(false);
    const orchestrator = new Orchestrator(deps);
    await expect((orchestrator as any).ensureTestsPass("impl", "desc")).rejects.toThrow("Tests still failing after retry");
  });
});

// ─── ensureTestsPassForTask() ────────────────────────────────────────────────

describe("Orchestrator.ensureTestsPassForTask()", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mls-etpt-"));
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns impl immediately when tests pass", async () => {
    const deps = buildDeps({ cwd: tmpDir });
    vi.mocked(deps.exec).mockResolvedValue({ stdout: "ok", stderr: "", code: 0 });
    const orchestrator = new Orchestrator(deps);
    const task = makeTask();
    const result = await (orchestrator as any).ensureTestsPassForTask("impl", task);
    expect(result).toBe("impl");
  });

  it("notifies on each test failure attempt", async () => {
    const deps = buildDeps({ cwd: tmpDir });
    // First test run fails, then passes after fix
    vi.mocked(deps.exec)
      .mockResolvedValueOnce({ stdout: "fail", stderr: "", code: 1 })
      .mockResolvedValueOnce({ stdout: "ok", stderr: "", code: 0 });
    const orchestrator = new Orchestrator(deps);
    const task = makeTask();
    await (orchestrator as any).ensureTestsPassForTask("impl", task);
    expect(deps.notify).toHaveBeenCalledWith(expect.stringContaining("Tests failed"), "warning");
  });

  it("escalates task and throws after max retries when testsPass returns false", async () => {
    const deps = buildDeps({ cwd: tmpDir });
    vi.mocked(deps.exec).mockResolvedValue({ stdout: "fail", stderr: "", code: 1 });
    vi.mocked(deps.gates.testsPass).mockReturnValue(false);
    const orchestrator = new Orchestrator(deps);
    const task = makeTask({ id: "uuid-1", label: "TASK-001" });
    await expect((orchestrator as any).ensureTestsPassForTask("impl", task)).rejects.toThrow("Tests failing after");
    expect(deps.state.updateTask).toHaveBeenCalledWith("uuid-1", expect.objectContaining({ status: "escalated" }));
  });
});

// ─── getTaskContext() / getDependentDesignOutput() ───────────────────────────

describe("Orchestrator private task context helpers", () => {
  it("getTaskContext returns title + acceptance criteria", () => {
    const deps = buildDeps();
    const orchestrator = new Orchestrator(deps);
    const task = makeTask({ title: "Build auth", acceptanceCriteria: ["Users can log in", "Sessions expire"] });
    const result = (orchestrator as any).getTaskContext(task);
    expect(result).toContain("Build auth");
    expect(result).toContain("Users can log in");
    expect(result).toContain("Sessions expire");
  });

  it("getDependentDesignOutput returns designOutput from matching design task", () => {
    const deps = buildDeps();
    const orchestrator = new Orchestrator(deps);
    const designTask = makeTask({ id: "design-uuid", type: "Design", designOutput: "Design decisions here" } as any);
    const implTask = makeTask({ dependencies: ["design-uuid"] });
    vi.mocked(deps.state.getTasksByType).mockReturnValue([designTask]);
    const result = (orchestrator as any).getDependentDesignOutput(implTask);
    expect(result).toBe("Design decisions here");
  });

  it("getDependentDesignOutput returns undefined when no matching design task", () => {
    const deps = buildDeps();
    vi.mocked(deps.state.getTasksByType).mockReturnValue([]);
    const orchestrator = new Orchestrator(deps);
    const task = makeTask({ dependencies: [] });
    const result = (orchestrator as any).getDependentDesignOutput(task);
    expect(result).toBeUndefined();
  });
});

// ─── syncTaskOutput() ────────────────────────────────────────────────────────

describe("Orchestrator.syncTaskOutput()", () => {
  it("calls updateTask when task is provided", () => {
    const deps = buildDeps();
    const orchestrator = new Orchestrator(deps);
    const task = makeTask({ id: "uuid-1" });
    (orchestrator as any).syncTaskOutput("uuid-1", task, "new output");
    expect(deps.state.updateTask).toHaveBeenCalledWith("uuid-1", { output: "new output" });
  });

  it("does nothing when task is undefined", () => {
    const deps = buildDeps();
    const orchestrator = new Orchestrator(deps);
    (orchestrator as any).syncTaskOutput("uuid-1", undefined, "output");
    expect(deps.state.updateTask).not.toHaveBeenCalled();
  });
});

// ─── executeGroup1() ─────────────────────────────────────────────────────────

describe("Orchestrator.executeGroup1()", () => {
  it("no-ops when no group1 tasks", async () => {
    const deps = buildDeps();
    const orchestrator = new Orchestrator(deps);
    const { spawnAgent } = await import("../.pi/extensions/mls/agents.js");
    vi.mocked(spawnAgent).mockClear();
    const implTask = makeTask({ type: "Implementation" });
    await (orchestrator as any).executeGroup1([implTask], "spec");
    expect(vi.mocked(spawnAgent)).not.toHaveBeenCalled();
  });

  it("spawns designer for Design tasks", async () => {
    const deps = buildDeps();
    const orchestrator = new Orchestrator(deps);
    const { spawnAgent } = await import("../.pi/extensions/mls/agents.js");
    vi.mocked(spawnAgent).mockClear();
    const designTask = makeTask({ type: "Design" });
    await (orchestrator as any).executeGroup1([designTask], "spec");
    const agentNames = vi.mocked(spawnAgent).mock.calls.map(([agent]) => agent.name);
    expect(agentNames).toContain("mls-designer");
  });

  it("marks design task complete when agent exits 0", async () => {
    const deps = buildDeps();
    const orchestrator = new Orchestrator(deps);
    const task = makeTask({ id: "uuid-design", type: "Design" });
    await (orchestrator as any).executeGroup1([task], "spec");
    expect(deps.state.updateTask).toHaveBeenCalledWith("uuid-design", expect.objectContaining({ status: "complete" }));
  });
});
