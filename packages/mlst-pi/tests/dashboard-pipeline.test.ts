import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as vm from "node:vm";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_DIR = path.resolve(
  __dirname,
  "../.pi/extensions/mlst/dashboard-ui",
);

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
  // Load scripts in dependency order (same as index.html)
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

describe("Dashboard UI — pipeline tracking", () => {
  let mlst: MlstData;

  beforeEach(() => {
    mlst = createMlstInstance();
    mlst.handleEvent({
      type: "sprint_start",
      input: "build feature",
      classification: "feature",
      timestamp: 1000,
    });
  });

  it("treats scaffold as an unknown phase without its own pipeline card", () => {
    mlst.handleEvent({
      type: "phase",
      phase: "scaffold",
      timestamp: 1100,
    });

    // Scaffold is a sub-step of phase3, not a top-level pipeline step
    const scaffoldStep = mlst.taskView.find((item: { id: string }) => item.id === "scaffold");
    expect(scaffoldStep).toBeUndefined();
    // But earlier steps should be marked complete
    const phase0 = mlst.taskView.find((item: { id: string }) => item.id === "phase0");
    expect(phase0.status).toBe("complete");
  });

  it("applies phase-agent progress updates to the synthetic pipeline step", () => {
    mlst.handleEvent({
      type: "phase",
      phase: "phase1",
      timestamp: 1100,
    });
    mlst.handleEvent({
      type: "agent_start",
      agent: "mlst-spec-writer",
      prompt: "write spec",
      taskLabel: "",
      timestamp: 1200,
    });
    mlst.handleEvent({
      type: "agent_progress",
      agent: "mlst-spec-writer",
      taskLabel: "",
      text: "Drafting acceptance criteria",
      toolCount: 2,
      timestamp: 1300,
    });

    const phaseStep = mlst.taskView.find((item: { id: string }) => item.id === "phase1");
    expect(phaseStep.activeAgent).toBeDefined();
    expect(phaseStep.activeAgent.progress).toBe("Drafting acceptance criteria");
    expect(phaseStep.activeAgent.toolCount).toBe(2);
  });

  it("keeps phase4 pending for review-only runs that stop after phase2", () => {
    mlst.handleEvent({
      type: "phase",
      phase: "phase1",
      timestamp: 1100,
    });
    mlst.handleEvent({
      type: "phase",
      phase: "phase2",
      timestamp: 1200,
    });
    mlst.handleEvent({
      type: "sprint_end",
      summary: "Review-only: spec + tasks produced. Resume with --resume.",
      timestamp: 1300,
    });

    const phase4Step = mlst.taskView.find((item: { id: string }) => item.id === "phase4");
    expect(phase4Step).toBeDefined();
    expect(phase4Step.status).toBe("pending");
  });
});
