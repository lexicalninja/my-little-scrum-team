import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Orchestrator, type OrchestratorDeps } from "../.pi/extensions/mls/orchestrator/index.js";
import { parseStructuredTasks, parseTaskHeadings, createTaskState } from "../.pi/extensions/mls/orchestrator/task-parser.js";
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
    llm: { call: vi.fn().mockResolvedValue("default llm response") } as unknown as OrchestratorDeps["llm"],
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

// ─── phase1() ────────────────────────────────────────────────────────────────

describe("Orchestrator.phase1()", () => {
  it("sets phase, spawns spec-writer, persists spec, returns spec text", async () => {
    const deps = buildDeps();
    const orchestrator = new Orchestrator(deps);
    const spec = await (orchestrator as any).phase1("user input");
    expect(deps.state.setPhase).toHaveBeenCalledWith("phase1");
    expect(spec).toBe("mock agent output");
    expect(deps.state.setSpecification).toHaveBeenCalledWith("mock agent output");
    expect(deps.db.updateSprint).toHaveBeenCalledWith(0, expect.objectContaining({ specification: "mock agent output" }));
  });

  it("does not call LLM gate when enableSpecGate = false", async () => {
    const deps = buildDeps();
    const orchestrator = new Orchestrator(deps);
    await (orchestrator as any).phase1("input");
    // llm.call should not have been called for spec gate
    expect(deps.llm.call).not.toHaveBeenCalled();
  });

  it("runs spec gate when enableSpecGate = true and emits gate event", async () => {
    const deps = buildDeps({ profile: { name: "t", group1Concurrency: 1, group2Concurrency: 1, maxReviewIterations: 2, maxTestRetries: 2, enablePhase0: false, enableSpecGate: true, enableReviewGate: false, sequentialGroup1: true, skipAgentsMdExtraction: true, humanGates: [], pipelineMode: "full" } });
    vi.mocked(deps.llm.call).mockResolvedValue("PASS - spec looks complete");
    const orchestrator = new Orchestrator(deps);
    await (orchestrator as any).phase1("input");
    expect(deps.llm.call).toHaveBeenCalled();
    expect(deps.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "gate", name: "spec-completeness", passed: true }));
  });

  it("emits gate passed=false and notifies when spec gate returns FAIL", async () => {
    const deps = buildDeps({ profile: { name: "t", group1Concurrency: 1, group2Concurrency: 1, maxReviewIterations: 2, maxTestRetries: 2, enablePhase0: false, enableSpecGate: true, enableReviewGate: false, sequentialGroup1: true, skipAgentsMdExtraction: true, humanGates: [], pipelineMode: "full" } });
    vi.mocked(deps.llm.call).mockResolvedValue("FAIL - missing acceptance criteria");
    const orchestrator = new Orchestrator(deps);
    await (orchestrator as any).phase1("input");
    expect(deps.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "gate", name: "spec-completeness", passed: false }));
    expect(deps.notify).toHaveBeenCalledWith(expect.stringContaining("Spec gate"), "warning");
  });
});

// ─── phase2() ────────────────────────────────────────────────────────────────

