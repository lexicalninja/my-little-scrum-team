import { describe, it, expect, vi, beforeEach } from "vitest";
import { Orchestrator, extractClarifications, type OrchestratorDeps } from "../.pi/extensions/mls/orchestrator/index.js";
import type { AgentResult, TaskState } from "../.pi/extensions/mls/types.js";

// Mock spawnAgent so tests that trigger agent re-invocation (e.g., clarification
// with a user answer) don't hit real subprocess spawning.
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

/**
 * Construct a minimal OrchestratorDeps stub.
 * Pass Partial<OrchestratorDeps> to override any individual field for a specific test.
 */
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
      tasks.filter((t) => t.status === status)
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
    } as unknown as OrchestratorDeps["context"],
    gates: {
      taskBreakdownValid: vi.fn().mockReturnValue({ passed: true, issues: [] }),
      checkDeletions: vi.fn().mockReturnValue({ tier: "normal", filesDeleted: [], linesRemoved: 0, linesAdded: 0 }),
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

// ─── TASK-001: OrchestratorDeps public export ─────────────────────────────────

describe("OrchestratorDeps", () => {
  it("is publicly exported from orchestrator module", async () => {
    // Dynamic import returns the live module namespace object. If OrchestratorDeps
    // were removed or made non-exported, the TypeScript compiler would reject the
    // `export interface` syntax — but we can verify the Orchestrator constructor
    // accepts an object shaped as OrchestratorDeps, which is only possible when
    // the interface is exported (TypeScript would reject the type import above).
    //
    // Additionally we verify the module exports the `Orchestrator` class itself,
    // confirming the module is importable and structured as expected.
    const mod = await import("../.pi/extensions/mls/orchestrator/index.js");
    expect(mod.Orchestrator).toBeDefined();
    expect(typeof mod.Orchestrator).toBe("function");

    // Verify OrchestratorDeps is usable as a constructor parameter type —
    // this confirms the export is present and the type is correctly shaped.
    const deps = buildDeps();
    const orchestrator = new mod.Orchestrator(deps);
    expect(orchestrator).toBeInstanceOf(mod.Orchestrator);
  });
});

// ─── phase4() regression tests ───────────────────────────────────────────────

describe("phase4()", () => {
  let deps: OrchestratorDeps;
  let orchestrator: Orchestrator;

  beforeEach(() => {
    deps = buildDeps();
    orchestrator = new Orchestrator(deps);
    // Set a known sprintId so db.updateSprint assertions are deterministic
    (orchestrator as any).sprintId = 1;
  });

  it("returns the LLM summary verbatim on the happy path", async () => {
    vi.mocked(deps.llm.call).mockResolvedValue("Sprint went great!");
    const tasks = [makeTask({ id: "TASK-001", status: "complete" })];
    vi.mocked(deps.state.getTasksByStatus).mockImplementation((s: string) =>
      s === "complete" ? tasks : []
    );

    const result = await (orchestrator as any).phase4(tasks);

    expect(result).toBe("Sprint went great!");
    expect(deps.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "sprint_end", summary: "Sprint went great!" })
    );
    expect(deps.sendMessage).toHaveBeenCalledWith("Sprint went great!");
    // No warning-level notify call
    const warnCalls = vi.mocked(deps.notify).mock.calls.filter(([, level]) => level === "warning");
    expect(warnCalls).toHaveLength(0);
    expect(deps.state.complete).toHaveBeenCalledOnce();
    expect(deps.db.updateSprint).toHaveBeenCalledWith(1, expect.objectContaining({ status: "completed" }));
  });

  it("does not throw when llm.call rejects with an Error — returns fallback string", async () => {
    vi.mocked(deps.llm.call).mockRejectedValue(new Error("rate limit exceeded"));
    const tasks = [makeTask({ id: "TASK-001", status: "complete" })];
    vi.mocked(deps.state.getTasksByStatus).mockImplementation((s: string) =>
      s === "complete" ? tasks : []
    );

    const phase4Promise = (orchestrator as any).phase4(tasks);
    await expect(phase4Promise).resolves.toBeDefined();

    const result = await (orchestrator as any).phase4(tasks);
    expect(result).toContain("Sprint complete.");
    expect(result).toContain("tasks completed");
    expect(result).toContain("Summary unavailable");
    expect(result).toContain("rate limit exceeded");
    expect(deps.notify).toHaveBeenCalledWith(
      expect.stringContaining("Sprint summary unavailable"),
      "warning"
    );
    expect(deps.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "sprint_end" }));
    expect(deps.sendMessage).toHaveBeenCalledWith(expect.stringContaining("Sprint complete."));
    expect(deps.state.complete).toHaveBeenCalled();
    expect(deps.db.updateSprint).toHaveBeenCalledWith(1, expect.objectContaining({ status: "completed" }));
  });

  // Regression test for the original empty-response crash:
  // the private llm() wrapper throws "LLM returned empty response for: ..." when
  // llm.call resolves with "", which previously escaped the try/catch in phase4().
  it("does not throw when llm.call returns an empty string (original bug scenario)", async () => {
    vi.mocked(deps.llm.call).mockResolvedValue("");
    const tasks = [makeTask({ id: "TASK-001", status: "complete" })];
    vi.mocked(deps.state.getTasksByStatus).mockImplementation((s: string) =>
      s === "complete" ? tasks : []
    );

    const phase4Promise = (orchestrator as any).phase4(tasks);
    await expect(phase4Promise).resolves.toBeDefined();

    const result = await (orchestrator as any).phase4(tasks);
    expect(result).toContain("Summary unavailable");
    expect(deps.notify).toHaveBeenCalledWith(
      expect.stringContaining("Sprint summary unavailable"),
      "warning"
    );
    // Confirm the specific error message from the private llm() wrapper is propagated
    const notifyCalls = vi.mocked(deps.notify).mock.calls;
    const warningCall = notifyCalls.find(([, level]) => level === "warning");
    expect(warningCall?.[0]).toContain("LLM returned empty response");
  });

  it("fallback string contains the correct completed/total count", async () => {
    vi.mocked(deps.llm.call).mockRejectedValue(new Error("fail"));

    const tasks = [
      makeTask({ id: "T1", status: "complete" }),
      makeTask({ id: "T2", status: "complete" }),
      makeTask({ id: "T3", status: "escalated" }),
    ];
    const customDeps = buildDeps({
      state: {
        ...buildDeps().state,
        getTasksByStatus: vi.fn().mockImplementation((s: string) =>
          s === "complete" ? [tasks[0], tasks[1]] : []
        ),
        getTask: vi.fn().mockImplementation((id: string) =>
          tasks.find((t) => t.id === id) ?? { status: "pending", label: id, title: "?" }
        ),
      } as any,
      llm: { call: vi.fn().mockRejectedValue(new Error("fail")) },
    });

    const o2 = new Orchestrator(customDeps);
    (o2 as any).sprintId = 1;

    const result = await (o2 as any).phase4(tasks);
    expect(result).toContain("2/3");
  });

  it("always calls state.complete, db.updateSprint, emit(sprint_end), and sendMessage even when LLM fails", async () => {
    vi.mocked(deps.llm.call).mockRejectedValue(new Error("network error"));
    const tasks = [makeTask({ id: "TASK-001", status: "complete" })];
    vi.mocked(deps.state.getTasksByStatus).mockImplementation((s: string) =>
      s === "complete" ? tasks : []
    );

    await (orchestrator as any).phase4(tasks);

    expect(deps.state.complete).toHaveBeenCalledOnce();
    expect(deps.db.updateSprint).toHaveBeenCalledOnce();
    expect(deps.db.updateSprint).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        status: "completed",
        completed_at: expect.any(String),
      })
    );
    expect(deps.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "sprint_end" }));
    expect(deps.sendMessage).toHaveBeenCalledOnce();
    const sentMessage = vi.mocked(deps.sendMessage).mock.calls[0][0];
    expect(typeof sentMessage).toBe("string");
    expect(sentMessage.length).toBeGreaterThan(0);
  });
});

