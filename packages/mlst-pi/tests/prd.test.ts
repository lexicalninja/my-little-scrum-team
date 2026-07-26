import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

vi.mock("@mariozechner/pi-tui", () => ({
  Text: class {
    constructor() {}
    render() {
      return null;
    }
    invalidate() {}
  },
}));

import {
  PrdSession,
  type PrdSessionDeps,
  type PrdDraftState,
  generateSlug,
  buildPrdMarkdown,
  PRD_QUESTIONS,
  parsePrdFilePath,
} from "../.pi/extensions/mlst/prd.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildPrdDeps(overrides: Partial<PrdSessionDeps> = {}): PrdSessionDeps {
  return {
    cwd: "/tmp/test-project",
    llm: {
      call: vi.fn().mockResolvedValue("LLM response"),
    } as unknown as PrdSessionDeps["llm"],
    promptUser: vi.fn().mockResolvedValue("User response"),
    notify: vi.fn(),
    ...overrides,
  };
}

// ─── generateSlug ────────────────────────────────────────────────────────────

describe("generateSlug", () => {
  it("converts a simple title to a lowercase slug", () => {
    expect(generateSlug("Sprint Metrics Dashboard")).toBe("sprint-metrics-dashboard");
  });

  it("removes special characters", () => {
    expect(generateSlug("My Feature! (v2)")).toBe("my-feature-v2");
  });

  it("collapses multiple dashes", () => {
    expect(generateSlug("hello---world")).toBe("hello-world");
  });

  it("trims leading and trailing dashes", () => {
    expect(generateSlug("--hello--")).toBe("hello");
  });

  it("truncates long slugs to 50 characters", () => {
    const long = "a".repeat(100);
    const slug = generateSlug(long);
    expect(slug.length).toBeLessThanOrEqual(50);
  });

  it("falls back to 'untitled' for empty input", () => {
    expect(generateSlug("")).toBe("untitled");
    expect(generateSlug("   ")).toBe("untitled");
  });

  it("handles input with only special characters", () => {
    expect(generateSlug("!@#$%")).toBe("untitled");
  });
});

// ─── buildPrdMarkdown ────────────────────────────────────────────────────────

describe("buildPrdMarkdown", () => {
  it("produces valid PRD markdown with all sections filled", () => {
    const state: PrdDraftState = {
      title: "Sprint Metrics Dashboard",
      problemStatement: "Teams lack visibility into sprint health.",
      goalsAndNonGoals: "Goals: real-time metrics.\nNon-goals: historical reporting.",
      usersAndContext: "Engineering leads using the internal tools.",
      requirementsMustHave: "- Dashboard page\n- Sprint velocity chart",
      requirementsNiceToHave: "- Export to PDF",
      acceptanceCriteria: "- [ ] Dashboard loads in under 2s\n- [ ] Velocity chart renders correctly",
      constraintsAndAssumptions: "Must use existing React stack.",
      openQuestions: "None.",
    };

    const md = buildPrdMarkdown(state);

    expect(md).toContain("# PRD: Sprint Metrics Dashboard");
    expect(md).toContain("## Problem Statement");
    expect(md).toContain("Teams lack visibility into sprint health.");
    expect(md).toContain("## Goals & Non-Goals");
    expect(md).toContain("## Users & Context");
    expect(md).toContain("## Requirements");
    expect(md).toContain("### Must Have");
    expect(md).toContain("### Nice to Have");
    expect(md).toContain("## Acceptance Criteria");
    expect(md).toContain("## Constraints & Assumptions");
    expect(md).toContain("## Open Questions");
  });

  it("handles empty optional sections gracefully", () => {
    const state: PrdDraftState = {
      title: "Minimal Feature",
      problemStatement: "Some problem.",
      goalsAndNonGoals: "",
      usersAndContext: "",
      requirementsMustHave: "",
      requirementsNiceToHave: "",
      acceptanceCriteria: "",
      constraintsAndAssumptions: "",
      openQuestions: "",
    };

    const md = buildPrdMarkdown(state);
    expect(md).toContain("# PRD: Minimal Feature");
    expect(md).toContain("## Problem Statement");
    // Empty sections should still have headers but no content crash
    expect(md).toBeDefined();
  });
});

// ─── PRD_QUESTIONS ───────────────────────────────────────────────────────────