describe("Orchestrator.phase2()", () => {
  it("sets phase to phase2, spawns scrum-master, sets tasks in state", async () => {
    const deps = buildDeps();
    vi.mocked(deps.llm.call).mockResolvedValue('{"label":"TASK-001","title":"Do thing","type":"Implementation"}');
    const orchestrator = new Orchestrator(deps);
    const tasks = await (orchestrator as any).phase2("spec text");
    expect(deps.state.setPhase).toHaveBeenCalledWith("phase2");
    expect(deps.state.setTasks).toHaveBeenCalled();
    expect(Array.isArray(tasks)).toBe(true);
    expect(tasks.length).toBeGreaterThan(0);
  });

  it("persists tasks to db as issues with labels", async () => {
    const deps = buildDeps();
    vi.mocked(deps.llm.call).mockResolvedValue('{"label":"TASK-001","title":"Do thing","type":"Design"}');
    const orchestrator = new Orchestrator(deps);
    await (orchestrator as any).phase2("spec");
    expect(deps.db.createIssue).toHaveBeenCalled();
    expect(deps.db.getOrCreateLabel).toHaveBeenCalled();
    expect(deps.db.addLabelToIssue).toHaveBeenCalled();
  });

  it("runs task-breakdown gate and emits gate event", async () => {
    const deps = buildDeps();
    vi.mocked(deps.llm.call).mockResolvedValue('{"label":"TASK-001","title":"T","type":"Implementation"}');
    vi.mocked(deps.gates.taskBreakdownValid).mockReturnValue({ passed: false, issues: ["too few tasks"] });
    const orchestrator = new Orchestrator(deps);
    await (orchestrator as any).phase2("spec");
    expect(deps.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "gate", name: "task-breakdown", passed: false }));
    expect(deps.notify).toHaveBeenCalledWith(expect.stringContaining("Task gate"), "warning");
  });

  it("sends a message with the task count", async () => {
    const deps = buildDeps();
    vi.mocked(deps.llm.call).mockResolvedValue('{"label":"TASK-001","title":"T","type":"Implementation"}\n{"label":"TASK-002","title":"T2","type":"Testing"}');
    const orchestrator = new Orchestrator(deps);
    await (orchestrator as any).phase2("spec");
    expect(deps.sendMessage).toHaveBeenCalledWith(expect.stringContaining("tasks"));
  });
});

// ─── parseStructuredTasks() / parseTaskHeadings() / createTaskState() ────────

describe("Orchestrator task parsing", () => {
  it("parseStructuredTasks extracts valid JSON lines", () => {
    const response = 'preamble\n{"label":"TASK-001","title":"Implement auth","type":"Implementation"}\n{"label":"TASK-002","title":"Write tests","type":"Testing"}\ntrailing';
    const result = parseStructuredTasks(response);
    expect(result).toHaveLength(2);
    expect(result[0].label).toBe("TASK-001");
    expect(result[1].label).toBe("TASK-002");
  });

  it("parseStructuredTasks ignores invalid JSON lines silently", () => {
    const response = '{"label":"TASK-001","title":"Valid"}\nnot json\n{broken}';
    const result = parseStructuredTasks(response);
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("TASK-001");
  });

  it("parseStructuredTasks returns empty array when no JSON lines", () => {
    const result = parseStructuredTasks("plain text output\nno json here");
    expect(result).toHaveLength(0);
  });

  it("parseStructuredTasks uses 'id' field as label fallback", () => {
    const response = '{"id":"TASK-003","title":"Fallback"}';
    const result = parseStructuredTasks(response);
    expect(result[0].label).toBe("TASK-003");
  });

  it("parseStructuredTasks generates auto label when neither label nor id present", () => {
    const response = '{"title":"No label"}';
    const result = parseStructuredTasks(response);
    expect(result[0].label).toMatch(/TASK-\d+/);
  });

  it("parseTaskHeadings extracts ## TASK-NNN: Title headings", () => {
    const output = "## TASK-001: Build login form\n\nSome content.\n\n## TASK-002: Write auth tests\n";
    const result = parseTaskHeadings(output);
    expect(result).toHaveLength(2);
    expect(result[0].label).toBe("TASK-001");
    expect(result[0].parsed.title).toBe("Build login form");
    expect(result[1].label).toBe("TASK-002");
  });

  it("parseTaskHeadings matches ### headings too", () => {
    const output = "### TASK-005: Infra task\n";
    const result = parseTaskHeadings(output);
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("TASK-005");
  });

  it("parseTaskHeadings returns empty array when no headings", () => {
    const result = parseTaskHeadings("no headings here");
    expect(result).toHaveLength(0);
  });

  it("createTaskState maps type to correct agent", () => {
    const labelToId = new Map([["TASK-001", "uuid-1"]]);
    const task = createTaskState(
      { label: "TASK-001", parsed: { title: "Design UI", type: "Design" } },
      labelToId,
    );
    expect(task.assignedAgent).toBe("mls-designer");
    expect(task.type).toBe("Design");
    expect(task.id).toBe("uuid-1");
  });

  it("createTaskState defaults to 'Implementation' type and impl agent", () => {
    const labelToId = new Map([["TASK-001", "uuid-1"]]);
    const task = createTaskState(
      { label: "TASK-001", parsed: { title: "Do something" } },
      labelToId,
    );
    expect(task.type).toBe("Implementation");
    expect(task.assignedAgent).toBe("mls-impl-engineer");
  });

  it("createTaskState resolves label dependencies to UUIDs", () => {
    const labelToId = new Map([["TASK-001", "uuid-1"], ["TASK-002", "uuid-2"]]);
    const task = createTaskState(
      { label: "TASK-002", parsed: { title: "T", dependencies: ["TASK-001"] } },
      labelToId,
    );
    expect(task.dependencies).toEqual(["uuid-1"]);
  });

  it("createTaskState throws when label has no UUID in map", () => {
    const labelToId = new Map<string, string>();
    expect(() => createTaskState(
      { label: "TASK-999", parsed: { title: "T" } },
      labelToId,
    )).toThrow("Missing task ID for TASK-999");
  });
});

