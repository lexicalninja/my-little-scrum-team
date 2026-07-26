import { describe, it, expect, vi, beforeEach } from "vitest";
import { Orchestrator, type OrchestratorDeps } from "../.pi/extensions/mls/orchestrator/index.js";
import type { AgentResult, GatePoint, TaskState } from "../.pi/extensions/mls/types.js";

// Mock spawnAgent
vi.mock("../.pi/extensions/mls/agents.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../.pi/extensions/mls/agents.js")>();
  return {
    ...actual,
    spawnAgent: vi.fn().mockResolvedValue({
      agent: "mock-agent",
      task: "",
      exitCode: 0,
      output: "mock agent output",
      stderr: "",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 1 },
      model: "test-model",
    } satisfies AgentResult),
  };
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTask(overrides: Partial<TaskState> = {}): TaskState {
  return {
    id: "TASK-001",
    label: "T1",
    title: "task title",
    type: "Implementation" as const,
    status: "pending" as const,
    dependencies: [],
    parallelWith: [],
    acceptanceCriteria: ["criterion"],
    filesAffected: [],
    assignedAgent: "mls-impl-engineer",
    iterationCount: 0,
    ...overrides,
  };
}

function buildDeps(overrides: Partial<OrchestratorDeps> = {}): OrchestratorDeps {
  const tasks: TaskState[] = [];

  const state = {
    setPhase: vi.fn(),
    getPhase: vi.fn().mockReturnValue("idle"),
    getState: vi.fn().mockReturnValue({
      phase: "idle",
      tasks,
      input: "",
      maxReviewIterations: 3,
      maxTestRetries: 3,
      startedAt: new Date().toISOString(),
    }),
    setTasks: vi.fn(),
    getTask: vi.fn().mockImplementation((id: string) => ({
      status: "complete",
      label: id,
      title: "task title",
      id,
    })),
    getTasksByStatus: vi.fn().mockImplementation((status: string) =>
      tasks.filter((t) => t.status === status),
    ),
    getTasksByType: vi.fn().mockReturnValue([]),
    updateTask: vi.fn(),
    setSpecification: vi.fn(),
    setClassification: vi.fn(),
    setMaxIterations: vi.fn(),
    reset: vi.fn(),
    restore: vi.fn(),
    complete: vi.fn(),
    getStatusSummary: vi.fn().mockReturnValue(""),
    setWidget: vi.fn(),
  } as unknown as OrchestratorDeps["state"];

  const defaults: OrchestratorDeps = {
    state,
    skills: {
      getOrchestratorSkill: vi.fn().mockReturnValue(""),
      getSkillsForAgent: vi.fn().mockReturnValue(""),
      getAgentSkills: vi.fn().mockReturnValue(""),
      load: vi.fn(),
    } as unknown as OrchestratorDeps["skills"],
    context: {
      buildSpecPrompt: vi.fn().mockReturnValue(""),
      buildTaskBreakdownPrompt: vi.fn().mockReturnValue(""),
      buildBugFixPrompt: vi.fn().mockReturnValue(""),
      buildImplFromSpecPrompt: vi.fn().mockReturnValue(""),
      buildScaffoldPrompt: vi.fn().mockReturnValue(""),
      buildDesignPrompt: vi.fn().mockReturnValue(""),
      buildInfraPrompt: vi.fn().mockReturnValue(""),
      buildDocPrompt: vi.fn().mockReturnValue(""),
      buildTestFromCriteriaPrompt: vi.fn().mockReturnValue(""),
      buildImplFromTestsPrompt: vi.fn().mockReturnValue(""),
      buildReviewPrompt: vi.fn().mockReturnValue(""),
      buildReviewPromptSimple: vi.fn().mockReturnValue(""),
      buildReviewFixPrompt: vi.fn().mockReturnValue(""),
      buildTestFixPrompt: vi.fn().mockReturnValue(""),
      buildTestPrompt: vi.fn().mockReturnValue(""),
      buildTestPromptSimple: vi.fn().mockReturnValue(""),
    } as unknown as OrchestratorDeps["context"],
    gates: {
      taskBreakdownValid: vi.fn().mockReturnValue({ passed: true, issues: [] }),
      checkDeletions: vi.fn().mockReturnValue({ tier: "normal", filesDeleted: [], linesRemoved: 0, linesAdded: 0 }),
      testsPass: vi.fn().mockReturnValue(true),
    } as unknown as OrchestratorDeps["gates"],
    llm: {
      call: vi.fn().mockResolvedValue("LLM summary text"),
    } as unknown as OrchestratorDeps["llm"],
    db: {
      getOrCreateProject: vi.fn().mockReturnValue({ id: 1 }),
      createSprint: vi.fn().mockReturnValue({ id: 1 }),
      updateSprint: vi.fn(),
      createIssue: vi.fn().mockReturnValue({ id: 1 }),
      updateIssue: vi.fn(),
      getOrCreateLabel: vi.fn().mockReturnValue({ id: 1 }),
      addLabelToIssue: vi.fn(),
      getSprint: vi.fn().mockReturnValue(null),
      getLatestSprint: vi.fn().mockReturnValue(null),
      getSprintIssues: vi.fn().mockReturnValue([]),
    } as unknown as OrchestratorDeps["db"],
    agents: [],
    profile: {
      name: "test",
      group1Concurrency: 1,
      group2Concurrency: 1,
      maxReviewIterations: 3,
      maxTestRetries: 3,
      enablePhase0: false,
      enableSpecGate: false,
      enableReviewGate: false,
      sequentialGroup1: true,
      skipAgentsMdExtraction: true,
      humanGates: [],
      pipelineMode: "full",
    },
    cwd: "/tmp",
    model: undefined,
    signal: undefined,
    notify: vi.fn(),
    sendMessage: vi.fn(),
    exec: vi.fn().mockResolvedValue({ stdout: "", stderr: "", code: 0 }),
    emit: vi.fn(),
    onAgentProgress: undefined,
    setWorkingMessage: vi.fn(),
    promptUser: vi.fn().mockResolvedValue(null),
  };

  return { ...defaults, ...overrides };
}

