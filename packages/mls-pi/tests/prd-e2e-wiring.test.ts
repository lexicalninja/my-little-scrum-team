/**
 * TASK-005: End-to-end wiring verification tests.
 *
 * These tests verify the complete integration of the /prd command:
 * - prd.test.ts contains all expected tests (27 original + new from TASK-004)
 * - index.ts compiles without TypeScript errors
 * - No regressions in other test files
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, "..");
const testsDir = path.join(pluginRoot, "tests");

function countItBlocks(filePath: string): number {
  const content = fs.readFileSync(filePath, "utf-8");
  const matches = content.match(/^\s*it\(/gm);
  return matches ? matches.length : 0;
}

describe("TASK-005: End-to-end wiring verification", () => {
  it("prd.test.ts contains at least 30 tests (27 existing + 3 new from TASK-004)", () => {
    const count = countItBlocks(path.join(testsDir, "prd.test.ts"));
    expect(count).toBeGreaterThanOrEqual(30);
  });

  it("prd.test.ts passes all tests via vitest run", () => {
    expect(() => {
      execSync("npx vitest run tests/prd.test.ts", {
        cwd: pluginRoot,
        stdio: "pipe",
        timeout: 30_000,
      });
    }).not.toThrow();
  });

  it("index.ts has no TypeScript compilation errors", () => {
    expect(() => {
      execSync("npx tsc --noEmit", {
        cwd: pluginRoot,
        stdio: "pipe",
        timeout: 30_000,
      });
    }).not.toThrow();
  });

  it("prd-guard.test.ts passes all tests (non-interactive mode guard)", () => {
    expect(() => {
      execSync("npx vitest run tests/prd-guard.test.ts", {
        cwd: pluginRoot,
        stdio: "pipe",
        timeout: 30_000,
      });
    }).not.toThrow();
  });

  it("promptUser-wiring.test.ts passes all tests (ctx.ui.input integration)", () => {
    expect(() => {
      execSync("npx vitest run tests/promptUser-wiring.test.ts", {
        cwd: pluginRoot,
        stdio: "pipe",
        timeout: 30_000,
      });
    }).not.toThrow();
  });

  it("no regressions in non-PRD test files", () => {
    // Run all non-PRD, non-dashboard test files in one vitest invocation
    // Dashboard excluded due to pre-existing EADDRINUSE port conflict
    const nonPrdFiles = [
      "tests/agents.test.ts",
      "tests/context.test.ts",
      "tests/db.test.ts",
      "tests/execution-profiles.test.ts",
      "tests/index.test.ts",
      "tests/llm.test.ts",
      "tests/orchestrator.test.ts",
      "tests/quality-gates.test.ts",
      "tests/skills.test.ts",
      "tests/state.test.ts",
    ].join(" ");

    expect(() => {
      execSync(`npx vitest run ${nonPrdFiles}`, {
        cwd: pluginRoot,
        stdio: "pipe",
        timeout: 60_000,
      });
    }).not.toThrow();
  }, 90_000);
});
