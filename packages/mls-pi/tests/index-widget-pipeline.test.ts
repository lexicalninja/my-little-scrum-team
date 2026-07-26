import { describe, it, expect, vi } from "vitest";

vi.mock("@mariozechner/pi-tui", () => ({
  Text: class {
    constructor() {}
    render() {
      return null;
    }
    invalidate() {}
  },
}));

vi.mock("../.pi/extensions/mls/execution-profiles.js", () => ({
  resolveExecutionProfile: () => ({ name: "cloud" }),
}));

import { __test__ } from "../.pi/extensions/mls/index.js";

describe("MLS widget pipeline state", () => {
  it("treats scaffold as an unknown phase without its own pipeline step", () => {
    const widget = __test__.createWidgetState();

    __test__.applyWidgetEvent(widget, {
      type: "phase",
      phase: "scaffold",
      timestamp: Date.now(),
    });

    // Scaffold is a sub-step of phase3, not a top-level pipeline step
    const scaffoldStep = widget.pipeline.find((step) => step.id === "scaffold");
    expect(scaffoldStep).toBeUndefined();
    // But it should be tracked as the active pipeline context
    expect(widget.activePipelineId).toBe("scaffold");
    // And earlier steps should be marked complete
    const phase0 = widget.pipeline.find((step) => step.id === "phase0");
    expect(phase0?.status).toBe("complete");
  });

  it("keeps phase4 pending when a review-only sprint ends after phase2", () => {
    const widget = __test__.createWidgetState();

    __test__.applyWidgetEvent(widget, {
      type: "phase",
      phase: "phase1",
      timestamp: Date.now(),
    });
    __test__.applyWidgetEvent(widget, {
      type: "phase",
      phase: "phase2",
      timestamp: Date.now(),
    });
    __test__.applyWidgetEvent(widget, {
      type: "sprint_end",
      summary: "Review-only: spec + tasks produced. Resume with --resume.",
      timestamp: Date.now(),
    });

    const phase4Step = widget.pipeline.find((step) => step.id === "phase4");
    expect(phase4Step?.status).toBe("pending");
  });
});