// ─── humanGate() auto-approve when gate not in profile ───────────────────────

describe("humanGate() — auto-approve behavior", () => {
  it("returns auto-approved with no LLM analysis when gate not in profile", async () => {
    const deps = buildDeps({
      profile: {
        ...buildDeps().profile,
        humanGates: [], // No gates enabled
      },
    });
    const orchestrator = new Orchestrator(deps);

    const result = await (orchestrator as any).humanGate("post-spec", "some artifact");

    expect(result.approved).toBe(true);
    expect(result.autonomous).toBe(true);
    expect(result.feedbackRounds).toBe(0);
    // Should NOT have called llm.call for analysis
    expect(deps.llm.call).not.toHaveBeenCalled();
  });

  it("does not emit any human_gate event when gate not in profile", async () => {
    const deps = buildDeps({
      profile: {
        ...buildDeps().profile,
        humanGates: [],
      },
    });
    const orchestrator = new Orchestrator(deps);

    await (orchestrator as any).humanGate("post-spec", "artifact");

    const gateEvents = vi.mocked(deps.emit).mock.calls
      .filter(([ev]) => ev.type === "human_gate");
    expect(gateEvents).toHaveLength(0);
  });
});

// ─── humanGate() LLM analysis pass ──────────────────────────────────────────

