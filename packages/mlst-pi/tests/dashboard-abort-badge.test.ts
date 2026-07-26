import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as vm from "node:vm";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// ─── Helper: Load app.js and extract Alpine data factory ─────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_DIR = path.resolve(
  __dirname,
  "../.pi/extensions/mlst/dashboard-ui",
);

/**
 * Evaluate app.js in a sandboxed context that mocks browser globals,
 * then return the Alpine.data factory function so we can instantiate
 * the mlst() data object for testing.
 */
function loadMlstDataFactory(): () => Record<string, unknown> {
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
    EventSource: class { onmessage: unknown; },
  };

  vm.createContext(sandbox);
  for (const file of ["parsers.js", "handlers.js", "app.js"]) {
    const source = fs.readFileSync(path.join(DASHBOARD_DIR, file), "utf8");
    vm.runInContext(source, sandbox);
  }

  if (!dataFactory) {
    throw new Error("Alpine.data('mlst', ...) was not registered by app.js");
  }
  return dataFactory;
}

type MlstData = Record<string, any>;

function createMlstInstance(): MlstData {
  const factory = loadMlstDataFactory();
  const instance = factory();
  instance.$nextTick = (fn: () => void) => fn();
  instance.$refs = { logScroll: null, orchScroll: null };
  return instance;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Dashboard UI — aborted badge & sprint_end abort handling", () => {
  let mlst: MlstData;

  beforeEach(() => {
    mlst = createMlstInstance();
    // Start a sprint so status is "running"
    mlst.handleEvent({
      type: "sprint_start",
      input: "build feature",
      classification: "feature",
      timestamp: Date.now(),
    });
  });

  it("handleEvent sets status to aborted when sprint_end has aborted: true", () => {
    mlst.handleEvent({
      type: "sprint_end",
      summary: "Sprint was aborted due to gate rejection",
      aborted: true,
      abortReason: "User chose to abort",
      timestamp: Date.now(),
    });

    expect(mlst.status).toBe("aborted");
  });

  it("top bar badge displays ABORTED with the aborted CSS class", () => {
    mlst.handleEvent({
      type: "sprint_end",
      summary: "Sprint aborted",
      aborted: true,
      abortReason: "Too many failures",
      timestamp: Date.now(),
    });

    // The badge uses :class="status" and x-text="status.toUpperCase()"
    // So when status is "aborted", the badge gets class "aborted" and text "ABORTED"
    expect(mlst.status).toBe("aborted");
    expect(mlst.status.toUpperCase()).toBe("ABORTED");
  });

  it("normal sprint completions still show COMPLETE", () => {
    mlst.handleEvent({
      type: "sprint_end",
      summary: "All tasks completed successfully",
      timestamp: Date.now(),
    });

    expect(mlst.status).toBe("complete");
    expect(mlst.status.toUpperCase()).toBe("COMPLETE");
  });
});
