/**
 * Tests for the mlsExtension default export — command handlers and pi event hooks.
 *
 * Strategy: call mlsExtension(fakePi) with a fake ExtensionAPI that captures
 * registered handlers/listeners, then invoke them directly with a fake ctx.
 * All heavy dependencies (Orchestrator, Dashboard, MlsDatabase, etc.) are mocked.
 *
 * COVERAGE RATIONALE — not tested here:
 *   it.todo entries below document intentionally untested paths and why.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Heavy dependency mocks ───────────────────────────────────────────────────

const mockDbInstance = {
  getOrCreateProject: vi.fn().mockReturnValue({ id: 1 }),
  getActiveSprint: vi.fn().mockReturnValue(null),
  getLatestSprint: vi.fn().mockReturnValue(null),
  getSprint: vi.fn().mockReturnValue(null),
  getSprintSummary: vi.fn().mockReturnValue({ total: 0, closed: 0, open: 0, escalated: 0 }),
  getSprintIssues: vi.fn().mockReturnValue([]),
};

const mockStateInstance = {
  getState: vi.fn().mockReturnValue({ phase: "idle", tasks: [] }),
  setClassification: vi.fn(),
  reset: vi.fn(),
  setMaxIterations: vi.fn(),
};

vi.mock("../.pi/extensions/mls/db.js", () => ({
  MlsDatabase: class { constructor() { return mockDbInstance; } },
}));

vi.mock("../.pi/extensions/mls/state.js", () => ({
  StateManager: class { constructor() { return mockStateInstance; } },
}));

vi.mock("../.pi/extensions/mls/skills.js", () => ({
  SkillLoader: class { load() {} },
}));

vi.mock("../.pi/extensions/mls/context.js", () => ({
  ContextAssembler: class {},
}));

vi.mock("../.pi/extensions/mls/quality-gates.js", () => ({
  QualityGates: class {},
}));

vi.mock("../.pi/extensions/mls/agents.js", () => ({
  loadAgents: vi.fn().mockReturnValue([]),
  loadProviderProfile: vi.fn().mockReturnValue({ concurrency: 1, spawnDelayMs: 0 }),
  rateThrottle: { applyProfile: vi.fn() },
}));

vi.mock("../.pi/extensions/mls/config.js", () => ({
  loadProjectConfig: vi.fn().mockReturnValue({ models: {} }),
  resolveLlmModel: vi.fn().mockReturnValue("anthropic/claude-sonnet-4-6"),
}));

vi.mock("../.pi/extensions/mls/llm.js", () => ({
  LlmClient: class { call() { return Promise.resolve(""); } },
}));

vi.mock("../.pi/extensions/mls/dashboard.js", () => ({
  Dashboard: { acquire: vi.fn(() => ({ createSession: vi.fn(() => ({ url: "http://localhost:3000", runLogPath: null, emit: vi.fn(), stop: vi.fn() })) })) },
}));

vi.mock("../.pi/extensions/mls/prd.js", () => ({
  PrdSession: vi.fn(() => ({ run: vi.fn() })),
  parsePrdFilePath: vi.fn().mockReturnValue(null),
}));

vi.mock("@mariozechner/pi-tui", () => ({
  Text: class { render() { return null; } invalidate() {} },
}));

vi.mock("../.pi/extensions/mls/execution-profiles.js", () => ({
  resolveExecutionProfile: vi.fn().mockReturnValue({ name: "cloud", pipelineMode: "full", maxReviewIterations: 2, maxTestRetries: 2 }),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import mlsExtension from "../.pi/extensions/mls/index.js";

// ─── Fake ExtensionAPI builder ────────────────────────────────────────────────

interface CapturedPi {
  commands: Record<string, (args: string, ctx: any) => Promise<void>>;
  events: Record<string, (...args: any[]) => Promise<any>>;
  registerCommand: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  appendEntry: ReturnType<typeof vi.fn>;
  exec?: ReturnType<typeof vi.fn>;
}

function makeFakePi(): CapturedPi {
  const captured: CapturedPi = {
    commands: {},
    events: {},
    registerCommand: vi.fn(),
    on: vi.fn(),
    appendEntry: vi.fn(),
  };
  captured.registerCommand.mockImplementation((name: string, opts: any) => {
    captured.commands[name] = opts.handler;
  });
  captured.on.mockImplementation((event: string, handler: any) => {
    captured.events[event] = handler;
  });
  return captured;
}

function makeCtx(overrides: Partial<any> = {}): any {
  const notify = vi.fn();
  return {
    cwd: "/tmp/test-project",
    model: { provider: "anthropic", id: "claude-sonnet-4-6" },
    ui: { notify, setStatus: vi.fn(), setWidget: vi.fn(), setWorkingMessage: vi.fn(), setFooter: vi.fn() },
    ...overrides,
  };
}

// ─── /build command ───────────────────────────────────────────────────────────

describe("/build — handleBuild", () => {
  let pi: CapturedPi;
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbInstance.getActiveSprint.mockReturnValue(null);
    mockStateInstance.getState.mockReturnValue({ phase: "idle", tasks: [] });
    pi = makeFakePi();
    mlsExtension(pi as any);
  });

  it("notifies usage warning when called with no arguments", async () => {
    const ctx = makeCtx();
    await pi.commands["build"]("", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith("Usage: /build <description>", "warning");
  });

  it("notifies usage warning when args is only whitespace", async () => {
    const ctx = makeCtx();
    await pi.commands["build"]("   ", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith("Usage: /build <description>", "warning");
  });

  it("notifies 'No sprint found' when --resume but no sprint in db", async () => {
    mockDbInstance.getLatestSprint.mockReturnValue(null);
    const ctx = makeCtx();
    await pi.commands["build"]("--resume", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith("No sprint found to resume.", "warning");
  });

  it("notifies missing specification when --resume sprint has no spec", async () => {
    mockDbInstance.getLatestSprint.mockReturnValue({ id: 5, name: "Sprint 5", specification: null });
    const ctx = makeCtx();
    await pi.commands["build"]("--resume", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith("Sprint has no specification — cannot resume from Phase 3.", "warning");
  });

  it("notifies no tasks when --resume sprint has no issues", async () => {
    mockDbInstance.getLatestSprint.mockReturnValue({ id: 5, name: "Sprint 5", specification: "spec content" });
    mockDbInstance.getSprintIssues.mockReturnValue([]);
    const ctx = makeCtx();
    await pi.commands["build"]("--resume", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith("Sprint has no tasks — cannot resume.", "warning");
  });

  it("uses specific sprint id when --resume <id> is passed", async () => {
    mockDbInstance.getSprint.mockReturnValue(null);
    const ctx = makeCtx();
    await pi.commands["build"]("--resume 42", ctx);
    expect(mockDbInstance.getSprint).toHaveBeenCalledWith(42);
    expect(ctx.ui.notify).toHaveBeenCalledWith("No sprint found to resume.", "warning");
  });

  it.todo("handleBuild full path — skipped: mocking Orchestrator + Dashboard singleton requires substantial setup for low incremental value; Orchestrator is covered by its own test suite");
  it.todo("handleResume full path — skipped: same reason as handleBuild full path");
});

// ─── /mls-status command ──────────────────────────────────────────────────────

describe("/mls-status — handleStatus", () => {
  let pi: CapturedPi;
  beforeEach(() => {
    vi.clearAllMocks();
    mockStateInstance.getState.mockReturnValue({ phase: "idle", tasks: [] });
    pi = makeFakePi();
    mlsExtension(pi as any);
  });

  it("notifies 'No active sprint.' when no sprint exists", async () => {
    mockDbInstance.getActiveSprint.mockReturnValue(null);
    const ctx = makeCtx();
    await pi.commands["mls-status"]("", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith("No active sprint.", "info");
  });

  it("calls notify with formatted status lines when a sprint is active", async () => {
    mockDbInstance.getActiveSprint.mockReturnValue({ id: 3, name: "Sprint 3" });
    mockDbInstance.getSprintSummary.mockReturnValue({ total: 5, closed: 3, open: 2, escalated: 0 });
    mockDbInstance.getSprintIssues.mockReturnValue([
      { number: 1, title: "Fix bug", status: "closed", id: 1 },
    ]);
    const ctx = makeCtx();
    await pi.commands["mls-status"]("", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Sprint 3"),
      "info",
    );
  });
});

// ─── /prd command ─────────────────────────────────────────────────────────────

describe("/prd — handlePrd", () => {
  let pi: CapturedPi;
  beforeEach(() => {
    vi.clearAllMocks();
    mockStateInstance.getState.mockReturnValue({ phase: "idle", tasks: [] });
    pi = makeFakePi();
    mlsExtension(pi as any);
  });

  it("notifies usage warning when called with no arguments", async () => {
    const ctx = makeCtx();
    await pi.commands["prd"]("", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith("Usage: /prd <idea> or /prd --resume <slug>", "warning");
  });

  it("notifies interactive-mode-required when ctx.ui.input is absent", async () => {
    const ctx = makeCtx();
    delete ctx.ui.input;
    await pi.commands["prd"]("my great idea", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith("The /prd command requires interactive mode.", "warning");
  });

  it.todo("handlePrd full run path — skipped: requires mocking PrdSession.run() interactive loop; covered by prd.ts unit tests");
});

// ─── session_start event ──────────────────────────────────────────────────────

describe("session_start event", () => {
  let pi: CapturedPi;
  beforeEach(() => {
    vi.clearAllMocks();
    mockStateInstance.getState.mockReturnValue({ phase: "idle", tasks: [] });
    pi = makeFakePi();
    mlsExtension(pi as any);
  });

  it("calls getOrCreateProject after session_start (db initialised)", async () => {
    const ctx = makeCtx();
    await pi.events["session_start"](undefined, ctx);
    // Trigger a command to confirm db is ready — handleStatus uses ensureInit
    await pi.commands["mls-status"]("", ctx);
    expect(mockDbInstance.getOrCreateProject).toHaveBeenCalledWith(ctx.cwd);
  });

  it("returns undefined from session_start handler", async () => {
    const result = await pi.events["session_start"](undefined, makeCtx());
    expect(result).toBeUndefined();
  });
});

// ─── tool_call event ──────────────────────────────────────────────────────────

describe("tool_call event", () => {
  let pi: CapturedPi;
  beforeEach(() => {
    vi.clearAllMocks();
    mockStateInstance.getState.mockReturnValue({ phase: "idle", tasks: [] });
    pi = makeFakePi();
    mlsExtension(pi as any);
  });

  it("returns undefined when orchestrator is not active (idle session)", async () => {
    const result = await pi.events["tool_call"]({ toolName: "edit", args: {} });
    expect(result).toBeUndefined();
  });

  it.todo("tool_call blocks edit when orchestratorActive=true — skipped: orchestratorActive is a closure-private flag set only during a full /build run; tested indirectly via integration");
  it.todo("tool_call blocks catastrophic bash when orchestratorActive=true — same reason as above");
});

// ─── session_before_compact event ────────────────────────────────────────────

describe("session_before_compact event", () => {
  let pi: CapturedPi;
  beforeEach(() => {
    vi.clearAllMocks();
    mockStateInstance.getState.mockReturnValue({ phase: "idle", tasks: [] });
    pi = makeFakePi();
    mlsExtension(pi as any);
  });

  it("returns undefined when state has never been initialised", async () => {
    // No session_start fired → state is null inside the closure
    const result = await pi.events["session_before_compact"]();
    expect(result).toBeUndefined();
  });

  it("returns undefined when sprint phase is idle", async () => {
    mockStateInstance.getState.mockReturnValue({ phase: "idle", tasks: [] });
    await pi.events["session_start"](undefined, makeCtx());
    const result = await pi.events["session_before_compact"]();
    expect(result).toBeUndefined();
  });

  it("returns custom instructions when sprint is in progress", async () => {
    mockStateInstance.getState.mockReturnValue({ phase: "phase3", tasks: [{ id: "T1" }, { id: "T2" }] });
    await pi.events["session_start"](undefined, makeCtx());
    const result = await pi.events["session_before_compact"]();
    expect(result).toMatchObject({
      customInstructions: expect.stringContaining("phase3"),
    });
    expect(result.customInstructions).toContain("2");
  });
});