describe("humanGate() — LLM analysis", () => {
  it("runs LLM analysis pass before first promptUser call when gate is enabled", async () => {
    const callOrder: string[] = [];
    const deps = buildDeps({
      profile: {
        ...buildDeps().profile,
        humanGates: ["post-spec"],
      },
      llm: {
        call: vi.fn().mockImplementation(() => {
          callOrder.push("llm");
          return Promise.resolve("Analysis: spec looks good, 2 questions");
        }),
      } as any,
      promptUser: vi.fn().mockImplementation(() => {
        callOrder.push("promptUser");
        return Promise.resolve("approve");
      }),
    });
    const orchestrator = new Orchestrator(deps);

    await (orchestrator as any).humanGate("post-spec", "the spec");

    expect(callOrder[0]).toBe("llm"); // LLM analysis happens first
    expect(callOrder[1]).toBe("promptUser"); // Then human is prompted
  });

  it("includes analysis output in sendMessage before prompting", async () => {
    const deps = buildDeps({
      profile: {
        ...buildDeps().profile,
        humanGates: ["post-spec"],
      },
      promptUser: vi.fn().mockResolvedValue("approve"),
    });
    vi.mocked(deps.llm.call).mockResolvedValue("Analysis: missing acceptance criteria");
    const orchestrator = new Orchestrator(deps);

    await (orchestrator as any).humanGate("post-spec", "the spec");

    expect(deps.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining("Gate Review: post-spec"),
    );
    expect(deps.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining("Analysis: missing acceptance criteria"),
    );
  });

  it("includes the full artifact text in sendMessage so the human can review it", async () => {
    const deps = buildDeps({
      profile: {
        ...buildDeps().profile,
        humanGates: ["post-spec"],
      },
      promptUser: vi.fn().mockResolvedValue("approve"),
    });
    vi.mocked(deps.llm.call).mockResolvedValue("Analysis output");
    const orchestrator = new Orchestrator(deps);

    await (orchestrator as any).humanGate("post-spec", "Full specification content here");

    expect(deps.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining("Full specification content here"),
    );
  });
});

// ─── humanGate() multi-turn loop ────────────────────────────────────────────

describe("humanGate() — multi-turn feedback loop", () => {
  it("tracks feedbackRounds correctly when human provides feedback then approves", async () => {
    let callCount = 0;
    const deps = buildDeps({
      profile: {
        ...buildDeps().profile,
        humanGates: ["post-spec"],
      },
      promptUser: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve("add error handling section");
        return Promise.resolve("approve");
      }),
    });
    vi.mocked(deps.llm.call).mockResolvedValue("Revised spec with error handling");
    const orchestrator = new Orchestrator(deps);

    const result = await (orchestrator as any).humanGate("post-spec", "original spec");

    expect(result.approved).toBe(true);
    expect(result.autonomous).toBe(false);
    expect(result.feedbackRounds).toBe(1);
    expect(result.revisedArtifact).toBeDefined();
  });

  it("calls LLM reconciliation when human provides feedback", async () => {
    let callCount = 0;
    const deps = buildDeps({
      profile: {
        ...buildDeps().profile,
        humanGates: ["post-tasks"],
      },
      promptUser: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve("add a testing task");
        return Promise.resolve("approve");
      }),
    });
    const llmCalls: string[] = [];
    vi.mocked(deps.llm.call).mockImplementation((system: string) => {
      llmCalls.push(system.slice(0, 50));
      return Promise.resolve("Reconciled output");
    });
    const orchestrator = new Orchestrator(deps);

    await (orchestrator as any).humanGate("post-tasks", "task list");

    // At least 2 LLM calls: 1 analysis + 1 reconciliation
    expect(vi.mocked(deps.llm.call).mock.calls.length).toBeGreaterThanOrEqual(2);
    // The reconciliation call should mention "user" and "feedback"
    const reconciliationCall = vi.mocked(deps.llm.call).mock.calls.find(
      ([sys]) => sys.includes("user provided feedback"),
    );
    expect(reconciliationCall).toBeDefined();
  });

  it("force-proceeds after 3 feedback rounds without approval", async () => {
    const deps = buildDeps({
      profile: {
        ...buildDeps().profile,
        humanGates: ["post-spec"],
      },
      promptUser: vi.fn().mockResolvedValue("needs more work"), // Never approves
    });
    vi.mocked(deps.llm.call).mockResolvedValue("Reconciled");
    const orchestrator = new Orchestrator(deps);

    const result = await (orchestrator as any).humanGate("post-spec", "artifact");

    expect(result.approved).toBe(true); // Force-approved after max rounds
    expect(result.feedbackRounds).toBe(3);
    expect(deps.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining("Proceeding with current version after 3 rounds"),
    );
  });

  it("auto-approves with autonomous=true when promptUser returns null (timeout/CI)", async () => {
    const deps = buildDeps({
      profile: {
        ...buildDeps().profile,
        humanGates: ["post-spec"],
      },
      promptUser: vi.fn().mockResolvedValue(null),
    });
    const orchestrator = new Orchestrator(deps);

    const result = await (orchestrator as any).humanGate("post-spec", "artifact");

    expect(result.approved).toBe(true);
    expect(result.autonomous).toBe(true);
  });
});