// ─── buildSprintContext() ─────────────────────────────────────────────────────

describe("Orchestrator.buildSprintContext()", () => {
  it("skips LLM extraction when skipAgentsMdExtraction = true", async () => {
    const deps = buildDeps();
    const orchestrator = new Orchestrator(deps);
    const tasks = [makeTask()];
    await (orchestrator as any).buildSprintContext("spec text", tasks);
    expect(deps.llm.call).not.toHaveBeenCalled();
  });

  it("returns a string containing task list", async () => {
    const deps = buildDeps();
    const orchestrator = new Orchestrator(deps);
    const tasks = [makeTask({ label: "TASK-001", title: "Build auth" })];
    const result = await (orchestrator as any).buildSprintContext("spec", tasks);
    expect(result).toContain("TASK-001");
    expect(result).toContain("Build auth");
  });

  it("calls LLM to extract stack and conventions when skipAgentsMdExtraction = false", async () => {
    const deps = buildDeps({ profile: { name: "t", group1Concurrency: 1, group2Concurrency: 1, maxReviewIterations: 2, maxTestRetries: 2, enablePhase0: false, enableSpecGate: false, enableReviewGate: false, sequentialGroup1: true, skipAgentsMdExtraction: false } });
    vi.mocked(deps.llm.call).mockResolvedValue("STACK: TypeScript, Node.js\nCONVENTIONS: use const | no var");
    const orchestrator = new Orchestrator(deps);
    const result = await (orchestrator as any).buildSprintContext("spec", [makeTask()]);
    expect(deps.llm.call).toHaveBeenCalled();
    expect(result).toContain("TypeScript, Node.js");
  });

  it("notifies user that sprint context is ready", async () => {
    const deps = buildDeps();
    const orchestrator = new Orchestrator(deps);
    await (orchestrator as any).buildSprintContext("spec", [makeTask()]);
    expect(deps.notify).toHaveBeenCalledWith(expect.stringContaining("Sprint context ready"), "info");
  });
});

// ─── scaffold() ──────────────────────────────────────────────────────────────

