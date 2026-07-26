/**
 * Unit tests for spawnAgent, spawnAgentsParallel, and related helpers.
 *
 * Covers:
 * - buildSafetyPreamble (indirectly via spawnAgent)
 * - writeTempPrompt (indirectly via spawnAgent)
 * - spawnAgent: process spawning, event parsing, usage accumulation,
 *   abort signal, rate-limit detection, temp-file cleanup
 * - spawnAgentsParallel: parallel dispatch and result ordering
 * - mapLimit: concurrency limiting (indirectly via spawnAgentsParallel)
 * - getFinalOutput / extractText: via message_end events
 * - RateThrottle.wait(): backoff-period and pacing-delay branches
 *
 * Design note: spawnAgent is async and awaits rateThrottle.wait() then
 * writeTempPrompt() *before* calling spawn(). To avoid races, event emission
 * is always triggered from inside the mockSpawn implementation (post-microtask),
 * ensuring proc listeners are registered before events fire.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";

// ─── Module-level mock (must come before imports) ─────────────────────────────

const { mockSpawn } = vi.hoisted(() => ({ mockSpawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mockSpawn }));

import {
  spawnAgent,
  spawnAgentsParallel,
  rateThrottle,
} from "../.pi/extensions/mlst/agents.js";
import type { MlstAgentConfig } from "../.pi/extensions/mlst/types.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeMockProcess() {
  const proc = new EventEmitter() as any;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn(() => { proc.killed = true; });
  proc.killed = false;
  return proc;
}

/**
 * Set up mockSpawn to return a proc that fires stdout lines then close
 * in the next microtask (after proc listeners are registered by spawnAgent).
 */
function setupSpawn(lines: object[] = [], code = 0, stderrText = "") {
  const proc = makeMockProcess();
  mockSpawn.mockImplementation(() => {
    Promise.resolve().then(() => {
      if (stderrText) proc.stderr.emit("data", Buffer.from(stderrText));
      for (const line of lines) {
        proc.stdout.emit("data", Buffer.from(JSON.stringify(line) + "\n"));
      }
      proc.emit("close", code);
    });
    return proc;
  });
  return proc;
}

const AGENT: MlstAgentConfig = {
  name: "test-agent",
  description: "A test agent",
  systemPrompt: "Be helpful.",
  filePath: "/fake/agents/test-agent.md",
};

const SKILL_LOADER = { getSkillsForAgent: () => "" };

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  rateThrottle.applyProfile({ concurrency: 4, spawnDelayMs: 0 });
  // Reset internal timing state not touched by applyProfile.
  // backoffUntil: prevents spurious 10s waits after a backoff() call in a prior test.
  // lastSpawnTime: prevents stale values causing negative sinceLast and huge pacing sleeps.
  (rateThrottle as any).backoffUntil = 0;
  (rateThrottle as any).lastSpawnTime = 0;
  vi.clearAllMocks();
});

// ─── spawnAgent — basic spawning ──────────────────────────────────────────────