// ─── gateAnnotation ─────────────────────────────────────────────────────────

describe("humanGate() — gateAnnotation", () => {
  it("captures human constraints in gateAnnotation when approved after feedback", async () => {
    let callCount = 0;
    const deps = buildDeps({
      profile: {
        ...buildDeps().profile,
        humanGates: ["post-spec"],
      },
      promptUser: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve("must use PostgreSQL, not MySQL");
        return Promise.resolve("approve");
      }),
    });
    vi.mocked(deps.llm.call).mockResolvedValue("Revised");
    const orchestrator = new Orchestrator(deps);

    const result = await (orchestrator as any).humanGate("post-spec", "spec");

    expect(result.gateAnnotation).toBeDefined();
    expect(result.gateAnnotation).toContain("must use PostgreSQL");
    expect(result.gateAnnotation).toContain("Round 1");
  });

  it("returns gateAnnotation indicating first-prompt approval when no feedback", async () => {
    const deps = buildDeps({
      profile: {
        ...buildDeps().profile,
        humanGates: ["post-spec"],
      },
      promptUser: vi.fn().mockResolvedValue("approve"),
    });
    const orchestrator = new Orchestrator(deps);

    const result = await (orchestrator as any).humanGate("post-spec", "spec");

    expect(result.gateAnnotation).toContain("first prompt");
  });
});

// ─── human_gate event emission ──────────────────────────────────────────────

describe("humanGate() — event emission", () => {
  it("emits human_gate events with correct status transitions", async () => {
    const deps = buildDeps({
      profile: {
        ...buildDeps().profile,
        humanGates: ["post-spec"],
      },
      promptUser: vi.fn().mockResolvedValue("approve"),
    });
    const orchestrator = new Orchestrator(deps);

    await (orchestrator as any).humanGate("post-spec", "artifact");

    const gateEvents = vi.mocked(deps.emit).mock.calls
      .filter(([ev]) => ev.type === "human_gate")
      .map(([ev]) => ev);

    // Should have: analyzing → waiting → approved
    expect(gateEvents.length).toBeGreaterThanOrEqual(2);
    expect(gateEvents[0].status).toBe("analyzing");
    expect(gateEvents[1].status).toBe("waiting");
    expect(gateEvents[gateEvents.length - 1].status).toBe("approved");
  });

  it("emits timeout status when promptUser returns null", async () => {
    const deps = buildDeps({
      profile: {
        ...buildDeps().profile,
        humanGates: ["post-tasks"],
      },
      promptUser: vi.fn().mockResolvedValue(null),
    });
    const orchestrator = new Orchestrator(deps);

    await (orchestrator as any).humanGate("post-tasks", "tasks");

    const gateEvents = vi.mocked(deps.emit).mock.calls
      .filter(([ev]) => ev.type === "human_gate")
      .map(([ev]) => ev);

    const timeoutEvent = gateEvents.find((ev) => ev.status === "timeout");
    expect(timeoutEvent).toBeDefined();
    expect(timeoutEvent?.autonomous).toBe(true);
  });
});

// ─── Approval keyword variants ──────────────────────────────────────────────

describe("humanGate() — approval keywords", () => {
  for (const keyword of ["approve", "approved", "yes", "done", "lgtm", "ok", "looks good"]) {
    it(`accepts "${keyword}" as approval`, async () => {
      const deps = buildDeps({
        profile: {
          ...buildDeps().profile,
          humanGates: ["post-spec"],
        },
        promptUser: vi.fn().mockResolvedValue(keyword),
      });
      const orchestrator = new Orchestrator(deps);

      const result = await (orchestrator as any).humanGate("post-spec", "artifact");

      expect(result.approved).toBe(true);
      expect(result.autonomous).toBe(false);
    });
  }
});

// ─── handleEscalationGate ───────────────────────────────────────────────────

