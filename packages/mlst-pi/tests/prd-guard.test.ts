import { describe, it, expect, vi, beforeAll } from "vitest";

// ─── Module mocks (must precede imports) ─────────────────────────────────────

vi.mock("@mariozechner/pi-tui", () => ({
  Text: class {
    constructor() {}
    render() {
      return null;
    }
    invalidate() {}
  },
}));

vi.mock("../.pi/extensions/mlst/execution-profiles.js", () => ({
  resolveExecutionProfile: () => ({ name: "cloud" }),
}));

// Mock LlmClient so we can detect whether it gets constructed
const LlmClientConstructorSpy = vi.fn();
const LlmClientCallSpy = vi.fn().mockResolvedValue("mocked title");
vi.mock("../.pi/extensions/mlst/llm.js", () => ({
  LlmClient: class MockLlmClient {
    constructor(...args: unknown[]) {
      LlmClientConstructorSpy(...args);
    }
    call = LlmClientCallSpy;
  },
}));

// Mock PrdSession so we can detect whether it gets constructed
const PrdSessionConstructorSpy = vi.fn();
const PrdSessionRunSpy = vi.fn().mockResolvedValue({ filePath: ".mlst/prd-test.md", title: "Test" });
const PrdSessionResumeSpy = vi.fn().mockResolvedValue({ filePath: ".mlst/prd-test.md", title: "Test" });
vi.mock("../.pi/extensions/mlst/prd.js", () => ({
  PrdSession: class MockPrdSession {
    constructor(...args: unknown[]) {
      PrdSessionConstructorSpy(...args);
    }
    run = PrdSessionRunSpy;
    resume = PrdSessionResumeSpy;
  },
  parsePrdFilePath: (p: string) => /\.mlst\/prd-[\w-]+\.md$/.test(p),
}));

import mlstExtension from "../.pi/extensions/mlst/index.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

type CommandHandler = (args: string, ctx: Record<string, unknown>) => Promise<void>;

/**
 * Register mlstExtension with a mock pi API and capture the 'prd' command handler.
 */
function capturePrdHandler(): CommandHandler {
  const handlers = new Map<string, CommandHandler>();
  const mockPi = {
    registerCommand: (name: string, opts: { handler: CommandHandler }) => {
      handlers.set(name, opts.handler);
    },
    on: vi.fn(),
  };

  mlstExtension(mockPi as never);

  const handler = handlers.get("prd");
  if (!handler) {
    throw new Error("prd command was not registered");
  }
  return handler;
}

// ─── handlePrd non-interactive guard ─────────────────────────────────────────

describe("handlePrd non-interactive mode guard", () => {
  let handlePrd: CommandHandler;

  beforeAll(() => {
    handlePrd = capturePrdHandler();
  });

  it("returns early with no error when ctx.ui is undefined", async () => {
    LlmClientConstructorSpy.mockClear();
    PrdSessionConstructorSpy.mockClear();

    const ctx = { cwd: "/tmp/test", ui: undefined };

    // Should not throw
    await handlePrd("some idea", ctx);

    // No LLM or PrdSession construction should have occurred
    expect(LlmClientConstructorSpy).not.toHaveBeenCalled();
    expect(PrdSessionConstructorSpy).not.toHaveBeenCalled();
  });

  it("notifies with warning and returns early when ctx.ui exists but ctx.ui.input is undefined", async () => {
    LlmClientConstructorSpy.mockClear();
    PrdSessionConstructorSpy.mockClear();

    const notifySpy = vi.fn();
    const ctx = {
      cwd: "/tmp/test",
      ui: { notify: notifySpy },  // no `input` method
    };

    await handlePrd("some idea", ctx);

    expect(notifySpy).toHaveBeenCalledWith(
      "The /prd command requires interactive mode.",
      "warning",
    );
    expect(LlmClientConstructorSpy).not.toHaveBeenCalled();
    expect(PrdSessionConstructorSpy).not.toHaveBeenCalled();
  });

  it("proceeds normally when ctx.ui.input is available", async () => {
    LlmClientConstructorSpy.mockClear();
    PrdSessionConstructorSpy.mockClear();
    PrdSessionRunSpy.mockClear();

    const inputSpy = vi.fn().mockResolvedValue("user answer");
    const notifySpy = vi.fn();
    const ctx = {
      cwd: "/tmp/test",
      ui: { notify: notifySpy, input: inputSpy },
      model: { provider: "anthropic", id: "claude-sonnet-4-20250514" },
    };

    await handlePrd("build a dashboard", ctx);

    // PrdSession should have been constructed and run called
    expect(PrdSessionConstructorSpy).toHaveBeenCalled();
    expect(PrdSessionRunSpy).toHaveBeenCalledWith("build a dashboard");
  });

  it("does not construct LlmClient or PrdSession when guard triggers on undefined ctx.ui", async () => {
    LlmClientConstructorSpy.mockClear();
    PrdSessionConstructorSpy.mockClear();

    const ctx = { cwd: "/tmp/test" }; // no ui at all

    await handlePrd("some idea", ctx);

    expect(LlmClientConstructorSpy).not.toHaveBeenCalled();
    expect(PrdSessionConstructorSpy).not.toHaveBeenCalled();
  });

  it("does not construct LlmClient or PrdSession when guard triggers on missing ctx.ui.input", async () => {
    LlmClientConstructorSpy.mockClear();
    PrdSessionConstructorSpy.mockClear();

    const ctx = {
      cwd: "/tmp/test",
      ui: { notify: vi.fn(), setStatus: vi.fn() }, // ui exists but no input
    };

    await handlePrd("some idea", ctx);

    expect(LlmClientConstructorSpy).not.toHaveBeenCalled();
    expect(PrdSessionConstructorSpy).not.toHaveBeenCalled();
  });

  it("guard is placed after the empty-args check", async () => {
    // When args are empty, the usage message is shown (not the interactive mode warning)
    const notifySpy = vi.fn();
    const ctx = {
      cwd: "/tmp/test",
      ui: { notify: notifySpy }, // no input — would trigger guard if reached
    };

    await handlePrd("", ctx);

    // The empty-args check fires first, before the interactive mode guard
    expect(notifySpy).toHaveBeenCalledWith(
      "Usage: /prd <idea> or /prd --resume <slug>",
      "warning",
    );
    // The interactive mode warning should NOT have been shown
    expect(notifySpy).not.toHaveBeenCalledWith(
      "The /prd command requires interactive mode.",
      "warning",
    );
  });
});