describe("spawnAgent — process spawning", () => {
  it("calls spawn with 'pi' and required flags", async () => {
    setupSpawn();
    await spawnAgent(AGENT, "Do the thing", SKILL_LOADER, { cwd: "/tmp/proj" });

    expect(mockSpawn).toHaveBeenCalledWith(
      "pi",
      expect.arrayContaining([
        "--mode", "json",
        "-p",
        "--no-session",
        "--no-extensions",
        "--thinking", "off",
      ]),
      expect.objectContaining({ cwd: "/tmp/proj", shell: false }),
    );
  });

  it("appends --model when agent has a model set", async () => {
    setupSpawn();
    await spawnAgent({ ...AGENT, model: "openai/gpt-4o" }, "Task", SKILL_LOADER, { cwd: "/tmp" });

    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args).toContain("--model");
    expect(args[args.indexOf("--model") + 1]).toBe("openai/gpt-4o");
  });

  it("falls back to opts.model when agent has no model", async () => {
    setupSpawn();
    await spawnAgent({ ...AGENT, model: undefined }, "Task", SKILL_LOADER, {
      cwd: "/tmp",
      model: "anthropic/claude-3",
    });

    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args).toContain("--model");
    expect(args[args.indexOf("--model") + 1]).toBe("anthropic/claude-3");
  });

  it("appends --tools when agent has tools", async () => {
    setupSpawn();
    await spawnAgent({ ...AGENT, tools: ["read", "bash"] }, "Task", SKILL_LOADER, { cwd: "/tmp" });

    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args).toContain("--tools");
    expect(args[args.indexOf("--tools") + 1]).toBe("read,bash");
  });

  it("returns exitCode 0 on clean exit", async () => {
    setupSpawn([], 0);
    const result = await spawnAgent(AGENT, "Task", SKILL_LOADER, { cwd: "/tmp" });
    expect(result.exitCode).toBe(0);
    expect(result.agent).toBe("test-agent");
    expect(result.task).toBe("Task");
  });

  it("returns non-zero exitCode on failure", async () => {
    setupSpawn([], 2);
    const result = await spawnAgent(AGENT, "Task", SKILL_LOADER, { cwd: "/tmp" });
    expect(result.exitCode).toBe(2);
  });

  it("treats process error event as exitCode 1", async () => {
    const proc = makeMockProcess();
    mockSpawn.mockImplementation(() => {
      Promise.resolve().then(() => proc.emit("error", new Error("spawn ENOENT")));
      return proc;
    });
    const result = await spawnAgent(AGENT, "Task", SKILL_LOADER, { cwd: "/tmp" });
    expect(result.exitCode).toBe(1);
  });

  it("collects stderr output", async () => {
    setupSpawn([], 0, "some error text\n");
    const result = await spawnAgent(AGENT, "Task", SKILL_LOADER, { cwd: "/tmp" });
    expect(result.stderr).toContain("some error text");
  });

  it("appends --append-system-prompt arg when system prompt is non-empty", async () => {
    setupSpawn();
    await spawnAgent(AGENT, "Task", SKILL_LOADER, { cwd: "/tmp" });

    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args).toContain("--append-system-prompt");
  });
});

// ─── spawnAgent — SSE event parsing ──────────────────────────────────────────

