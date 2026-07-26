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
        // alpine:init callback — invoke immediately to register data
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

// ─── Create a fresh mlst data instance for each test ──────────────────────────

type MlstData = Record<string, any>;

function createMlstInstance(): MlstData {
  const factory = loadMlstDataFactory();
  const instance = factory();
  // Wire up Alpine $nextTick stub and $refs stub
  instance.$nextTick = (fn: () => void) => fn();
  instance.$refs = { logScroll: null, orchScroll: null };
  return instance;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Dashboard UI — gate status cards", () => {
  let mlst: MlstData;

  beforeEach(() => {
    mlst = createMlstInstance();
  });

  it("has gates array in Alpine data model", () => {
    expect(mlst.gates).toBeDefined();
    expect(Array.isArray(mlst.gates)).toBe(true);
    expect(mlst.gates).toHaveLength(0);
  });

  it("human_gate events update or add entries in gates array", () => {
    // First event — should add a new entry
    mlst.handleEvent({
      type: "human_gate",
      gate: "post-spec",
      status: "waiting",
      feedbackRounds: 0,
      autonomous: false,
      timestamp: 1000,
    });
    expect(mlst.gates).toHaveLength(1);
    expect(mlst.gates[0].gate).toBe("post-spec");
    expect(mlst.gates[0].status).toBe("waiting");

    // Second event with different gate — should add another entry
    mlst.handleEvent({
      type: "human_gate",
      gate: "post-tasks",
      status: "analyzing",
      feedbackRounds: 0,
      autonomous: false,
      timestamp: 2000,
    });
    expect(mlst.gates).toHaveLength(2);
    expect(mlst.gates[1].gate).toBe("post-tasks");
    expect(mlst.gates[1].status).toBe("analyzing");
  });

  it("gate cards expose correct icon, name, status, and optional summary via helper methods", () => {
    mlst.handleEvent({
      type: "human_gate",
      gate: "post-spec",
      status: "approved",
      feedbackRounds: 1,
      autonomous: false,
      conversationSummary: "User approved with minor feedback",
      timestamp: 1000,
    });

    const gate = mlst.gates[0];
    // Icon
    expect(mlst.gateIcon(gate.status)).toBe("✅");
    // Card class
    expect(mlst.gateCardClass(gate.status)).toBe("gate-approved");
    // Name derivation (post-spec → SPEC via template: g.gate.replace('post-', '').replace('on-', '').toUpperCase())
    const nameText = gate.gate.replace("post-", "").replace("on-", "").toUpperCase();
    expect(nameText).toBe("SPEC");
    // Status
    expect(gate.status).toBe("approved");
    // Summary
    expect(gate.summary).toBe("User approved with minor feedback");

    // Verify all status icon/class mappings
    expect(mlst.gateIcon("waiting")).toBe("⏳");
    expect(mlst.gateIcon("analyzing")).toBe("🔍");
    expect(mlst.gateIcon("reviewing")).toBe("✏️");
    expect(mlst.gateIcon("rejected")).toBe("❌");
    expect(mlst.gateIcon("timeout")).toBe("⏰");

    expect(mlst.gateCardClass("waiting")).toBe("gate-waiting");
    expect(mlst.gateCardClass("analyzing")).toBe("gate-waiting");
    expect(mlst.gateCardClass("reviewing")).toBe("gate-waiting");
    expect(mlst.gateCardClass("rejected")).toBe("gate-rejected");
    expect(mlst.gateCardClass("timeout")).toBe("gate-timeout");
  });

  it("duplicate gate entries (same gate point) are updated in-place, not duplicated", () => {
    // Add initial gate entry
    mlst.handleEvent({
      type: "human_gate",
      gate: "post-spec",
      status: "waiting",
      feedbackRounds: 0,
      autonomous: false,
      timestamp: 1000,
    });
    expect(mlst.gates).toHaveLength(1);

    // Update same gate with new status
    mlst.handleEvent({
      type: "human_gate",
      gate: "post-spec",
      status: "analyzing",
      feedbackRounds: 0,
      autonomous: false,
      timestamp: 2000,
    });
    expect(mlst.gates).toHaveLength(1);
    expect(mlst.gates[0].status).toBe("analyzing");

    // Update again to approved with summary
    mlst.handleEvent({
      type: "human_gate",
      gate: "post-spec",
      status: "approved",
      feedbackRounds: 2,
      autonomous: false,
      conversationSummary: "Approved after 2 rounds",
      timestamp: 3000,
    });
    expect(mlst.gates).toHaveLength(1);
    expect(mlst.gates[0].status).toBe("approved");
    expect(mlst.gates[0].feedbackRounds).toBe(2);
    expect(mlst.gates[0].summary).toBe("Approved after 2 rounds");
    expect(mlst.gates[0].timestamp).toBe(3000);
  });
});