describe("Orchestrator.scaffold()", () => {
  it("skips spawning when project already has files (non-empty orientation)", async () => {
    const deps = buildDeps();
    const orchestrator = new Orchestrator(deps);
    // Pre-populate orientation cache with existing files
    (orchestrator as any).orientationCache = "## Project Structure\n```\nsrc/index.ts\n```";
    const { spawnAgent } = await import("../.pi/extensions/mls/agents.js");
    vi.mocked(spawnAgent).mockClear();
    await (orchestrator as any).scaffold("spec text");
    expect(vi.mocked(spawnAgent)).not.toHaveBeenCalled();
  });

  it("spawns mls-impl-engineer when project is empty", async () => {
    const deps = buildDeps();
    // exec returning no files → empty orientation
    vi.mocked(deps.exec).mockResolvedValue({ stdout: "", stderr: "", code: 0 });
    const orchestrator = new Orchestrator(deps);
    (orchestrator as any).orientationCache = "";  // empty = no files
    const { spawnAgent } = await import("../.pi/extensions/mls/agents.js");
    vi.mocked(spawnAgent).mockClear();
    await (orchestrator as any).scaffold("spec text");
    expect(vi.mocked(spawnAgent)).toHaveBeenCalled();
  });

  it("invalidates orientation cache after scaffolding", async () => {
    const deps = buildDeps();
    vi.mocked(deps.exec).mockResolvedValue({ stdout: "", stderr: "", code: 0 });
    const orchestrator = new Orchestrator(deps);
    (orchestrator as any).orientationCache = "";
    await (orchestrator as any).scaffold("spec");
    expect((orchestrator as any).orientationCache).toBeNull();
  });
});

// ─── getProjectOrientation() ──────────────────────────────────────────────────

describe("Orchestrator.getProjectOrientation()", () => {
  it("returns empty string when no matching files found", async () => {
    const deps = buildDeps();
    vi.mocked(deps.exec).mockResolvedValue({ stdout: "", stderr: "", code: 0 });
    const orchestrator = new Orchestrator(deps);
    const result = await (orchestrator as any).getProjectOrientation();
    expect(result).toBe("");
  });

  it("returns formatted project structure when files exist", async () => {
    const deps = buildDeps();
    vi.mocked(deps.exec).mockResolvedValue({ stdout: "./src/index.ts\n./src/utils.ts\n", stderr: "", code: 0 });
    const orchestrator = new Orchestrator(deps);
    const result = await (orchestrator as any).getProjectOrientation();
    expect(result).toContain("## Project Structure");
    expect(result).toContain("src/index.ts");
  });

  it("caches result on second call", async () => {
    const deps = buildDeps();
    vi.mocked(deps.exec).mockResolvedValue({ stdout: "./src/index.ts\n", stderr: "", code: 0 });
    const orchestrator = new Orchestrator(deps);
    await (orchestrator as any).getProjectOrientation();
    await (orchestrator as any).getProjectOrientation();
    expect(deps.exec).toHaveBeenCalledTimes(1);
  });

  it("returns empty string when find exits non-zero", async () => {
    const deps = buildDeps();
    vi.mocked(deps.exec).mockResolvedValue({ stdout: "", stderr: "permission denied", code: 1 });
    const orchestrator = new Orchestrator(deps);
    const result = await (orchestrator as any).getProjectOrientation();
    expect(result).toBe("");
  });
});

// ─── updateTask() ─────────────────────────────────────────────────────────────

