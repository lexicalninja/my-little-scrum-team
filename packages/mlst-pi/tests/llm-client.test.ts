/**
 * Tests for LlmClient.call() and the private spawnPi() function.
 *
 * Both node:child_process and the fs.promises methods used in LlmClient.call()
 * are mocked so the tests run without a real `pi` binary or real temp files.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

// ─── Hoisted mocks (must come before imports) ─────────────────────────────────

const { mockSpawn, mockMkdtemp, mockWriteFile, mockUnlinkSync, mockRmdirSync } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockMkdtemp: vi.fn().mockResolvedValue("/tmp/mlst-llm-test-abc"),
  mockWriteFile: vi.fn().mockResolvedValue(undefined),
  mockUnlinkSync: vi.fn(),
  mockRmdirSync: vi.fn(),
}));

vi.mock("node:child_process", () => ({ spawn: mockSpawn }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    promises: {
      ...actual.promises,
      mkdtemp: mockMkdtemp,
      writeFile: mockWriteFile,
    },
    unlinkSync: mockUnlinkSync,
    rmdirSync: mockRmdirSync,
  };
});

import { LlmClient } from "../.pi/extensions/mlst/llm.js";

// ─── Helper: fake child process ───────────────────────────────────────────────

function makeProc() {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdout = stdout;
  proc.stderr = stderr;
  proc.stdin = { write: vi.fn(), end: vi.fn() };
  proc.kill = vi.fn();
  return proc;
}

/** Flush the microtask queue so async file ops (now mocked) resolve. */
async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

/** Build the JSON line spawnPi recognises as the final assistant text. */
function messageEndLine(content: string): string {
  return JSON.stringify({ type: "message_end", message: { role: "assistant", content } });
}

/** Build the JSON line spawnPi recognises as a streaming text delta. */
function textDeltaLine(delta: string): string {
  return JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta } });
}

// ─── LlmClient constructor ────────────────────────────────────────────────────

describe("LlmClient constructor", () => {
  it("can be instantiated without a model", () => {
    expect(() => new LlmClient()).not.toThrow();
  });

  it("can be instantiated with a model string", () => {
    expect(() => new LlmClient("anthropic/claude-opus-4-6")).not.toThrow();
  });
});

// ─── LlmClient.call() — happy path ───────────────────────────────────────────