describe("spawnAgent — event parsing", () => {
  it("accumulates usage from message_end assistant messages", async () => {
    setupSpawn([
      {
        type: "message_end",
        message: {
          role: "assistant",
          content: "First turn",
          usage: { input: 100, output: 50, cacheRead: 10, cacheWrite: 5, cost: { total: 0.02 }, totalTokens: 160 },
          model: "claude-3-5-sonnet",
          stopReason: "end_turn",
        },
      },
      {
        type: "message_end",
        message: {
          role: "assistant",
          content: "Second turn",
          usage: { input: 200, output: 80, cacheRead: 0, cacheWrite: 0, cost: { total: 0.03 }, totalTokens: 430 },
        },
      },
    ]);
    const result = await spawnAgent(AGENT, "Task", SKILL_LOADER, { cwd: "/tmp" });

    expect(result.usage.input).toBe(300);
    expect(result.usage.output).toBe(130);
    expect(result.usage.cacheRead).toBe(10);
    expect(result.usage.cacheWrite).toBe(5);
    expect(result.usage.cost).toBeCloseTo(0.05);
    expect(result.usage.turns).toBe(2);
    expect(result.usage.contextTokens).toBe(430); // contextTokens = last message's totalTokens
    expect(result.model).toBe("claude-3-5-sonnet");
    expect(result.stopReason).toBe("end_turn");
  });

  it("sets errorMessage from message_end when present", async () => {
    setupSpawn([
      {
        type: "message_end",
        message: { role: "assistant", content: "", usage: {}, errorMessage: "Context window exceeded" },
      },
    ]);
    const result = await spawnAgent(AGENT, "Task", SKILL_LOADER, { cwd: "/tmp" });
    expect(result.errorMessage).toBe("Context window exceeded");
  });

  it("extracts text output from the last assistant message (string content)", async () => {
    setupSpawn([
      { type: "message_end", message: { role: "assistant", content: "The answer is 42", usage: {} } },
    ]);
    const result = await spawnAgent(AGENT, "Task", SKILL_LOADER, { cwd: "/tmp" });
    expect(result.output).toBe("The answer is 42");
  });

  it("extracts text from content-block arrays (extractText)", async () => {
    setupSpawn([
      {
        type: "message_end",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "Part one" },
            { type: "tool_use", id: "tool1", name: "bash", input: {} },
            { type: "text", text: "Part two" },
          ],
          usage: {},
        },
      },
    ]);
    const result = await spawnAgent(AGENT, "Task", SKILL_LOADER, { cwd: "/tmp" });
    expect(result.output).toContain("Part one");
    expect(result.output).toContain("Part two");
  });

  it("returns empty output when no assistant messages", async () => {
    setupSpawn([
      { type: "message_end", message: { role: "user", content: "User turn" } },
    ]);
    const result = await spawnAgent(AGENT, "Task", SKILL_LOADER, { cwd: "/tmp" });
    expect(result.output).toBe("");
  });

  it("returns empty output when assistant content is neither string nor array (extractText fallback)", async () => {
    setupSpawn([
      { type: "message_end", message: { role: "assistant", content: null, usage: {} } },
    ]);
    const result = await spawnAgent(AGENT, "Task", SKILL_LOADER, { cwd: "/tmp" });
    expect(result.output).toBe("");
  });

  it("getFinalOutput skips non-text content and finds last assistant message", async () => {
    setupSpawn([
      { type: "tool_result_end", message: { role: "tool", content: "tool output" } },
      { type: "message_end", message: { role: "assistant", content: "Done", usage: {} } },
    ]);
    const result = await spawnAgent(AGENT, "Task", SKILL_LOADER, { cwd: "/tmp" });
    expect(result.output).toBe("Done");
  });

  it("calls onProgress with text_delta content", async () => {
    const onProgress = vi.fn();
    const proc = makeMockProcess();
    mockSpawn.mockImplementation(() => {
      Promise.resolve().then(() => {
        proc.stdout.emit("data", Buffer.from(JSON.stringify({
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: "Hello world" },
        }) + "\n"));
        proc.emit("close", 0);
      });
      return proc;
    });

    await spawnAgent(AGENT, "Task", SKILL_LOADER, { cwd: "/tmp", onProgress });
    expect(onProgress).toHaveBeenCalledWith(expect.stringContaining("Hello world"), 0);
  });

  it("does not emit thinking progress when thinking content is all whitespace", async () => {
    const onProgress = vi.fn();
    const proc = makeMockProcess();
    mockSpawn.mockImplementation(() => {
      Promise.resolve().then(() => {
        proc.stdout.emit("data", Buffer.from(JSON.stringify({
          type: "message_update",
          assistantMessageEvent: { type: "thinking", thinking: "   " }, // all whitespace
        }) + "\n"));
        proc.stdout.emit("data", Buffer.from(JSON.stringify({
          type: "message_end",
          message: { role: "assistant", content: "Done", usage: {} },
        }) + "\n"));
        proc.emit("close", 0);
      });
      return proc;
    });

    await spawnAgent(AGENT, "Task", SKILL_LOADER, { cwd: "/tmp", onProgress });
    // No "thinking:" progress call should be made for whitespace-only thinking
    const thinkingCalls = onProgress.mock.calls.filter(([msg]) => String(msg).startsWith("thinking:"));
    expect(thinkingCalls).toHaveLength(0);
  });

  it("emits thinking summary via onProgress at message_end", async () => {
    const onProgress = vi.fn();
    const proc = makeMockProcess();
    mockSpawn.mockImplementation(() => {
      Promise.resolve().then(() => {
        proc.stdout.emit("data", Buffer.from(JSON.stringify({
          type: "message_update",
          assistantMessageEvent: { type: "thinking", thinking: "Let me think carefully" },
        }) + "\n"));
        proc.stdout.emit("data", Buffer.from(JSON.stringify({
          type: "message_end",
          message: { role: "assistant", content: "Done", usage: {} },
        }) + "\n"));
        proc.emit("close", 0);
      });
      return proc;
    });

    await spawnAgent(AGENT, "Task", SKILL_LOADER, { cwd: "/tmp", onProgress });
    expect(onProgress).toHaveBeenCalledWith(expect.stringContaining("thinking:"), expect.any(Number));
  });

  it("calls onProgress on tool_execution_start events", async () => {
    const onProgress = vi.fn();
    const proc = makeMockProcess();
    mockSpawn.mockImplementation(() => {
      Promise.resolve().then(() => {
        proc.stdout.emit("data", Buffer.from(JSON.stringify({
          type: "tool_execution_start",
          toolName: "bash",
          args: { command: "ls -la /project" },
        }) + "\n"));
        proc.emit("close", 0);
      });
      return proc;
    });

    await spawnAgent(AGENT, "Task", SKILL_LOADER, { cwd: "/tmp", onProgress });
    expect(onProgress).toHaveBeenCalledWith(expect.stringContaining("[bash]"), 1);
  });

  it("handles split JSON lines across data chunks", async () => {
    const proc = makeMockProcess();
    mockSpawn.mockImplementation(() => {
      Promise.resolve().then(() => {
        const line = JSON.stringify({
          type: "message_end",
          message: { role: "assistant", content: "Split result", usage: {} },
        });
        const mid = Math.floor(line.length / 2);
        proc.stdout.emit("data", Buffer.from(line.slice(0, mid)));
        proc.stdout.emit("data", Buffer.from(line.slice(mid) + "\n"));
        proc.emit("close", 0);
      });
      return proc;
    });

    const result = await spawnAgent(AGENT, "Task", SKILL_LOADER, { cwd: "/tmp" });
    expect(result.output).toBe("Split result");
  });

  it("silently ignores malformed JSON lines", async () => {
    const proc = makeMockProcess();
    mockSpawn.mockImplementation(() => {
      Promise.resolve().then(() => {
        proc.stdout.emit("data", Buffer.from("not json at all\n"));
        proc.emit("close", 0);
      });
      return proc;
    });

    const result = await spawnAgent(AGENT, "Task", SKILL_LOADER, { cwd: "/tmp" });
    expect(result.output).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("processes buffered data remaining when process closes without trailing newline", async () => {
    const proc = makeMockProcess();
    mockSpawn.mockImplementation(() => {
      Promise.resolve().then(() => {
        const line = JSON.stringify({
          type: "message_end",
          message: { role: "assistant", content: "Buffered", usage: {} },
        });
        proc.stdout.emit("data", Buffer.from(line)); // no trailing newline
        proc.emit("close", 0);
      });
      return proc;
    });

    const result = await spawnAgent(AGENT, "Task", SKILL_LOADER, { cwd: "/tmp" });
    expect(result.output).toBe("Buffered");
  });
});