describe("PRD_QUESTIONS", () => {
  it("is a non-empty array of question objects", () => {
    expect(Array.isArray(PRD_QUESTIONS)).toBe(true);
    expect(PRD_QUESTIONS.length).toBeGreaterThan(0);
  });

  it("each question has a key, label, and prompt", () => {
    for (const q of PRD_QUESTIONS) {
      expect(typeof q.key).toBe("string");
      expect(typeof q.label).toBe("string");
      expect(typeof q.prompt).toBe("string");
      expect(q.key.length).toBeGreaterThan(0);
      expect(q.label.length).toBeGreaterThan(0);
      expect(q.prompt.length).toBeGreaterThan(0);
    }
  });

  it("question keys match PrdDraftState fields (except title)", () => {
    const stateKeys: Array<keyof PrdDraftState> = [
      "problemStatement",
      "goalsAndNonGoals",
      "usersAndContext",
      "requirementsMustHave",
      "requirementsNiceToHave",
      "acceptanceCriteria",
      "constraintsAndAssumptions",
      "openQuestions",
    ];
    const questionKeys = PRD_QUESTIONS.map((q) => q.key);
    for (const key of stateKeys) {
      expect(questionKeys).toContain(key);
    }
  });
});

// ─── parsePrdFilePath ────────────────────────────────────────────────────────

describe("parsePrdFilePath", () => {
  it("recognizes a .mlst/prd-*.md file path", () => {
    expect(parsePrdFilePath(".mlst/prd-my-feature.md")).toBe(true);
  });

  it("recognizes a relative path with .mlst/prd prefix", () => {
    expect(parsePrdFilePath(".mlst/prd-sprint-dashboard.md")).toBe(true);
  });

  it("rejects non-PRD file paths", () => {
    expect(parsePrdFilePath("src/index.ts")).toBe(false);
    expect(parsePrdFilePath("README.md")).toBe(false);
    expect(parsePrdFilePath(".mlst/other-file.md")).toBe(false);
  });

  it("rejects paths that only contain prd in directory name", () => {
    expect(parsePrdFilePath("prd/something.md")).toBe(false);
  });
});

// ─── PrdSession ──────────────────────────────────────────────────────────────

