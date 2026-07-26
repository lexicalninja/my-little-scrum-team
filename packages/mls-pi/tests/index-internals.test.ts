/**
 * Unit tests for private/internal functions in index.ts, accessed via __test__.
 *
 * Covers:
 * - applyWidgetEvent — all event types
 * - applyFooterEvent — accumulation and non-agent_end events
 * - Utility functions: agentStyle, shortAgent, fmtElapsed, fmtTokens
 * - isSubprocessInvocation
 * - promptUserForClarification — interactive and non-interactive paths
 * - execCommand — pi.exec delegate and spawn fallback
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

// ─── Module-level mocks (must come before imports) ────────────────────────────

const { mockSpawn } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
}));

vi.mock("node:child_process", () => ({ spawn: mockSpawn }));

vi.mock("@mariozechner/pi-tui", () => ({
  Text: class {
    constructor() {}
    render() { return null; }
    invalidate() {}
  },
}));

vi.mock("../.pi/extensions/mls/execution-profiles.js", () => ({
  resolveExecutionProfile: () => ({ name: "cloud" }),
}));

import { __test__ } from "../.pi/extensions/mls/index.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ts() { return Date.now(); }

function agentEndEvent(agent = "mls-impl-engineer", taskLabel = "TASK-001", usage = { input: 100, output: 200, cost: 0.05 }) {
  return { type: "agent_end" as const, agent, taskLabel, output: "", model: "test", usage, timestamp: ts() };
}

// ─── applyWidgetEvent ─────────────────────────────────────────────────────────

describe("applyWidgetEvent — phase events", () => {
  it("marks all earlier pipeline steps complete when phase0 starts", () => {
    const w = __test__.createWidgetState();
    __test__.applyWidgetEvent(w, { type: "phase", phase: "phase0", timestamp: ts() });
    // phase0 is first — nothing earlier to mark complete
    expect(w.pipeline[0].status).toBe("in-progress");
    expect(w.activePipelineId).toBe("phase0");
  });

  it("marks phase0 complete when phase1 starts", () => {
    const w = __test__.createWidgetState();
    __test__.applyWidgetEvent(w, { type: "phase", phase: "phase1", timestamp: ts() });
    const phase0 = w.pipeline.find((s: any) => s.id === "phase0");
    const phase1 = w.pipeline.find((s: any) => s.id === "phase1");
    expect(phase0?.status).toBe("complete");
    expect(phase1?.status).toBe("in-progress");
    expect(w.activePipelineId).toBe("phase1");
  });

  it("marks phase0+phase1 complete when phase2 starts", () => {
    const w = __test__.createWidgetState();
    __test__.applyWidgetEvent(w, { type: "phase", phase: "phase2", timestamp: ts() });
    expect(w.pipeline.find((s: any) => s.id === "phase0")?.status).toBe("complete");
    expect(w.pipeline.find((s: any) => s.id === "phase1")?.status).toBe("complete");
    expect(w.pipeline.find((s: any) => s.id === "phase2")?.status).toBe("in-progress");
  });

  it("marks phase4 in-progress when phase4 event fires", () => {
    const w = __test__.createWidgetState();
    __test__.applyWidgetEvent(w, { type: "phase", phase: "phase4", timestamp: ts() });
    const phase4 = w.pipeline.find((s: any) => s.id === "phase4");
    expect(phase4?.status).toBe("in-progress");
    expect(w.activePipelineId).toBe("phase4");
  });

  it("clears agents map on each phase transition", () => {
    const w = __test__.createWidgetState();
    // Manually add a fake agent slot
    w.agents.set("mls-designer:test", { agent: "mls-designer", taskLabel: "test", status: "running", progress: "", toolCount: 0, startTime: ts() });
    __test__.applyWidgetEvent(w, { type: "phase", phase: "phase1", timestamp: ts() });
    expect(w.agents.size).toBe(0);
  });

  it("sets display label from PHASE_DISPLAY map", () => {
    const w = __test__.createWidgetState();
    __test__.applyWidgetEvent(w, { type: "phase", phase: "phase0", timestamp: ts() });
    expect(w.phase).toBe("Idea Refinement");
  });

  it("uses raw phase name for unknown display keys", () => {
    const w = __test__.createWidgetState();
    __test__.applyWidgetEvent(w, { type: "phase", phase: "unknown-phase", timestamp: ts() });
    expect(w.phase).toBe("unknown-phase");
  });
});

describe("applyWidgetEvent — agent_start", () => {
  it("adds a running agent slot with the given key", () => {
    const w = __test__.createWidgetState();
    __test__.applyWidgetEvent(w, { type: "agent_start", agent: "mls-designer", taskLabel: "TASK-001", prompt: "", timestamp: ts() });
    const slot = w.agents.get("mls-designer:TASK-001");
    expect(slot).toBeDefined();
    expect(slot.status).toBe("running");
    expect(slot.agent).toBe("mls-designer");
    expect(slot.taskLabel).toBe("TASK-001");
  });

  it("falls back to activePipelineId when taskLabel is empty", () => {
    const w = __test__.createWidgetState();
    w.activePipelineId = "phase1";
    __test__.applyWidgetEvent(w, { type: "agent_start", agent: "mls-spec-writer", taskLabel: "", prompt: "", timestamp: ts() });
    const slot = w.agents.get("mls-spec-writer:");
    expect(slot?.taskLabel).toBe("phase1");
  });
});

describe("applyWidgetEvent — agent_end", () => {
  it("marks the matching slot as done", () => {
    const w = __test__.createWidgetState();
    __test__.applyWidgetEvent(w, { type: "agent_start", agent: "mls-impl-engineer", taskLabel: "TASK-001", prompt: "", timestamp: ts() });
    __test__.applyWidgetEvent(w, agentEndEvent("mls-impl-engineer", "TASK-001"));
    const slot = w.agents.get("mls-impl-engineer:TASK-001");
    expect(slot?.status).toBe("done");
  });

  it("records tokens and cost on the slot", () => {
    const w = __test__.createWidgetState();
    __test__.applyWidgetEvent(w, { type: "agent_start", agent: "mls-impl-engineer", taskLabel: "TASK-001", prompt: "", timestamp: ts() });
    __test__.applyWidgetEvent(w, agentEndEvent("mls-impl-engineer", "TASK-001", { input: 500, output: 250, cost: 0.1 }));
    const slot = w.agents.get("mls-impl-engineer:TASK-001");
    expect(slot?.tokens).toBe(750);
    expect(slot?.cost).toBe(0.1);
  });

  it("attributes tokens to matching task", () => {
    const w = __test__.createWidgetState();
    w.tasks.set("TASK-001", { id: "TASK-001", title: "Build feature", status: "in-progress", tokens: 0 });
    __test__.applyWidgetEvent(w, { type: "agent_start", agent: "mls-impl-engineer", taskLabel: "TASK-001", prompt: "", timestamp: ts() });
    __test__.applyWidgetEvent(w, agentEndEvent("mls-impl-engineer", "TASK-001", { input: 100, output: 100, cost: 0.02 }));
    expect(w.tasks.get("TASK-001")?.tokens).toBe(200);
  });

  it("attributes tokens to pipeline step when no matching task", () => {
    const w = __test__.createWidgetState();
    __test__.applyWidgetEvent(w, { type: "phase", phase: "phase1", timestamp: ts() });
    __test__.applyWidgetEvent(w, { type: "agent_start", agent: "mls-spec-writer", taskLabel: "phase1", prompt: "", timestamp: ts() });
    __test__.applyWidgetEvent(w, agentEndEvent("mls-spec-writer", "phase1", { input: 300, output: 300, cost: 0.06 }));
    const step = w.pipeline.find((s: any) => s.id === "phase1");
    expect(step?.tokens).toBe(600);
  });

  it("is a no-op when the slot is not found", () => {
    const w = __test__.createWidgetState();
    // No prior agent_start — should not throw
    expect(() => __test__.applyWidgetEvent(w, agentEndEvent("mls-impl-engineer", "TASK-999"))).not.toThrow();
  });

  it("handles missing usage gracefully (defaults to 0)", () => {
    const w = __test__.createWidgetState();
    __test__.applyWidgetEvent(w, { type: "agent_start", agent: "mls-impl-engineer", taskLabel: "T", prompt: "", timestamp: ts() });
    // usage fields are undefined
    __test__.applyWidgetEvent(w, { type: "agent_end", agent: "mls-impl-engineer", taskLabel: "T", output: "", usage: {} as any, timestamp: ts() });
    const slot = w.agents.get("mls-impl-engineer:T");
    expect(slot?.tokens).toBe(0);
    expect(slot?.cost).toBe(0);
  });
});

describe("applyWidgetEvent — agent_progress", () => {
  it("updates progress text and toolCount on matching slot", () => {
    const w = __test__.createWidgetState();
    __test__.applyWidgetEvent(w, { type: "agent_start", agent: "mls-test-runner", taskLabel: "TASK-002", prompt: "", timestamp: ts() });
    __test__.applyWidgetEvent(w, { type: "agent_progress", agent: "mls-test-runner", taskLabel: "TASK-002", text: "Running tests…", toolCount: 3, timestamp: ts() });
    const slot = w.agents.get("mls-test-runner:TASK-002");
    expect(slot?.progress).toBe("Running tests…");
    expect(slot?.toolCount).toBe(3);
  });

  it("is a no-op when slot is not found", () => {
    const w = __test__.createWidgetState();
    expect(() => __test__.applyWidgetEvent(w, { type: "agent_progress", agent: "mls-reviewer", taskLabel: "TASK-X", text: "hi", toolCount: 1, timestamp: ts() })).not.toThrow();
  });
});

describe("applyWidgetEvent — task", () => {
  it("creates a new task slot when the id is not present", () => {
    const w = __test__.createWidgetState();
    __test__.applyWidgetEvent(w, { type: "task", id: "TASK-003", status: "pending", title: "My Task", timestamp: ts() });
    const task = w.tasks.get("TASK-003");
    expect(task).toBeDefined();
    expect(task.title).toBe("My Task");
    expect(task.status).toBe("pending");
    expect(task.tokens).toBe(0);
  });

  it("updates status on an existing task", () => {
    const w = __test__.createWidgetState();
    __test__.applyWidgetEvent(w, { type: "task", id: "TASK-004", status: "pending", title: "Feature", timestamp: ts() });
    __test__.applyWidgetEvent(w, { type: "task", id: "TASK-004", status: "in-progress", title: "", timestamp: ts() });
    expect(w.tasks.get("TASK-004")?.status).toBe("in-progress");
  });

  it("updates title when provided in update event", () => {
    const w = __test__.createWidgetState();
    __test__.applyWidgetEvent(w, { type: "task", id: "T1", status: "pending", title: "Old", timestamp: ts() });
    __test__.applyWidgetEvent(w, { type: "task", id: "T1", status: "complete", title: "New", timestamp: ts() });
    expect(w.tasks.get("T1")?.title).toBe("New");
  });
});

describe("applyWidgetEvent — human_gate", () => {
  it("sets phase to the gate description", () => {
    const w = __test__.createWidgetState();
    __test__.applyWidgetEvent(w, { type: "human_gate", gate: "spec-review", status: "waiting", timestamp: ts() } as any);
    expect(w.phase).toBe("Gate: spec-review [waiting]");
  });
});

describe("applyWidgetEvent — sprint_end", () => {
  it("sets phase to Complete and clears running agents", () => {
    const w = __test__.createWidgetState();
    w.agents.set("mls-designer:T", { agent: "mls-designer", taskLabel: "T", status: "running", progress: "", toolCount: 0, startTime: ts() });
    __test__.applyWidgetEvent(w, { type: "sprint_end", summary: "done", timestamp: ts() });
    expect(w.phase).toBe("Complete");
    expect(w.agents.size).toBe(0);
  });

  it("marks any in-progress pipeline step as complete", () => {
    const w = __test__.createWidgetState();
    __test__.applyWidgetEvent(w, { type: "phase", phase: "phase4", timestamp: ts() });
    expect(w.pipeline.find((s: any) => s.id === "phase4")?.status).toBe("in-progress");
    __test__.applyWidgetEvent(w, { type: "sprint_end", summary: "done", timestamp: ts() });
    expect(w.pipeline.find((s: any) => s.id === "phase4")?.status).toBe("complete");
  });
});

describe("applyWidgetEvent — unknown type", () => {
  it("is a no-op for unrecognised event types", () => {
    const w = __test__.createWidgetState();
    const phaseBefore = w.phase;
    expect(() => __test__.applyWidgetEvent(w, { type: "llm_start", purpose: "x", system: "", user: "", tier: "fast", timestamp: ts() })).not.toThrow();
    expect(w.phase).toBe(phaseBefore);
  });
});

// ─── applyFooterEvent ─────────────────────────────────────────────────────────

describe("applyFooterEvent", () => {
  it("creates a new agent total entry on the first agent_end", () => {
    const footer = __test__.createFooterState();
    __test__.applyFooterEvent(footer, agentEndEvent("mls-designer", "T", { input: 100, output: 200, cost: 0.03 }));
    const total = footer.agentTotals.get("mls-designer");
    expect(total).toBeDefined();
    expect(total.tokens).toBe(300);
    expect(total.cost).toBe(0.03);
    expect(total.runs).toBe(1);
    expect(footer.totalTokens).toBe(300);
    expect(footer.totalCost).toBe(0.03);
  });

  it("accumulates into an existing entry on subsequent agent_end events", () => {
    const footer = __test__.createFooterState();
    __test__.applyFooterEvent(footer, agentEndEvent("mls-designer", "T1", { input: 100, output: 100, cost: 0.02 }));
    __test__.applyFooterEvent(footer, agentEndEvent("mls-designer", "T2", { input: 200, output: 200, cost: 0.04 }));
    const total = footer.agentTotals.get("mls-designer");
    expect(total?.runs).toBe(2);
    expect(total?.tokens).toBe(600);
    expect(total?.cost).toBeCloseTo(0.06);
  });

  it("tracks multiple agents independently", () => {
    const footer = __test__.createFooterState();
    __test__.applyFooterEvent(footer, agentEndEvent("mls-designer", "T1", { input: 100, output: 100, cost: 0.02 }));
    __test__.applyFooterEvent(footer, agentEndEvent("mls-impl-engineer", "T2", { input: 200, output: 200, cost: 0.04 }));
    expect(footer.agentTotals.size).toBe(2);
    expect(footer.totalTokens).toBe(600);
  });

  it("ignores non-agent_end events", () => {
    const footer = __test__.createFooterState();
    __test__.applyFooterEvent(footer, { type: "phase", phase: "phase1", timestamp: ts() });
    expect(footer.agentTotals.size).toBe(0);
    expect(footer.totalTokens).toBe(0);
  });

  it("handles missing usage fields (defaults to 0)", () => {
    const footer = __test__.createFooterState();
    __test__.applyFooterEvent(footer, { type: "agent_end", agent: "mls-reviewer", taskLabel: "T", output: "", usage: {} as any, timestamp: ts() });
    const total = footer.agentTotals.get("mls-reviewer");
    expect(total?.tokens).toBe(0);
    expect(total?.cost).toBe(0);
  });
});

// ─── Utility functions ────────────────────────────────────────────────────────

describe("agentStyle", () => {
  it("returns known color/initial for recognised agent names", () => {
    const s = __test__.agentStyle("mls-designer");
    expect(s.color).toBe("accent");
    expect(s.initial).toBe("D");
  });

  it("returns dim color and first-char initial for unknown agents", () => {
    const s = __test__.agentStyle("unknown-agent");
    expect(s.color).toBe("dim");
    expect(s.initial).toBe("U");
  });

  it("returns correct style for mls-impl-engineer", () => {
    const s = __test__.agentStyle("mls-impl-engineer");
    expect(s.color).toBe("success");
    expect(s.initial).toBe("I");
  });
});

describe("shortAgent", () => {
  it("strips the mls- prefix and uppercases", () => {
    expect(__test__.shortAgent("mls-designer")).toBe("DESIGNER");
  });

  it("replaces hyphens with spaces", () => {
    expect(__test__.shortAgent("mls-impl-engineer")).toBe("IMPL ENGINEER");
  });

  it("handles names without mls- prefix (hyphens become spaces)", () => {
    expect(__test__.shortAgent("my-agent")).toBe("MY AGENT");
  });
});

describe("fmtElapsed", () => {
  it("shows seconds for durations under 60s", () => {
    expect(__test__.fmtElapsed(0)).toBe("0s");
    expect(__test__.fmtElapsed(5000)).toBe("5s");
    expect(__test__.fmtElapsed(59000)).toBe("59s");
  });

  it("shows minutes and seconds for durations 60s and over", () => {
    expect(__test__.fmtElapsed(60000)).toBe("1m0s");
    expect(__test__.fmtElapsed(90000)).toBe("1m30s");
    expect(__test__.fmtElapsed(125000)).toBe("2m5s");
  });
});

describe("fmtTokens", () => {
  it("shows raw count for values under 1000", () => {
    expect(__test__.fmtTokens(0)).toBe("0");
    expect(__test__.fmtTokens(999)).toBe("999");
  });

  it("shows compact k suffix for values 1000 and over", () => {
    expect(__test__.fmtTokens(1000)).toBe("1.0k");
    expect(__test__.fmtTokens(14200)).toBe("14.2k");
    expect(__test__.fmtTokens(100000)).toBe("100.0k");
  });
});

// ─── isSubprocessInvocation ───────────────────────────────────────────────────

describe("isSubprocessInvocation", () => {
  it("returns true when argv contains -p", () => {
    expect(__test__.isSubprocessInvocation(["node", "pi", "-p"])).toBe(true);
  });

  it("returns true when argv contains --mode", () => {
    expect(__test__.isSubprocessInvocation(["node", "pi", "--mode", "json"])).toBe(true);
  });

  it("returns false when neither flag is present", () => {
    expect(__test__.isSubprocessInvocation(["node", "pi", "--no-session"])).toBe(false);
  });

  it("returns false for an empty argv", () => {
    expect(__test__.isSubprocessInvocation([])).toBe(false);
  });
});

// ─── promptUserForClarification ──────────────────────────────────────────────

describe("promptUserForClarification", () => {
  it("returns null immediately when ctx has no ui.notify", async () => {
    const ctx = { cwd: "/tmp", ui: {} };
    const result = await __test__.promptUserForClarification(ctx, "What colour?");
    expect(result).toBeNull();
  });

  it("returns null when ctx.ui is absent", async () => {
    const ctx = { cwd: "/tmp" };
    const result = await __test__.promptUserForClarification(ctx, "Question?");
    expect(result).toBeNull();
  });

  it("calls ui.input and returns the trimmed answer", async () => {
    const mockInput = vi.fn().mockResolvedValue("  yes please  ");
    const ctx = { cwd: "/tmp", ui: { notify: vi.fn(), input: mockInput } };
    const result = await __test__.promptUserForClarification(ctx, "Proceed?");
    expect(result).toBe("yes please");
    expect(mockInput).toHaveBeenCalledWith(
      expect.stringContaining("Proceed?"),
      "Type your answer...",
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
  });

  it("returns null when ui.input resolves to undefined (user cancelled)", async () => {
    const ctx = { cwd: "/tmp", ui: { notify: vi.fn(), input: vi.fn().mockResolvedValue(undefined) } };
    const result = await __test__.promptUserForClarification(ctx, "Question?");
    expect(result).toBeNull();
  });

  it("returns null when ui.input resolves to an empty/whitespace string", async () => {
    const ctx = { cwd: "/tmp", ui: { notify: vi.fn(), input: vi.fn().mockResolvedValue("   ") } };
    const result = await __test__.promptUserForClarification(ctx, "Question?");
    expect(result).toBeNull();
  });

  it("falls through to notify+null when ui.input is not a function", async () => {
    const notify = vi.fn();
    const ctx = { cwd: "/tmp", ui: { notify } };
    const result = await __test__.promptUserForClarification(ctx, "Anything?", "agent-x");
    expect(result).toBeNull();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("agent-x"), "warning");
  });

  it("includes context in the title when provided", async () => {
    const mockInput = vi.fn().mockResolvedValue("answer");
    const ctx = { cwd: "/tmp", ui: { notify: vi.fn(), input: mockInput } };
    await __test__.promptUserForClarification(ctx, "What?", "my-agent");
    expect(mockInput).toHaveBeenCalledWith(
      expect.stringContaining("my-agent"),
      expect.any(String),
      expect.any(Object),
    );
  });

  it("returns null and does not throw when ui.input throws", async () => {
    const ctx = { cwd: "/tmp", ui: { notify: vi.fn(), input: vi.fn().mockRejectedValue(new Error("no input")) } };
    const result = await __test__.promptUserForClarification(ctx, "Question?");
    expect(result).toBeNull();
  });
});

// ─── execCommand ─────────────────────────────────────────────────────────────

describe("execCommand — pi.exec path", () => {
  it("delegates to pi.exec when it is available", async () => {
    const mockExec = vi.fn().mockResolvedValue({ stdout: "hello", stderr: "", code: 0 });
    const pi = { registerCommand: vi.fn(), on: vi.fn(), appendEntry: vi.fn(), exec: mockExec };
    const result = await __test__.execCommand(pi, "/tmp", "git", ["status"]);
    expect(result).toEqual({ stdout: "hello", stderr: "", code: 0 });
    expect(mockExec).toHaveBeenCalledWith("git", ["status"], { timeout: 60000 });
  });
});

describe("execCommand — spawn fallback", () => {
  function makeProc() {
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    const proc = new EventEmitter() as any;
    proc.stdout = stdout;
    proc.stderr = stderr;
    proc.stdin = { write: vi.fn(), end: vi.fn() };
    proc.kill = vi.fn();
    return proc;
  }

  it("falls back to spawn when pi.exec is absent", async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc);
    const pi = { registerCommand: vi.fn(), on: vi.fn(), appendEntry: vi.fn() };

    const promise = __test__.execCommand(pi, "/tmp", "git", ["status"]);
    proc.stdout.emit("data", Buffer.from("on branch main\n"));
    proc.emit("close", 0);
    const result = await promise;
    expect(result.stdout).toBe("on branch main\n");
    expect(result.code).toBe(0);
  });

  it("collects stderr in the spawn fallback", async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc);
    const pi = { registerCommand: vi.fn(), on: vi.fn(), appendEntry: vi.fn() };

    const promise = __test__.execCommand(pi, "/tmp", "bad-cmd", []);
    proc.stderr.emit("data", Buffer.from("error: not found\n"));
    proc.emit("close", 1);
    const result = await promise;
    expect(result.stderr).toBe("error: not found\n");
    expect(result.code).toBe(1);
  });

  it("resolves with code 1 on spawn error event", async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc);
    const pi = { registerCommand: vi.fn(), on: vi.fn(), appendEntry: vi.fn() };

    const promise = __test__.execCommand(pi, "/tmp", "nonexistent", []);
    proc.emit("error", new Error("ENOENT"));
    const result = await promise;
    expect(result.code).toBe(1);
  });

  it("resolves with code 1 when close fires with null code", async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc);
    const pi = { registerCommand: vi.fn(), on: vi.fn(), appendEntry: vi.fn() };

    const promise = __test__.execCommand(pi, "/tmp", "cmd", []);
    proc.emit("close", null);
    const result = await promise;
    expect(result.code).toBe(1);
  });
});