describe("handleEscalationGate()", () => {
  it("returns 'escalate' when on-escalation gate not in profile", async () => {
    const deps = buildDeps({
      profile: {
        ...buildDeps().profile,
        humanGates: [], // no escalation gate
      },
    });
    const orchestrator = new Orchestrator(deps);
    const task = makeTask();

    const action = await (orchestrator as any).handleEscalationGate(task, "review", 3);

    expect(action).toBe("escalate");
    expect(deps.llm.call).not.toHaveBeenCalled();
  });

  it("returns 'escalate' when promptUser returns null (timeout/CI)", async () => {
    const deps = buildDeps({
      profile: {
        ...buildDeps().profile,
        humanGates: ["on-escalation"],
      },
      promptUser: vi.fn().mockResolvedValue(null),
    });
    const orchestrator = new Orchestrator(deps);
    const task = makeTask();

    const action = await (orchestrator as any).handleEscalationGate(task, "review", 3);

    expect(action).toBe("escalate");
  });

  it("returns the human's chosen action when promptUser responds", async () => {
    for (const choice of ["retry", "skip", "abort"] as const) {
      const deps = buildDeps({
        profile: {
          ...buildDeps().profile,
          humanGates: ["on-escalation"],
        },
        promptUser: vi.fn().mockResolvedValue(choice),
      });
      const orchestrator = new Orchestrator(deps);
      const task = makeTask();

      const action = await (orchestrator as any).handleEscalationGate(task, "review", 3);

      expect(action).toBe(choice);
    }
  });

  it("defaults to 'escalate' for unrecognized input", async () => {
    const deps = buildDeps({
      profile: {
        ...buildDeps().profile,
        humanGates: ["on-escalation"],
      },
      promptUser: vi.fn().mockResolvedValue("I'm not sure what to do"),
    });
    const orchestrator = new Orchestrator(deps);
    const task = makeTask();

    const action = await (orchestrator as any).handleEscalationGate(task, "review", 3);

    expect(action).toBe("escalate");
  });
});

// ─── AbortController ownership ──────────────────────────────────────────────

describe("Orchestrator AbortController", () => {
  it("chains external abort signal to internal controller", async () => {
    const external = new AbortController();
    const deps = buildDeps({ signal: external.signal });
    const orchestrator = new Orchestrator(deps);

    // Access the internal controller
    const controller = (orchestrator as any).controller as AbortController;
    expect(controller.signal.aborted).toBe(false);

    // Abort the external signal
    external.abort();

    // Internal controller should also be aborted
    expect(controller.signal.aborted).toBe(true);
  });

  it("creates an independent controller when no external signal", () => {
    const deps = buildDeps({ signal: undefined });
    const orchestrator = new Orchestrator(deps);

    const controller = (orchestrator as any).controller as AbortController;
    expect(controller.signal.aborted).toBe(false);
  });
});

// ─── Gate annotations propagation ───────────────────────────────────────────

describe("gate annotations", () => {
  it("stores gate annotation and makes it available for prompt injection", async () => {
    let callCount = 0;
    const deps = buildDeps({
      profile: {
        ...buildDeps().profile,
        humanGates: ["post-spec"],
      },
      promptUser: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve("add retry logic");
        return Promise.resolve("approve");
      }),
    });
    vi.mocked(deps.llm.call).mockResolvedValue("Revised");
    const orchestrator = new Orchestrator(deps);

    await (orchestrator as any).humanGate("post-spec", "spec");

    const annotations = (orchestrator as any).getGateAnnotationsForPrompt();
    expect(annotations).toContain("## Human Review Notes");
    expect(annotations).toContain("post-spec");
    expect(annotations).toContain("add retry logic");
  });

  it("returns empty string when no annotations exist", () => {
    const deps = buildDeps();
    const orchestrator = new Orchestrator(deps);

    const annotations = (orchestrator as any).getGateAnnotationsForPrompt();
    expect(annotations).toBe("");
  });
});

// ─── restoreGateAnnotations ─────────────────────────────────────────────────

describe("restoreGateAnnotations()", () => {
  it("restores annotations from valid JSON", () => {
    const deps = buildDeps();
    const orchestrator = new Orchestrator(deps);

    orchestrator.restoreGateAnnotations(JSON.stringify({
      "post-spec": "Human approved with notes about PostgreSQL",
      "post-tasks": "Human asked for additional testing task",
    }));

    const annotations = (orchestrator as any).getGateAnnotationsForPrompt();
    expect(annotations).toContain("post-spec");
    expect(annotations).toContain("PostgreSQL");
    expect(annotations).toContain("post-tasks");
  });

  it("ignores malformed JSON gracefully", () => {
    const deps = buildDeps();
    const orchestrator = new Orchestrator(deps);

    // Should not throw
    orchestrator.restoreGateAnnotations("not valid json{{{");

    const annotations = (orchestrator as any).getGateAnnotationsForPrompt();
    expect(annotations).toBe("");
  });
});