describe("Orchestrator private updateTask()", () => {
  it("calls state.updateTask with the update", () => {
    const deps = buildDeps();
    const orchestrator = new Orchestrator(deps);
    (orchestrator as any).updateTask("uuid-1", { status: "in-progress" });
    expect(deps.state.updateTask).toHaveBeenCalledWith("uuid-1", { status: "in-progress" });
  });

  it("emits task event when status is updated", () => {
    const deps = buildDeps();
    vi.mocked(deps.state.getTask).mockReturnValue({ id: "uuid-1", label: "TASK-001", title: "t", status: "in-progress" } as any);
    const orchestrator = new Orchestrator(deps);
    (orchestrator as any).updateTask("uuid-1", { status: "in-progress" });
    expect(deps.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "task", id: "TASK-001", status: "in-progress" }));
  });

  it("does not emit task event when no status in update", () => {
    const deps = buildDeps();
    const orchestrator = new Orchestrator(deps);
    vi.mocked(deps.emit).mockClear();
    (orchestrator as any).updateTask("uuid-1", { output: "some output" });
    expect(deps.emit).not.toHaveBeenCalledWith(expect.objectContaining({ type: "task" }));
  });

  it("calls db.updateIssue when issueId is known", () => {
    const deps = buildDeps();
    const orchestrator = new Orchestrator(deps);
    (orchestrator as any).issueIds.set("uuid-1", 42);
    (orchestrator as any).updateTask("uuid-1", { status: "complete" });
    expect(deps.db.updateIssue).toHaveBeenCalledWith(42, expect.objectContaining({ status: "closed" }));
  });

  it("sets closed_at in db when status is 'complete'", () => {
    const deps = buildDeps();
    const orchestrator = new Orchestrator(deps);
    (orchestrator as any).issueIds.set("uuid-1", 42);
    (orchestrator as any).updateTask("uuid-1", { status: "complete" });
    expect(deps.db.updateIssue).toHaveBeenCalledWith(42, expect.objectContaining({ closed_at: expect.any(String) }));
  });

  it("sets closed_at in db when status is 'escalated'", () => {
    const deps = buildDeps();
    const orchestrator = new Orchestrator(deps);
    (orchestrator as any).issueIds.set("uuid-1", 42);
    (orchestrator as any).updateTask("uuid-1", { status: "escalated" });
    expect(deps.db.updateIssue).toHaveBeenCalledWith(42, expect.objectContaining({ closed_at: expect.any(String) }));
  });

  it("does not call db.updateIssue when issueId is unknown", () => {
    const deps = buildDeps();
    const orchestrator = new Orchestrator(deps);
    (orchestrator as any).updateTask("unknown-uuid", { status: "complete" });
    expect(deps.db.updateIssue).not.toHaveBeenCalled();
  });
});

// ─── runTests() framework detection ──────────────────────────────────────────

describe("Orchestrator.runTests() framework detection", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mls-run-tests-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns code:0 with 'No test framework detected' when no framework found", async () => {
    const deps = buildDeps({ cwd: tmpDir });
    const orchestrator = new Orchestrator(deps);
    const result = await (orchestrator as any).runTests();
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("No test framework detected");
  });

  it("uses npm test when package.json has test script", async () => {
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }));
    const deps = buildDeps({ cwd: tmpDir });
    vi.mocked(deps.exec).mockResolvedValue({ stdout: "Tests pass", stderr: "", code: 0 });
    const orchestrator = new Orchestrator(deps);
    await (orchestrator as any).runTests();
    expect(deps.exec).toHaveBeenCalledWith("npm", ["run", "test"]);
  });

  it("uses pnpm when pnpm-lock.yaml exists", async () => {
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }));
    fs.writeFileSync(path.join(tmpDir, "pnpm-lock.yaml"), "");
    const deps = buildDeps({ cwd: tmpDir });
    vi.mocked(deps.exec).mockResolvedValue({ stdout: "", stderr: "", code: 0 });
    const orchestrator = new Orchestrator(deps);
    await (orchestrator as any).runTests();
    expect(deps.exec).toHaveBeenCalledWith("pnpm", ["test"]);
  });

  it("uses Makefile when package.json absent", async () => {
    fs.writeFileSync(path.join(tmpDir, "Makefile"), "test:\n\techo ok");
    const deps = buildDeps({ cwd: tmpDir });
    vi.mocked(deps.exec).mockResolvedValue({ stdout: "", stderr: "", code: 0 });
    const orchestrator = new Orchestrator(deps);
    await (orchestrator as any).runTests();
    expect(deps.exec).toHaveBeenCalledWith("make", ["test"]);
  });

  it("uses pytest when pyproject.toml exists", async () => {
    fs.writeFileSync(path.join(tmpDir, "pyproject.toml"), "[tool.pytest]");
    const deps = buildDeps({ cwd: tmpDir });
    vi.mocked(deps.exec).mockResolvedValue({ stdout: "", stderr: "", code: 0 });
    const orchestrator = new Orchestrator(deps);
    await (orchestrator as any).runTests();
    expect(deps.exec).toHaveBeenCalledWith("pytest", []);
  });

  it("uses cargo test when Cargo.toml exists", async () => {
    fs.writeFileSync(path.join(tmpDir, "Cargo.toml"), "[package]");
    const deps = buildDeps({ cwd: tmpDir });
    vi.mocked(deps.exec).mockResolvedValue({ stdout: "", stderr: "", code: 0 });
    const orchestrator = new Orchestrator(deps);
    await (orchestrator as any).runTests();
    expect(deps.exec).toHaveBeenCalledWith("cargo", ["test"]);
  });

  it("uses go test when go.mod exists", async () => {
    fs.writeFileSync(path.join(tmpDir, "go.mod"), "module example.com/m");
    const deps = buildDeps({ cwd: tmpDir });
    vi.mocked(deps.exec).mockResolvedValue({ stdout: "", stderr: "", code: 0 });
    const orchestrator = new Orchestrator(deps);
    await (orchestrator as any).runTests();
    expect(deps.exec).toHaveBeenCalledWith("go", ["test", "./..."]);
  });
});