// ─── extractClarifications() ────────────────────────────────────────────────

describe("extractClarifications()", () => {
  it("returns null for output with no clarification markers", () => {
    const output = "Implementation complete. All tests pass.";
    expect(extractClarifications(output, "mls-impl-engineer")).toBeNull();
  });

  it("extracts a single clarification question", () => {
    const output = `I started implementing but hit an ambiguity.
CLARIFICATION_NEEDED: Should the API return 404 or 204 for missing resources?
Continuing with 404 for now.`;

    const result = extractClarifications(output, "mls-impl-engineer", "TASK-001");
    expect(result).not.toBeNull();
    expect(result!.agent).toBe("mls-impl-engineer");
    expect(result!.taskLabel).toBe("TASK-001");
    expect(result!.questions).toEqual([
      "Should the API return 404 or 204 for missing resources?",
    ]);
  });

  it("extracts multiple clarification questions", () => {
    const output = `Several design decisions are unclear.
CLARIFICATION_NEEDED: Should we use REST or GraphQL for the API?
CLARIFICATION_NEEDED: Is authentication required for public endpoints?
Proceeding with REST and no auth for now.`;

    const result = extractClarifications(output, "mls-designer");
    expect(result).not.toBeNull();
    expect(result!.questions).toHaveLength(2);
    expect(result!.questions[0]).toBe("Should we use REST or GraphQL for the API?");
    expect(result!.questions[1]).toBe("Is authentication required for public endpoints?");
  });

  it("is case-insensitive", () => {
    const output = "clarification_needed: What database should we use?";
    const result = extractClarifications(output, "agent");
    expect(result).not.toBeNull();
    expect(result!.questions).toEqual(["What database should we use?"]);
  });

  it("ignores empty questions after the marker", () => {
    const output = "CLARIFICATION_NEEDED:   \nCLARIFICATION_NEEDED: Valid question?";
    const result = extractClarifications(output, "agent");
    expect(result).not.toBeNull();
    expect(result!.questions).toEqual(["Valid question?"]);
  });

  it("returns null when only empty markers are present", () => {
    const output = "CLARIFICATION_NEEDED:   ";
    expect(extractClarifications(output, "agent")).toBeNull();
  });

  it("handles markers without the taskLabel", () => {
    const output = "CLARIFICATION_NEEDED: Is this a monorepo?";
    const result = extractClarifications(output, "mls-spec-writer");
    expect(result).not.toBeNull();
    expect(result!.taskLabel).toBeUndefined();
    expect(result!.agent).toBe("mls-spec-writer");
  });
});

