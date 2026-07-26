import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as vm from "node:vm";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// ─── Helper: Load app.js and extract Alpine data factory ─────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_DIR = path.resolve(
  __dirname,
  "../.pi/extensions/mls/dashboard-ui",
);

function loadMlsDataFactory(): () => Record<string, unknown> {
  let dataFactory: (() => Record<string, unknown>) | null = null;

  const sandbox = {
    document: {
      addEventListener(_event: string, cb: () => void) {
        cb();
      },
    },
    Alpine: {
      data(_name: string, factory: () => Record<string, unknown>) {
        dataFactory = factory;
      },
    },
    hljs: {
      getLanguage: () => null,
      highlight: (_code: string) => ({ value: "" }),
      highlightAuto: (_code: string) => ({ value: "" }),
    },
    console,
    Date,
    Math,
    JSON,
    Array,
    Object,
    RegExp,
    String,
    Number,
    Boolean,
    Error,
    parseInt,
    parseFloat,
    isNaN,
    setTimeout: () => 0,
    setInterval: () => 0,
    EventSource: class { onmessage: unknown },
  };

  vm.createContext(sandbox);
  for (const file of ["parsers.js", "handlers.js", "app.js"]) {
    const source = fs.readFileSync(path.join(DASHBOARD_DIR, file), "utf8");
    vm.runInContext(source, sandbox);
  }

  if (!dataFactory) {
    throw new Error("Alpine.data('mls', ...) was not registered by app.js");
  }
  return dataFactory;
}

type MlsData = Record<string, any>;

function createMlsInstance(): MlsData {
  const factory = loadMlsDataFactory();
  const instance = factory();
  instance.$nextTick = (fn: () => void) => fn();
  instance.$refs = { logScroll: null, orchScroll: null };
  return instance;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Dashboard UI — gate cost stat in bottom bar", () => {
  let mls: MlsData;

  beforeEach(() => {
    mls = createMlsInstance();
  });

  it("has gateCost with llmCalls at zero in Alpine data model", () => {
    expect(mls.gateCost).toBeDefined();
    expect(mls.gateCost).toEqual({ llmCalls: 0 });
  });

  it("increments gateCost.llmCalls on human_gate events with status analyzing or reviewing", () => {
    mls.handleEvent({
      type: "human_gate",
      gate: "post-spec",
      status: "analyzing",
      feedbackRounds: 0,
      autonomous: false,
      timestamp: 1000,
    });
    expect(mls.gateCost.llmCalls).toBe(1);

    mls.handleEvent({
      type: "human_gate",
      gate: "post-spec",
      status: "reviewing",
      feedbackRounds: 1,
      autonomous: false,
      timestamp: 2000,
    });
    expect(mls.gateCost.llmCalls).toBe(2);
  });

  it("does not increment gateCost.llmCalls on human_gate events with non-LLM statuses", () => {
    mls.handleEvent({
      type: "human_gate",
      gate: "post-spec",
      status: "waiting",
      feedbackRounds: 0,
      autonomous: false,
      timestamp: 1000,
    });
    expect(mls.gateCost.llmCalls).toBe(0);

    mls.handleEvent({
      type: "human_gate",
      gate: "post-spec",
      status: "approved",
      feedbackRounds: 0,
      autonomous: false,
      timestamp: 2000,
    });
    expect(mls.gateCost.llmCalls).toBe(0);

    mls.handleEvent({
      type: "human_gate",
      gate: "post-spec",
      status: "rejected",
      feedbackRounds: 0,
      autonomous: false,
      timestamp: 3000,
    });
    expect(mls.gateCost.llmCalls).toBe(0);
  });

  it("resets gateCost.llmCalls to zero on sprint_start (backward compatible)", () => {
    // Accumulate some gate cost
    mls.handleEvent({
      type: "human_gate",
      gate: "post-spec",
      status: "analyzing",
      feedbackRounds: 0,
      autonomous: false,
      timestamp: 1000,
    });
    expect(mls.gateCost.llmCalls).toBe(1);

    // New sprint resets
    mls.handleEvent({
      type: "sprint_start",
      input: "test input",
      classification: "feature",
      timestamp: 2000,
    });
    expect(mls.gateCost.llmCalls).toBe(0);
  });
});