// ─── runLint() / findLintCommand() ──────────────────────────────────────────

describe("Orchestrator.runLint()", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mls-lint-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("no-ops when no lint config found", async () => {
    const deps = buildDeps({ cwd: tmpDir });
    const orchestrator = new Orchestrator(deps);
    await (orchestrator as any).runLint();
    // exec should not have been called for lint
    expect(deps.exec).not.toHaveBeenCalled();
  });

  it("runs npm lint script when package.json has lint", async () => {
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ scripts: { lint: "eslint ." } }));
    const deps = buildDeps({ cwd: tmpDir });
    vi.mocked(deps.exec).mockResolvedValue({ stdout: "", stderr: "", code: 0 });
    const orchestrator = new Orchestrator(deps);
    await (orchestrator as any).runLint();
    expect(deps.exec).toHaveBeenCalledWith("npm", ["run", "lint"]);
  });

  it("runs eslint when .eslintrc exists", async () => {
    fs.writeFileSync(path.join(tmpDir, ".eslintrc"), "{}");
    const deps = buildDeps({ cwd: tmpDir });
    vi.mocked(deps.exec).mockResolvedValue({ stdout: "", stderr: "", code: 0 });
    const orchestrator = new Orchestrator(deps);
    await (orchestrator as any).runLint();
    expect(deps.exec).toHaveBeenCalledWith("npx", ["--no-install", "eslint", "."]);
  });

  it("throws when lint command exits non-zero", async () => {
    fs.writeFileSync(path.join(tmpDir, ".eslintrc"), "{}");
    const deps = buildDeps({ cwd: tmpDir });
    vi.mocked(deps.exec).mockResolvedValue({ stdout: "error found", stderr: "", code: 1 });
    const orchestrator = new Orchestrator(deps);
    await expect((orchestrator as any).runLint()).rejects.toThrow("Lint failed");
  });

  it("runs biome when biome.json exists", async () => {
    fs.writeFileSync(path.join(tmpDir, "biome.json"), "{}");
    const deps = buildDeps({ cwd: tmpDir });
    vi.mocked(deps.exec).mockResolvedValue({ stdout: "", stderr: "", code: 0 });
    const orchestrator = new Orchestrator(deps);
    await (orchestrator as any).runLint();
    expect(deps.exec).toHaveBeenCalledWith("npx", ["--no-install", "biome", "check", "."]);
  });
});