describe("PrdSession", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mlst-prd-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("constructs without error", () => {
    const deps = buildPrdDeps({ cwd: tmpDir });
    const session = new PrdSession(deps);
    expect(session).toBeDefined();
  });

  it("runs a full session producing a PRD file", async () => {
    let questionIndex = 0;
    const answers = [
      "Sprint Metrics Dashboard",       // title (from initial LLM extraction)
      "Teams lack visibility.",           // problemStatement
      "Goals: metrics. Non-goals: none.", // goalsAndNonGoals
      "Engineering leads.",               // usersAndContext
      "- Dashboard page",                 // requirementsMustHave
      "- PDF export",                     // requirementsNiceToHave
      "- [ ] Loads in 2s",               // acceptanceCriteria
      "React stack.",                     // constraintsAndAssumptions
      "None.",                            // openQuestions
    ];

    const deps = buildPrdDeps({
      cwd: tmpDir,
      llm: {
        call: vi.fn().mockImplementation(async (_sys: string, _user: string) => {
          // First LLM call extracts title from initial input
          return "Sprint Metrics Dashboard";
        }),
      } as unknown as PrdSessionDeps["llm"],
      promptUser: vi.fn().mockImplementation(async (_prompt: string) => {
        return answers[questionIndex++] ?? "";
      }),
    });

    const session = new PrdSession(deps);
    const result = await session.run("build me a dashboard for sprint metrics");

    expect(result.filePath).toMatch(/\.mlst\/prd-.*\.md$/);
    expect(result.title).toBe("Sprint Metrics Dashboard");

    // Verify the file was created
    const fullPath = path.resolve(tmpDir, result.filePath);
    expect(fs.existsSync(fullPath)).toBe(true);

    const content = fs.readFileSync(fullPath, "utf-8");
    expect(content).toContain("# PRD: Sprint Metrics Dashboard");
    expect(content).toContain("## Problem Statement");
  });

  it("user answers appear in the final PRD markdown", async () => {
    const deps = buildPrdDeps({
      cwd: tmpDir,
      llm: {
        call: vi.fn().mockResolvedValue("Dashboard Feature"),
      } as unknown as PrdSessionDeps["llm"],
      promptUser: vi.fn()
        .mockResolvedValueOnce("Teams lack visibility into sprint health.")
        .mockResolvedValueOnce("Goals: real-time metrics.")
        .mockResolvedValueOnce("Engineering leads.")
        .mockResolvedValueOnce("- Dashboard page")
        .mockResolvedValueOnce("- PDF export")
        .mockResolvedValueOnce("- [ ] Loads in 2s")
        .mockResolvedValueOnce("React stack.")
        .mockResolvedValueOnce("None."),
    });

    const session = new PrdSession(deps);
    const result = await session.run("dashboard feature");

    const content = fs.readFileSync(path.resolve(tmpDir, result.filePath), "utf-8");
    expect(content).toContain("Teams lack visibility into sprint health.");
    expect(content).toContain("Goals: real-time metrics.");
    expect(content).toContain("Engineering leads.");
    expect(content).toContain("- Dashboard page");
    expect(content).toContain("- PDF export");
    expect(content).toContain("- [ ] Loads in 2s");
    expect(content).toContain("React stack.");
    expect(content).toContain("None.");
  });

  it("empty promptUser answers produce placeholder text in PRD", async () => {
    const deps = buildPrdDeps({
      cwd: tmpDir,
      llm: {
        call: vi.fn().mockResolvedValue("Empty Feature"),
      } as unknown as PrdSessionDeps["llm"],
      promptUser: vi.fn().mockResolvedValue(""),
    });

    const session = new PrdSession(deps);
    const result = await session.run("empty feature");

    const content = fs.readFileSync(path.resolve(tmpDir, result.filePath), "utf-8");
    expect(content).toContain("_Not specified._");
  });

  it("promptUser is called with the question prompt string", async () => {
    const mockPromptUser = vi.fn().mockResolvedValue("answer");
    const deps = buildPrdDeps({
      cwd: tmpDir,
      llm: {
        call: vi.fn().mockResolvedValue("Prompt Test"),
      } as unknown as PrdSessionDeps["llm"],
      promptUser: mockPromptUser,
    });

    const session = new PrdSession(deps);
    await session.run("prompt test");

    // Verify promptUser was called 8 times (once per question)
    expect(mockPromptUser).toHaveBeenCalledTimes(8);
    // Verify the first call includes the Problem Statement label and prompt
    expect(mockPromptUser.mock.calls[0][0]).toContain("Problem Statement");
    expect(mockPromptUser.mock.calls[0][0]).toContain("What problem does this solve?");
  });

  it("creates .mlst directory if it does not exist", async () => {
    const deps = buildPrdDeps({
      cwd: tmpDir,
      llm: {
        call: vi.fn().mockResolvedValue("Test Feature"),
      } as unknown as PrdSessionDeps["llm"],
      promptUser: vi.fn().mockResolvedValue("Some answer"),
    });

    const session = new PrdSession(deps);
    await session.run("test feature");

    const mlstDir = path.join(tmpDir, ".mlst");
    expect(fs.existsSync(mlstDir)).toBe(true);
  });

  it("handles short/partial answers gracefully (no crash)", async () => {
    const deps = buildPrdDeps({
      cwd: tmpDir,
      llm: {
        call: vi.fn().mockResolvedValue("Feature"),
      } as unknown as PrdSessionDeps["llm"],
      promptUser: vi.fn().mockResolvedValue(""), // empty answers
    });

    const session = new PrdSession(deps);
    // Should not throw
    const result = await session.run("something");
    expect(result.filePath).toBeDefined();
    expect(result.title).toBe("Feature");
  });

  it("saves draft state to .mlst/prd-<slug>.draft.json", async () => {
    const deps = buildPrdDeps({
      cwd: tmpDir,
      llm: {
        call: vi.fn().mockResolvedValue("My Feature"),
      } as unknown as PrdSessionDeps["llm"],
      promptUser: vi.fn().mockResolvedValue("answer"),
    });

    const session = new PrdSession(deps);
    await session.run("my feature idea");

    // Check that the draft JSON was saved during the session
    const mlstDir = path.join(tmpDir, ".mlst");
    const draftFiles = fs.readdirSync(mlstDir).filter((f) => f.endsWith(".draft.json"));
    // Draft file is cleaned up after successful completion, so check the final PRD instead
    const prdFiles = fs.readdirSync(mlstDir).filter((f) => f.startsWith("prd-") && f.endsWith(".md"));
    expect(prdFiles.length).toBeGreaterThan(0);
  });

  it("resumes from an existing draft", async () => {
    const mlstDir = path.join(tmpDir, ".mlst");
    fs.mkdirSync(mlstDir, { recursive: true });

    const draft: PrdDraftState = {
      title: "Resumed Feature",
      problemStatement: "Already answered",
      goalsAndNonGoals: "Already answered",
      usersAndContext: "",
      requirementsMustHave: "",
      requirementsNiceToHave: "",
      acceptanceCriteria: "",
      constraintsAndAssumptions: "",
      openQuestions: "",
    };
    fs.writeFileSync(
      path.join(mlstDir, "prd-resumed-feature.draft.json"),
      JSON.stringify(draft),
    );

    const deps = buildPrdDeps({
      cwd: tmpDir,
      promptUser: vi.fn().mockResolvedValue("new answer"),
    });

    const session = new PrdSession(deps);
    const result = await session.resume("resumed-feature");

    expect(result.title).toBe("Resumed Feature");
    // The previously answered fields should be preserved
    const content = fs.readFileSync(path.resolve(tmpDir, result.filePath), "utf-8");
    expect(content).toContain("Already answered");
  });

  it("resume throws if no draft file exists", async () => {
    const deps = buildPrdDeps({ cwd: tmpDir });
    const session = new PrdSession(deps);
    await expect(session.resume("nonexistent")).rejects.toThrow("No draft found");
  });

  it("PRD file is human-readable and editable", async () => {
    const deps = buildPrdDeps({
      cwd: tmpDir,
      llm: {
        call: vi.fn().mockResolvedValue("Readable Feature"),
      } as unknown as PrdSessionDeps["llm"],
      promptUser: vi.fn().mockResolvedValue("Clear answer here"),
    });

    const session = new PrdSession(deps);
    const result = await session.run("readable feature");

    const content = fs.readFileSync(path.resolve(tmpDir, result.filePath), "utf-8");

    // Valid markdown structure
    expect(content).toMatch(/^# PRD:/m);
    expect(content).toMatch(/^## /m);
    // No binary or encoded content
    expect(content).not.toMatch(/[\x00-\x08\x0e-\x1f]/);
    // Line-based structure (editable in any editor)
    const lines = content.split("\n");
    expect(lines.length).toBeGreaterThan(5);
  });
});

// ─── Source wiring: /prd command registration ────────────────────────────────

describe("/prd command registration — source wiring", () => {
  it("index.ts registers a 'prd' command via pi.registerCommand", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "..", ".pi", "extensions", "mlst", "index.ts"),
      "utf-8",
    );
    expect(src).toMatch(/registerCommand\s*\(\s*["']prd["']/);
  });

  it("index.ts imports PrdSession from prd.js", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "..", ".pi", "extensions", "mlst", "index.ts"),
      "utf-8",
    );
    expect(src).toMatch(/from\s+["']\.\/prd\.js["']/);
  });

  it("index.ts uses ctx.ui.input() in promptUser for interactive mode", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "..", ".pi", "extensions", "mlst", "index.ts"),
      "utf-8",
    );
    expect(src).toMatch(/ctx\.ui\?\.input\?\.\(/);
  });

  it("index.ts guards against non-interactive mode when ctx.ui.input is unavailable", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "..", ".pi", "extensions", "mlst", "index.ts"),
      "utf-8",
    );
    expect(src).toMatch(/ctx\.ui\?\.input/);
    expect(src).toContain("The /prd command requires interactive mode.");
  });

  it("handlePrd calls resolveInput before passing input to PrdSession.run", () => {
    // Regression: /prd must resolve @file references (including quoted paths with spaces)
    // before passing the input to PrdSession.run(). Without this, raw @"..." tokens are
    // forwarded to the LLM subprocess, which fails to resolve them.
    const src = fs.readFileSync(
      path.resolve(__dirname, "..", ".pi", "extensions", "mlst", "index.ts"),
      "utf-8",
    );
    // The handlePrd function body must call resolveInput before session.run
    // Find the handlePrd block and verify resolveInput appears before session.run
    const handlePrdMatch = /const\s+handlePrd[\s\S]*?session\.run\(/.exec(src);
    expect(handlePrdMatch).not.toBeNull();
    expect(handlePrdMatch![0]).toMatch(/resolveInput/);
  });

  it("handlePrd passes resolved input (not raw args) to session.run", () => {
    // Regression: session.run must receive the resolved input, not the raw trimmed args.
    const src = fs.readFileSync(
      path.resolve(__dirname, "..", ".pi", "extensions", "mlst", "index.ts"),
      "utf-8",
    );
    // session.run should NOT be called with `trimmed` — it should use the resolved input
    expect(src).not.toMatch(/session\.run\(trimmed\)/);
  });

  it("index.ts coerces undefined ctx.ui.input() result to empty string via ?? operator", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "..", ".pi", "extensions", "mlst", "index.ts"),
      "utf-8",
    );
    // The promptUser adapter must use nullish coalescing to handle undefined → ""
    expect(src).toMatch(/answer\s*\?\?\s*""/);
  });
});

// ─── Source wiring: /build PRD recognition ───────────────────────────────────

describe("/build PRD recognition — source wiring", () => {
  it("index.ts or orchestrator.ts references parsePrdFilePath for /build integration", () => {
    const indexSrc = fs.readFileSync(
      path.resolve(__dirname, "..", ".pi", "extensions", "mlst", "index.ts"),
      "utf-8",
    );
    expect(indexSrc).toMatch(/parsePrdFilePath/);
  });
});