// ─── spawnAgent — abort signal ────────────────────────────────────────────────

describe("spawnAgent — abort signal", () => {
  it("kills the process when signal is aborted after spawn", async () => {
    const controller = new AbortController();
    const proc = makeMockProcess();
    mockSpawn.mockImplementation(() => {
      Promise.resolve().then(() => {
        controller.abort(); // abort after listeners registered
        proc.emit("close", 0);
      });
      return proc;
    });

    const result = await spawnAgent(AGENT, "Task", SKILL_LOADER, {
      cwd: "/tmp",
      signal: controller.signal,
    });

    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
    expect(result.errorMessage).toContain("aborted");
  });

  it("kills the process immediately when signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort(); // aborted before spawn

    const proc = makeMockProcess();
    mockSpawn.mockImplementation(() => {
      Promise.resolve().then(() => proc.emit("close", 0));
      return proc;
    });

    const result = await spawnAgent(AGENT, "Task", SKILL_LOADER, {
      cwd: "/tmp",
      signal: controller.signal,
    });

    expect(proc.kill).toHaveBeenCalled();
    expect(result.errorMessage).toContain("aborted");
  });
});

// ─── spawnAgent — rate-limit adaptive throttling ─────────────────────────────

describe("spawnAgent — rate-limit adaptive throttling", () => {
  it("calls rateThrottle.backoff() when exit code is non-zero and stderr contains 429", async () => {
    const backoffSpy = vi.spyOn(rateThrottle, "backoff");
    setupSpawn([], 1, "HTTP 429 Too Many Requests\n");
    await spawnAgent(AGENT, "Task", SKILL_LOADER, { cwd: "/tmp" });
    expect(backoffSpy).toHaveBeenCalled();
  });

  it("calls rateThrottle.success() when exit code is 0", async () => {
    const successSpy = vi.spyOn(rateThrottle, "success");
    setupSpawn([], 0);
    await spawnAgent(AGENT, "Task", SKILL_LOADER, { cwd: "/tmp" });
    expect(successSpy).toHaveBeenCalled();
  });

  it("does not call backoff() when non-zero exit is not rate-limit related", async () => {
    const backoffSpy = vi.spyOn(rateThrottle, "backoff");
    setupSpawn([], 1, "connection refused\n");
    await spawnAgent(AGENT, "Task", SKILL_LOADER, { cwd: "/tmp" });
    expect(backoffSpy).not.toHaveBeenCalled();
  });
});