describe("LlmClient.call() — happy path", () => {
  beforeEach(() => {
    mockSpawn.mockReset();
  });

  it("returns the assistant text when the process closes with code 0", async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc);

    const client = new LlmClient();
    const promise = client.call("system prompt", "user prompt");

    await flushMicrotasks();
    proc.stdout.emit("data", Buffer.from(messageEndLine("Hello from model") + "\n"));
    proc.emit("close", 0);

    await expect(promise).resolves.toBe("Hello from model");
  });

  it("writes the system prompt to a temp file", async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc);

    const client = new LlmClient();
    const promise = client.call("my system prompt", "usr");

    await flushMicrotasks();
    proc.emit("close", 0);
    await promise;

    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining("mlst-llm-"),
      "my system prompt",
      "utf-8",
    );
  });

  it("passes --append-system-prompt, --no-session, --no-extensions, --no-tools flags to pi", async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc);

    const client = new LlmClient();
    const promise = client.call("sys", "my user prompt");

    await flushMicrotasks();
    proc.emit("close", 0);
    await promise;

    const args: string[] = mockSpawn.mock.calls[0][1];
    expect(args).toContain("--no-session");
    expect(args).toContain("--no-extensions");
    expect(args).toContain("--no-tools");
    expect(args).toContain("--append-system-prompt");
    expect(proc.stdin.write).toHaveBeenCalledWith("my user prompt");
  });

  it("does NOT include --model flag when no model provided", async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc);

    const client = new LlmClient();
    const promise = client.call("sys", "usr");

    await flushMicrotasks();
    proc.emit("close", 0);
    await promise;

    const args: string[] = mockSpawn.mock.calls[0][1];
    expect(args).not.toContain("--model");
  });

  it("splices --model at index 6 when model is set", async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc);

    const client = new LlmClient("anthropic/claude-opus-4-6");
    const promise = client.call("sys", "usr");

    await flushMicrotasks();
    proc.emit("close", 0);
    await promise;

    const args: string[] = mockSpawn.mock.calls[0][1];
    expect(args[6]).toBe("--model");
    expect(args[7]).toBe("anthropic/claude-opus-4-6");
  });

  it("resolves with empty string when process exits 0 with no output", async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc);

    const client = new LlmClient();
    const promise = client.call("sys", "usr");

    await flushMicrotasks();
    proc.emit("close", 0);

    await expect(promise).resolves.toBe("");
  });

  it("handles output split across multiple data chunks", async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc);

    const fullLine = messageEndLine("chunked output") + "\n";
    const client = new LlmClient();
    const promise = client.call("sys", "usr");

    await flushMicrotasks();
    proc.stdout.emit("data", Buffer.from(fullLine.slice(0, 10)));
    proc.stdout.emit("data", Buffer.from(fullLine.slice(10)));
    proc.emit("close", 0);

    await expect(promise).resolves.toBe("chunked output");
  });

  it("parses remaining buffer content on close (no trailing newline)", async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc);

    const client = new LlmClient();
    const promise = client.call("sys", "usr");

    await flushMicrotasks();
    // Send line WITHOUT trailing newline — sits in buffer until close
    proc.stdout.emit("data", Buffer.from(messageEndLine("buffered output")));
    proc.emit("close", 0);

    await expect(promise).resolves.toBe("buffered output");
  });

  it("cleans up temp file after successful call", async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc);
    mockUnlinkSync.mockClear();

    const client = new LlmClient();
    const promise = client.call("sys", "usr");

    await flushMicrotasks();
    proc.emit("close", 0);
    await promise;

    expect(mockUnlinkSync).toHaveBeenCalled();
    expect(mockRmdirSync).toHaveBeenCalled();
  });
});

// ─── LlmClient.call() — error paths ──────────────────────────────────────────

describe("LlmClient.call() — error paths", () => {
  beforeEach(() => {
    mockSpawn.mockReset();
  });

  it("rejects when process exits non-zero with no output", async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc);

    const client = new LlmClient();
    const promise = client.call("sys", "usr");

    await flushMicrotasks();
    proc.stderr.emit("data", Buffer.from("pi: command not found"));
    proc.emit("close", 1);

    await expect(promise).rejects.toThrow("LLM exited 1");
  });

  it("includes stderr in the rejection error message", async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc);

    const client = new LlmClient();
    const promise = client.call("sys", "usr");

    await flushMicrotasks();
    proc.stderr.emit("data", Buffer.from("detailed error info"));
    proc.emit("close", 127);

    const err = await promise.catch((e: Error) => e);
    expect((err as Error).message).toContain("detailed error info");
  });

  it("resolves (not rejects) when process exits non-zero but output is present", async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc);

    const client = new LlmClient();
    const promise = client.call("sys", "usr");

    await flushMicrotasks();
    proc.stdout.emit("data", Buffer.from(messageEndLine("partial output") + "\n"));
    proc.emit("close", 1);

    await expect(promise).resolves.toBe("partial output");
  });

  it("rejects when spawn emits an error event", async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc);

    const client = new LlmClient();
    const promise = client.call("sys", "usr");

    await flushMicrotasks();
    proc.emit("error", new Error("ENOENT: pi not found"));

    await expect(promise).rejects.toThrow("LLM spawn failed: ENOENT: pi not found");
  });

  it("cleans up temp file even when the call rejects", async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc);
    mockUnlinkSync.mockClear();

    const client = new LlmClient();
    const promise = client.call("sys", "usr");

    await flushMicrotasks();
    proc.emit("close", 1); // no output → rejects
    await promise.catch(() => {});

    expect(mockUnlinkSync).toHaveBeenCalled();
  });
});