// ─── Clarification handling in Orchestrator ─────────────────────────────────

describe("Orchestrator clarification handling", () => {
  describe("in full pipeline mode (non-gated)", () => {
    it("skips promptUser and generates autonomous answers via LLM", async () => {
      const deps = buildDeps({
        profile: {
          ...buildDeps().profile,
          pipelineMode: "full",
        },
        agents: [
          {
            name: "mls-impl-engineer",
            description: "Implementation engineer",
            systemPrompt: "",
            filePath: "/agents/mls-impl-engineer.md",
          },
        ],
      });
      const orchestrator = new Orchestrator(deps);

      const clarification = {
        agent: "mls-impl-engineer",
        questions: ["Should we use SQL or NoSQL?"],
        taskLabel: "TASK-001",
      };
      await (orchestrator as any).handleClarification(
        clarification,
        "mls-impl-engineer",
        "original task prompt",
        undefined,
      );

      // promptUser should NOT be called in full mode
      expect(deps.promptUser).not.toHaveBeenCalled();
      // sendMessage should NOT be called (no user prompt displayed)
      expect(deps.sendMessage).not.toHaveBeenCalled();
      // LLM should be called to generate autonomous answers
      expect(deps.llm.call).toHaveBeenCalled();
    });

    it("emits a clarification event with autonomous=true and LLM-generated answer", async () => {
      const deps = buildDeps({
        profile: {
          ...buildDeps().profile,
          pipelineMode: "full",
        },
        agents: [
          {
            name: "mls-impl-engineer",
            description: "Implementation engineer",
            systemPrompt: "",
            filePath: "/agents/mls-impl-engineer.md",
          },
        ],
      });
      (deps.llm.call as ReturnType<typeof vi.fn>).mockResolvedValue("Use PostgreSQL for relational data");
      const orchestrator = new Orchestrator(deps);

      const clarification = {
        agent: "mls-impl-engineer",
        questions: ["Should we use SQL or NoSQL?"],
      };
      await (orchestrator as any).handleClarification(
        clarification,
        "mls-impl-engineer",
        "original task",
        undefined,
      );

      expect(deps.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "clarification",
          agent: "mls-impl-engineer",
          questions: ["Should we use SQL or NoSQL?"],
          answer: "Use PostgreSQL for relational data",
          autonomous: true,
        })
      );
    });

    it("notifies that autonomous answers are being generated", async () => {
      const deps = buildDeps({
        profile: {
          ...buildDeps().profile,
          pipelineMode: "full",
        },
        agents: [
          {
            name: "mls-impl-engineer",
            description: "Implementation engineer",
            systemPrompt: "",
            filePath: "/agents/mls-impl-engineer.md",
          },
        ],
      });
      const orchestrator = new Orchestrator(deps);

      const clarification = {
        agent: "mls-impl-engineer",
        questions: ["Which auth strategy?"],
      };
      await (orchestrator as any).handleClarification(
        clarification,
        "mls-impl-engineer",
        "task",
        undefined,
      );

      expect(deps.notify).toHaveBeenCalledWith(
        expect.stringContaining("Generating autonomous answers"),
        "info",
      );
    });
  });

  describe("in gated pipeline mode", () => {
    it("calls promptUser and sendMessage to display questions to user", async () => {
      const deps = buildDeps({
        profile: {
          ...buildDeps().profile,
          pipelineMode: "gated",
        },
        promptUser: vi.fn().mockResolvedValue("Use PostgreSQL"),
        agents: [
          {
            name: "mls-impl-engineer",
            description: "Implementation engineer",
            systemPrompt: "",
            filePath: "/agents/mls-impl-engineer.md",
          },
        ],
      });
      const orchestrator = new Orchestrator(deps);

      const clarification = {
        agent: "mls-impl-engineer",
        questions: ["Should we use SQL or NoSQL?"],
      };
      await (orchestrator as any).handleClarification(
        clarification,
        "mls-impl-engineer",
        "original task",
        undefined,
      );

      expect(deps.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining("Clarification needed"),
      );
      expect(deps.promptUser).toHaveBeenCalledWith(
        "Should we use SQL or NoSQL?",
        "mls-impl-engineer",
      );
    });

    it("emits a clarification event with user answer when promptUser returns a string", async () => {
      const deps = buildDeps({
        profile: {
          ...buildDeps().profile,
          pipelineMode: "gated",
        },
        promptUser: vi.fn().mockResolvedValue("Use PostgreSQL"),
        agents: [
          {
            name: "mls-impl-engineer",
            description: "Implementation engineer",
            systemPrompt: "",
            filePath: "/agents/mls-impl-engineer.md",
          },
        ],
      });
      const orchestrator = new Orchestrator(deps);

      const clarification = {
        agent: "mls-impl-engineer",
        questions: ["Should we use SQL or NoSQL?"],
      };
      await (orchestrator as any).handleClarification(
        clarification,
        "mls-impl-engineer",
        "original task",
        undefined,
      );

      expect(deps.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "clarification",
          agent: "mls-impl-engineer",
          answer: "Use PostgreSQL",
          autonomous: false,
        })
      );
    });

    it("falls back to autonomous answers when promptUser returns null (timeout)", async () => {
      const deps = buildDeps({
        profile: {
          ...buildDeps().profile,
          pipelineMode: "gated",
        },
        promptUser: vi.fn().mockResolvedValue(null),
        agents: [
          {
            name: "mls-impl-engineer",
            description: "Implementation engineer",
            systemPrompt: "",
            filePath: "/agents/mls-impl-engineer.md",
          },
        ],
      });
      (deps.llm.call as ReturnType<typeof vi.fn>).mockResolvedValue("Autonomous: Use SQL");
      const orchestrator = new Orchestrator(deps);

      const clarification = {
        agent: "mls-impl-engineer",
        questions: ["Should we use SQL or NoSQL?"],
      };
      await (orchestrator as any).handleClarification(
        clarification,
        "mls-impl-engineer",
        "original task",
        undefined,
      );

      // Should have prompted user first
      expect(deps.promptUser).toHaveBeenCalled();
      // Then fallen back to LLM
      expect(deps.llm.call).toHaveBeenCalled();
      // Event should show autonomous=true since user didn't answer
      expect(deps.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "clarification",
          answer: "Autonomous: Use SQL",
          autonomous: true,
        })
      );
    });

    it("batches multiple questions into a single prompt", async () => {
      const deps = buildDeps({
        profile: {
          ...buildDeps().profile,
          pipelineMode: "gated",
        },
        promptUser: vi.fn().mockResolvedValue("1. REST, 2. SQL"),
        agents: [
          {
            name: "mls-designer",
            description: "Designer",
            systemPrompt: "",
            filePath: "/agents/mls-designer.md",
          },
        ],
      });
      const orchestrator = new Orchestrator(deps);

      const clarification = {
        agent: "mls-designer",
        questions: ["REST or GraphQL?", "SQL or NoSQL?"],
      };
      await (orchestrator as any).handleClarification(
        clarification,
        "mls-designer",
        "task",
        undefined,
      );

      const promptCall = vi.mocked(deps.promptUser).mock.calls[0];
      expect(promptCall[0]).toContain("1. REST or GraphQL?");
      expect(promptCall[0]).toContain("2. SQL or NoSQL?");
    });
  });

  describe("in review-only pipeline mode", () => {
    it("skips promptUser like full mode", async () => {
      const deps = buildDeps({
        profile: {
          ...buildDeps().profile,
          pipelineMode: "review-only",
        },
        agents: [
          {
            name: "mls-impl-engineer",
            description: "Implementation engineer",
            systemPrompt: "",
            filePath: "/agents/mls-impl-engineer.md",
          },
        ],
      });
      const orchestrator = new Orchestrator(deps);

      const clarification = {
        agent: "mls-impl-engineer",
        questions: ["Which framework?"],
      };
      await (orchestrator as any).handleClarification(
        clarification,
        "mls-impl-engineer",
        "task",
        undefined,
      );

      expect(deps.promptUser).not.toHaveBeenCalled();
      expect(deps.sendMessage).not.toHaveBeenCalled();
      expect(deps.llm.call).toHaveBeenCalled();
    });
  });

  describe("generateAutonomousAnswers", () => {
    it("calls LLM with a decision-making system prompt", async () => {
      const deps = buildDeps({
        profile: {
          ...buildDeps().profile,
          pipelineMode: "full",
        },
        agents: [
          {
            name: "mls-impl-engineer",
            description: "Implementation engineer",
            systemPrompt: "",
            filePath: "/agents/mls-impl-engineer.md",
          },
        ],
      });
      const orchestrator = new Orchestrator(deps);

      await (orchestrator as any).generateAutonomousAnswers(
        "Should we use SQL or NoSQL?",
        "Build a user management API",
      );

      const llmCall = vi.mocked(deps.llm.call).mock.calls[0];
      // System prompt should guide decision-making
      expect(llmCall[0]).toContain("technical decision-maker");
      expect(llmCall[0]).toContain("simple");
      // User prompt should include the original task and questions
      expect(llmCall[1]).toContain("Build a user management API");
      expect(llmCall[1]).toContain("Should we use SQL or NoSQL?");
    });

    it("uses fast tier for autonomous answers", async () => {
      const deps = buildDeps({
        profile: {
          ...buildDeps().profile,
          pipelineMode: "full",
        },
        agents: [
          {
            name: "mls-impl-engineer",
            description: "Implementation engineer",
            systemPrompt: "",
            filePath: "/agents/mls-impl-engineer.md",
          },
        ],
      });
      const orchestrator = new Orchestrator(deps);

      await (orchestrator as any).generateAutonomousAnswers(
        "Which database?",
        "task",
      );

      const llmCall = vi.mocked(deps.llm.call).mock.calls[0];
      expect(llmCall[2]).toMatchObject({ tier: "fast" });
    });
  });
});