// ─── spawnAgentsParallel ──────────────────────────────────────────────────────

describe("spawnAgentsParallel", () => {
  it("dispatches multiple tasks and returns results in input order", async () => {
    mockSpawn.mockImplementation(() => {
      const proc = makeMockProcess();
      Promise.resolve().then(() => proc.emit("close", 0));
      return proc;
    });

    const tasks = [
      { agent: { ...AGENT, name: "agent-1" }, task: "task-1" },
      { agent: { ...AGENT, name: "agent-2" }, task: "task-2" },
    ];

    const results = await spawnAgentsParallel(tasks, SKILL_LOADER, { cwd: "/tmp" });
    expect(results).toHaveLength(2);
    expect(results[0].agent).toBe("agent-1");
    expect(results[1].agent).toBe("agent-2");
  });

  it("returns empty array for empty input", async () => {
    const results = await spawnAgentsParallel([], SKILL_LOADER, { cwd: "/tmp" });
    expect(results).toEqual([]);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("respects concurrency limit from rateThrottle", async () => {
    rateThrottle.applyProfile({ concurrency: 2, spawnDelayMs: 0 });

    let concurrent = 0;
    let maxConcurrent = 0;

    mockSpawn.mockImplementation(() => {
      const proc = makeMockProcess();
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      // Close in the next microtask so spawnAgent can register its listeners first.
      // This fires before the next task is dispatched, keeping the concurrent count accurate.
      Promise.resolve().then(() => {
        concurrent--;
        proc.emit("close", 0);
      });
      return proc;
    });

    await spawnAgentsParallel(
      Array.from({ length: 4 }, (_, i) => ({ agent: { ...AGENT, name: `a${i}` }, task: `t${i}` })),
      SKILL_LOADER,
      { cwd: "/tmp" },
    );

    expect(maxConcurrent).toBeGreaterThan(0);
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });
});

// ─── RateThrottle.wait() — backoff and pacing branches ───────────────────────

describe("RateThrottle.wait() — timing branches", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    rateThrottle.applyProfile({ concurrency: 4, spawnDelayMs: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves immediately when no backoff and no pacing delay", async () => {
    await expect(rateThrottle.wait()).resolves.toBeUndefined();
  });

  it("blocks during backoff period then resolves after advancing time", async () => {
    rateThrottle.applyProfile({ concurrency: 4, spawnDelayMs: 0 });
    rateThrottle.backoff(); // backoffUntil = now + 10_000

    let resolved = false;
    const p = rateThrottle.wait().then(() => { resolved = true; });

    await vi.advanceTimersByTimeAsync(9_999);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(2);
    await p;
    expect(resolved).toBe(true);
  });

  it("enforces pacing delay between consecutive spawns", async () => {
    rateThrottle.applyProfile({ concurrency: 4, spawnDelayMs: 1_000 });

    // First call: lastSpawnTime=0, sinceLast is huge → no pacing wait
    await rateThrottle.wait();

    // Second call: lastSpawnTime=now, sinceLast=0 < 1000 → pacing wait
    let resolved = false;
    const p = rateThrottle.wait().then(() => { resolved = true; });

    await vi.advanceTimersByTimeAsync(999);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(2);
    await p;
    expect(resolved).toBe(true);
  });

  it("skips pacing when sufficient time has already passed since last spawn", async () => {
    rateThrottle.applyProfile({ concurrency: 4, spawnDelayMs: 500 });

    await rateThrottle.wait(); // sets lastSpawnTime = now (fake)

    // Advance past the pacing window before the second call
    await vi.advanceTimersByTimeAsync(600);

    // Second call: sinceLast >= 500 → no pacing wait
    await expect(rateThrottle.wait()).resolves.toBeUndefined();
  });
});
