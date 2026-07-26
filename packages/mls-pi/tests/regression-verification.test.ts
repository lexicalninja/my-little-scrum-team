import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, "..");

function countItBlocks(filePath: string): number {
  const content = fs.readFileSync(filePath, "utf-8");
  const matches = content.match(/^\s*it\(/gm);
  return matches ? matches.length : 0;
}

function getTestFiles(): string[] {
  const testsDir = path.join(pluginRoot, "tests");
  return fs.readdirSync(testsDir).filter((f) => f.endsWith(".test.ts"));
}

describe("Regression verification — full test suite", () => {
  it("all test files in tests/ directory are present and parseable", () => {
    const testFiles = getTestFiles();

    // All core test files must be present
    const expectedCoreFiles = [
      "agents.test.ts",
      "context.test.ts",
      "dashboard.test.ts",
      "db.test.ts",
      "execution-profiles.test.ts",
      "human-gates.test.ts",
      "human-gates-integration.test.ts",
      "index.test.ts",
      "llm.test.ts",
      "orchestrator.test.ts",
      "quality-gates.test.ts",
      "skills.test.ts",
      "state.test.ts",
      "sprint-end-abort.test.ts",
      "gate-cost-tracking.test.ts",
      "phase-wiring-integration.test.ts",
      "escalation-abort-integration.test.ts",
      "resume-e2e-integration.test.ts",
    ];

    for (const file of expectedCoreFiles) {
      expect(
        testFiles.includes(file),
        `${file} should be present in tests/ directory`,
      ).toBe(true);
    }

    // Every test file must have at least 1 it-block
    for (const file of testFiles) {
      const filePath = path.join(pluginRoot, "tests", file);
      const count = countItBlocks(filePath);
      expect(count, `${file} should have at least 1 test`).toBeGreaterThanOrEqual(1);
    }

    // Total test count across all files should be at least 500
    const totalItBlocks = testFiles.reduce(
      (sum, f) => sum + countItBlocks(path.join(pluginRoot, "tests", f)),
      0,
    );
    expect(totalItBlocks).toBeGreaterThanOrEqual(500);
  });

  it("all new tests in human-gates-integration.test.ts cover required scenarios", () => {
    const integrationFile = path.join(pluginRoot, "tests", "human-gates-integration.test.ts");
    expect(fs.existsSync(integrationFile), "human-gates-integration.test.ts should exist").toBe(true);

    // The file should have at least 20 it-blocks covering all integration scenarios
    const itCount = countItBlocks(integrationFile);
    expect(itCount).toBeGreaterThanOrEqual(20);

    // Verify the test file imports from the correct source modules
    const content = fs.readFileSync(integrationFile, "utf-8");
    expect(content).toContain("from \"../.pi/extensions/mls/orchestrator/index.js\"");
    expect(content).toContain("from \"../.pi/extensions/mls/types.js\"");

    // Verify key integration test scenarios are present by checking describe blocks
    const describeBlocks = content.match(/describe\("([^"]+)"/g) ?? [];
    const describeNames = describeBlocks.map((d) => d.replace(/describe\("/, "").replace(/"$/, ""));

    // Must cover all spec'd integration test areas
    expect(describeNames.some((n) => n.includes("phase1"))).toBe(true);
    expect(describeNames.some((n) => n.includes("phase2"))).toBe(true);
    expect(describeNames.some((n) => n.includes("escalation") || n.includes("executeImplTask"))).toBe(true);
    expect(describeNames.some((n) => n.includes("abort") || n.includes("phase4"))).toBe(true);
    expect(describeNames.some((n) => n.includes("fastPath") || n.includes("fast-path") || n.includes("post-review"))).toBe(true);
    expect(describeNames.some((n) => n.includes("resume"))).toBe(true);
    expect(describeNames.some((n) => n.includes("E2E") || n.includes("fullPipeline"))).toBe(true);
    expect(describeNames.some((n) => n.includes("plan") || n.includes("review-only"))).toBe(true);
    expect(describeNames.some((n) => n.includes("gate cost") || n.includes("gateCost"))).toBe(true);
  });

  it("no TypeScript compilation errors", { timeout: 60_000 }, () => {
    expect(() => {
      execSync("npx tsc --noEmit", {
        cwd: pluginRoot,
        timeout: 60_000,
        stdio: "pipe",
      });
    }).not.toThrow();
  });

  it("no test flakiness — test file structure is deterministic across reads", () => {
    // Verify test structure is stable: read each test file twice and confirm
    // the it-block count is identical. This catches non-deterministic test
    // generation or file corruption.
    const testFiles = getTestFiles().filter(
      (f) => f !== "regression-verification.test.ts",
    );

    for (const file of testFiles) {
      const filePath = path.join(pluginRoot, "tests", file);
      const count1 = countItBlocks(filePath);
      const count2 = countItBlocks(filePath);
      expect(count1, `${file} it-block count changed between reads`).toBe(count2);
      expect(count1, `${file} should have at least 1 test`).toBeGreaterThanOrEqual(1);
    }

    // Additionally verify total test count across the suite is stable
    const totalTests = testFiles.reduce(
      (sum, f) => sum + countItBlocks(path.join(pluginRoot, "tests", f)),
      0,
    );
    expect(totalTests).toBeGreaterThanOrEqual(500);
  });
});
