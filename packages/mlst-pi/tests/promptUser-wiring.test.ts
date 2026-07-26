/**
 * Tests for the promptUser adapter wiring in handlePrd (index.ts).
 *
 * These tests verify that the promptUser callback passed to PrdSession
 * correctly delegates to ctx.ui.input() and handles all return values.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrdSessionDeps } from "../.pi/extensions/mlst/prd.js";

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Mock pi-tui (required by index.ts)
vi.mock("@mariozechner/pi-tui", () => ({
  Text: class {
    constructor() {}
    render() {
      return null;
    }
    invalidate() {}
  },
}));

// Capture the deps passed to PrdSession constructor
let capturedDeps: PrdSessionDeps | null = null;

vi.mock("../.pi/extensions/mlst/prd.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../.pi/extensions/mlst/prd.js")>();
  return {
    ...original,
    PrdSession: class {
      constructor(deps: PrdSessionDeps) {
        capturedDeps = deps;
      }
      async run(_input: string) {
        return { filePath: ".mlst/prd-test.md", title: "Test" };
      }
      async resume(_slug: string) {
        return { filePath: ".mlst/prd-test.md", title: "Test" };
      }
    },
  };
});

// Mock LlmClient so no subprocesses are spawned
vi.mock("../.pi/extensions/mlst/llm.js", () => ({
  LlmClient: class {
    constructor() {}
    async call() {
      return "mocked response";
    }
  },
}));

// Mock other dependencies that index.ts imports
vi.mock("../.pi/extensions/mlst/agents.js", () => ({
  loadAgents: () => [],
  rateThrottle: { applyProfile: () => {} },
  loadProviderProfile: () => ({ concurrency: 1, spawnDelayMs: 0 }),
}));

vi.mock("../.pi/extensions/mlst/execution-profiles.js", () => ({
  resolveExecutionProfile: () => ({ name: "test" }),
}));

vi.mock("../.pi/extensions/mlst/skills.js", () => ({
  SkillLoader: class {
    load() {}
  },
}));

vi.mock("../.pi/extensions/mlst/state.js", () => ({
  StateManager: class {
    getState() {
      return { phase: "idle" };
    }
  },
}));

vi.mock("../.pi/extensions/mlst/context.js", () => ({
  ContextAssembler: class {},
}));

vi.mock("../.pi/extensions/mlst/quality-gates.js", () => ({
  QualityGates: class {},
}));

vi.mock("../.pi/extensions/mlst/db.js", () => ({
  MlstDatabase: class {},
}));

vi.mock("../.pi/extensions/mlst/dashboard.js", () => ({
  Dashboard: class {},
}));

vi.mock("../.pi/extensions/mlst/orchestrator/index.js", () => ({
  Orchestrator: class {},
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

type CommandHandler = (args: string, ctx: Record<string, unknown>) => Promise<void>;

/** Register the extension and capture the /prd command handler. */
async function getPrdHandler(): Promise<CommandHandler> {
  const { default: mlstExtension } = await import("../.pi/extensions/mlst/index.js");
  const handlers: Record<string, CommandHandler> = {};

  const mockPi = {
    registerCommand: (name: string, opts: { handler: CommandHandler }) => {
      handlers[name] = opts.handler;
    },
    on: () => {},
    appendEntry: () => {},
  };

  mlstExtension(mockPi as never);
  return handlers["prd"]!;
}