// ─── ExecutionProfile humanGates field ──────────────────────────────────────

describe("ExecutionProfile humanGates", () => {
  it("CLOUD_PROFILE defaults to no gates (opt-in)", async () => {
    const { CLOUD_PROFILE } = await import("../.pi/extensions/mls/execution-profiles.js");
    expect(CLOUD_PROFILE.humanGates).toEqual([]);
  });

  it("LOCAL_PROFILE defaults to no gates (fully autonomous)", async () => {
    const { LOCAL_PROFILE } = await import("../.pi/extensions/mls/execution-profiles.js");
    expect(LOCAL_PROFILE.humanGates).toEqual([]);
  });

  it("CLOUD_PROFILE has pipelineMode 'full' by default", async () => {
    const { CLOUD_PROFILE } = await import("../.pi/extensions/mls/execution-profiles.js");
    expect(CLOUD_PROFILE.pipelineMode).toBe("full");
  });

  it("LOCAL_PROFILE has pipelineMode 'full' by default", async () => {
    const { LOCAL_PROFILE } = await import("../.pi/extensions/mls/execution-profiles.js");
    expect(LOCAL_PROFILE.pipelineMode).toBe("full");
  });
});

// ─── Type exports ───────────────────────────────────────────────────────────

describe("types", () => {
  it("exports GatePoint, HumanGateResult, EscalationAction, PipelineMode types", async () => {
    // Verify the module compiles and exports the types by importing them
    const types = await import("../.pi/extensions/mls/types.js");
    // GatePoint, HumanGateResult are interfaces/types — they don't exist at runtime
    // but the module should import cleanly
    expect(types).toBeDefined();
  });
});

// ─── Pipeline mode: review-only ─────────────────────────────────────────────

describe("fullPipeline — review-only mode", () => {
  it("stops after Phase 2 when pipelineMode is review-only", async () => {
    const deps = buildDeps({
      profile: {
        ...buildDeps().profile,
        humanGates: [],
        pipelineMode: "review-only",
      },
      agents: [
        {
          name: "mls-spec-writer",
          description: "",
          systemPrompt: "",
          filePath: "/agents/mls-spec-writer.md",
        },
        {
          name: "mls-scrum-master",
          description: "",
          systemPrompt: "",
          filePath: "/agents/mls-scrum-master.md",
        },
      ],
    });

    // Mock the classification to route to fullPipeline
    vi.mocked(deps.llm.call)
      .mockResolvedValueOnce("TYPE: feature\nREASON: a feature") // classify
      .mockResolvedValueOnce("## Spec\nA feature spec") // phase1 spec agent output
      .mockResolvedValueOnce('{"label":"TASK-001","title":"Implement","type":"Implementation","dependencies":[],"parallelWith":[],"acceptanceCriteria":["test"],"filesAffected":[]}') // parseTasks LLM
      .mockResolvedValue("LLM summary");

    const orchestrator = new Orchestrator(deps);
    (orchestrator as any).sprintId = 1;
    (orchestrator as any).projectId = 1;

    const result = await (orchestrator as any).fullPipeline("build a feature", false);

    expect(result).toContain("Review-only");
    expect(deps.state.complete).toHaveBeenCalled();
    // phase3 should NOT have been called — no scaffold or Group 1/2 execution
    expect(deps.sendMessage).not.toHaveBeenCalledWith(
      expect.stringContaining("Phase 3: Execution"),
    );
  });
});

// ─── Database resume columns ────────────────────────────────────────────────

describe("database — resume columns", () => {
  it("Sprint type includes new resume columns", async () => {
    const { MlsDatabase } = await import("../.pi/extensions/mls/db.js");
    // Verify the module imports cleanly with new types
    expect(MlsDatabase).toBeDefined();
  });
});