// ─── spawnPi — onProgress streaming ──────────────────────────────────────────

describe("LlmClient.call() — onProgress streaming", () => {
  beforeEach(() => {
    mockSpawn.mockReset();
  });

  it("calls onProgress with streaming text deltas", async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc);

    const onProgress = vi.fn();
    const client = new LlmClient();
    const promise = client.call("sys", "usr", { onProgress });

    await flushMicrotasks();
    proc.stdout.emit("data", Buffer.from(textDeltaLine("Hello ") + "\n"));
    proc.stdout.emit("data", Buffer.from(textDeltaLine("world") + "\n"));
    proc.stdout.emit("data", Buffer.from(messageEndLine("Hello world") + "\n"));
    proc.emit("close", 0);
    await promise;

    expect(onProgress).toHaveBeenCalled();
    const calls = onProgress.mock.calls.map(([t]: [string]) => t);
    expect(calls.some((t) => t.includes("Hello"))).toBe(true);
  });

  it("does not throw when onProgress is not provided", async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc);

    const client = new LlmClient();
    const promise = client.call("sys", "usr");

    await flushMicrotasks();
    proc.stdout.emit("data", Buffer.from(textDeltaLine("Hello") + "\n"));
    proc.stdout.emit("data", Buffer.from(messageEndLine("Hello") + "\n"));
    proc.emit("close", 0);

    await expect(promise).resolves.toBe("Hello");
  });

  it("does not call onProgress for non-text-delta event types", async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc);

    const onProgress = vi.fn();
    const client = new LlmClient();
    const promise = client.call("sys", "usr", { onProgress });

    await flushMicrotasks();
    const toolLine = JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "tool_use_delta", delta: "ignore" } });
    proc.stdout.emit("data", Buffer.from(toolLine + "\n"));
    proc.stdout.emit("data", Buffer.from(messageEndLine("result") + "\n"));
    proc.emit("close", 0);
    await promise;

    expect(onProgress).not.toHaveBeenCalled();
  });
});

// ─── spawnPi — abort signal ───────────────────────────────────────────────────

describe("LlmClient.call() — abort signal", () => {
  beforeEach(() => {
    mockSpawn.mockReset();
  });

  it("sends SIGTERM to the subprocess when the signal is aborted", async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc);

    const controller = new AbortController();
    const client = new LlmClient();
    const promise = client.call("sys", "usr", { signal: controller.signal });

    await flushMicrotasks();
    controller.abort();
    proc.emit("close", 0);

    await promise;
    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("does not kill the subprocess when signal is never aborted", async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc);

    const controller = new AbortController();
    const client = new LlmClient();
    const promise = client.call("sys", "usr", { signal: controller.signal });

    await flushMicrotasks();
    proc.stdout.emit("data", Buffer.from(messageEndLine("ok") + "\n"));
    proc.emit("close", 0);

    await expect(promise).resolves.toBe("ok");
    expect(proc.kill).not.toHaveBeenCalled();
  });
});

// ─── spawnPi — array content blocks ──────────────────────────────────────────

describe("LlmClient.call() — array content blocks", () => {
  beforeEach(() => {
    mockSpawn.mockReset();
  });

  it("joins multiple text content blocks with newline", async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc);

    const line = JSON.stringify({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "Part one" }, { type: "text", text: "Part two" }] },
    });

    const client = new LlmClient();
    const promise = client.call("sys", "usr");

    await flushMicrotasks();
    proc.stdout.emit("data", Buffer.from(line + "\n"));
    proc.emit("close", 0);

    await expect(promise).resolves.toBe("Part one\nPart two");
  });

  it("ignores non-text blocks in array content", async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc);

    const line = JSON.stringify({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "thinking", text: "internal thought" }, { type: "text", text: "visible" }] },
    });

    const client = new LlmClient();
    const promise = client.call("sys", "usr");

    await flushMicrotasks();
    proc.stdout.emit("data", Buffer.from(line + "\n"));
    proc.emit("close", 0);

    await expect(promise).resolves.toBe("visible");
  });
});