function createMockCtx(inputMock?: (...args: unknown[]) => Promise<string | undefined>) {
  return {
    cwd: "/tmp/test-promptuser",
    model: { provider: "anthropic", id: "test-model" },
    ui: {
      notify: vi.fn(),
      setStatus: vi.fn(),
      setWidget: vi.fn(),
      setWorkingMessage: vi.fn(),
      input: inputMock ?? vi.fn().mockResolvedValue("user answer"),
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("promptUser wiring in handlePrd", () => {
  beforeEach(() => {
    capturedDeps = null;
  });

  it("calls ctx.ui.input() with the question prompt as first argument and empty string as placeholder", async () => {
    const inputMock = vi.fn().mockResolvedValue("some answer");
    const ctx = createMockCtx(inputMock);
    const handler = await getPrdHandler();

    await handler("test idea", ctx);

    // The handler should have constructed PrdSession with deps containing our promptUser
    expect(capturedDeps).not.toBeNull();

    // Call the captured promptUser with a test prompt
    await capturedDeps!.promptUser("What is the problem?");

    // Verify ctx.ui.input was called with the prompt as first arg and "" as placeholder
    expect(inputMock).toHaveBeenCalledWith("What is the problem?", "");
  });

  it("returns the string when ctx.ui.input() returns a non-empty string", async () => {
    const inputMock = vi.fn().mockResolvedValue("Teams lack visibility");
    const ctx = createMockCtx(inputMock);
    const handler = await getPrdHandler();

    await handler("test idea", ctx);
    expect(capturedDeps).not.toBeNull();

    const result = await capturedDeps!.promptUser("Problem Statement");
    expect(result).toBe("Teams lack visibility");
  });

  it("returns empty string when ctx.ui.input() returns undefined (Escape/cancel)", async () => {
    const inputMock = vi.fn().mockResolvedValue(undefined);
    const ctx = createMockCtx(inputMock);
    const handler = await getPrdHandler();

    await handler("test idea", ctx);
    expect(capturedDeps).not.toBeNull();

    const result = await capturedDeps!.promptUser("Problem Statement");
    expect(result).toBe("");
  });

  it("returns empty string when ctx.ui.input() returns empty string (Enter with no text)", async () => {
    const inputMock = vi.fn().mockResolvedValue("");
    const ctx = createMockCtx(inputMock);
    const handler = await getPrdHandler();

    await handler("test idea", ctx);
    expect(capturedDeps).not.toBeNull();

    const result = await capturedDeps!.promptUser("Problem Statement");
    expect(result).toBe("");
  });

  it("does not contain the old ctx.ui.notify(prompt, 'info') call pattern in promptUser", async () => {
    const inputMock = vi.fn().mockResolvedValue("answer");
    const notifyMock = vi.fn();
    const ctx = {
      cwd: "/tmp/test-promptuser",
      model: { provider: "anthropic", id: "test-model" },
      ui: {
        notify: notifyMock,
        setStatus: vi.fn(),
        setWidget: vi.fn(),
        setWorkingMessage: vi.fn(),
        input: inputMock,
      },
    };
    const handler = await getPrdHandler();

    await handler("test idea", ctx);
    expect(capturedDeps).not.toBeNull();

    // Clear any notify calls made during handler setup (e.g., progress notifications)
    notifyMock.mockClear();

    // Call promptUser — it should NOT call notify with the prompt
    await capturedDeps!.promptUser("What is the problem?");

    // The old implementation called ctx.ui.notify(prompt, 'info') — that should be gone.
    // Verify notify was NOT called with the prompt string at 'info' level
    const infoCallsWithPrompt = notifyMock.mock.calls.filter(
      ([msg, level]: [string, string]) => msg === "What is the problem?" && level === "info"
    );
    expect(infoCallsWithPrompt).toHaveLength(0);
  });

  it("source code does not contain TODO comments in the promptUser section", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const src: string = fs.readFileSync(
      path.resolve(__dirname, "..", ".pi", "extensions", "mlst", "index.ts"),
      "utf-8",
    );

    // Extract the promptUser section (between "promptUser:" and the next property or closing brace)
    const promptUserMatch = src.match(/promptUser:\s*async[\s\S]*?(?=\n\s{6}\w+:|^\s{4}\};)/m);
    if (promptUserMatch) {
      expect(promptUserMatch[0]).not.toMatch(/\/\/\s*TODO/i);
      expect(promptUserMatch[0]).not.toMatch(/\/\/\s*\.\.\./);
    }
  });
});
