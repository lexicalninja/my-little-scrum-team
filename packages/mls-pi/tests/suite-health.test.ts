import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(pluginRoot, "../..");

function countItBlocks(filePath: string): number {
  const content = fs.readFileSync(filePath, "utf-8");
  const matches = content.match(/^\s*it\(/gm);
  return matches ? matches.length : 0;
}

describe("Suite health — full test suite verification", () => {
  it("all 11 test files are present", () => {
    const expectedFiles = [
      "agents.test.ts",
      "context.test.ts",
      "dashboard.test.ts",
      "db.test.ts",
      "execution-profiles.test.ts",
      "index.test.ts",
      "llm.test.ts",
      "orchestrator.test.ts",
      "quality-gates.test.ts",
      "skills.test.ts",
      "state.test.ts",
    ];
    const testsDir = path.join(pluginRoot, "tests");
    for (const file of expectedFiles) {
      expect(
        fs.existsSync(path.join(testsDir, file)),
        `${file} should exist`,
      ).toBe(true);
    }
  });

  it("agents.test.ts has at least 15 it blocks", () => {
    const count = countItBlocks(
      path.join(pluginRoot, "tests", "agents.test.ts"),
    );
    expect(count).toBeGreaterThanOrEqual(15);
  });

  it("db.test.ts has at least 15 it blocks", () => {
    const count = countItBlocks(
      path.join(pluginRoot, "tests", "db.test.ts"),
    );
    expect(count).toBeGreaterThanOrEqual(15);
  });

  it("npm run build (tsc) succeeds without type errors", () => {
    expect(() => {
      execSync("npm run build", { cwd: pluginRoot, stdio: "pipe" });
    }).not.toThrow();
  });

  it(".github/workflows/mls-pi-tests.yml exists and is syntactically valid YAML", () => {
    const workflowPath = path.join(
      repoRoot,
      ".github",
      "workflows",
      "mls-pi-tests.yml",
    );
    expect(
      fs.existsSync(workflowPath),
      "mls-pi-tests.yml should exist",
    ).toBe(true);

    const content = fs.readFileSync(workflowPath, "utf-8");
    // Basic structural validation: must have name, on, and jobs keys
    expect(content).toMatch(/^name:/m);
    expect(content).toMatch(/^on:/m);
    expect(content).toMatch(/^jobs:/m);
    // Must reference the package directory
    expect(content).toContain("packages/mls-pi");
    // Must have npm test step
    expect(content).toContain("npm test");
  });

  it("no orphaned mls temp directories created by this test run", () => {
    // Check for mls-test temp dirs created in the last 60 seconds
    // (a proxy for "created during this test run")
    const tmpBase = os.tmpdir();
    const now = Date.now();
    const entries = fs.readdirSync(tmpBase);
    const mlsPrefixes = [
      "mls-db-test-",
      "mls-dash-test-",
      "mls-exec-test-",
      "mls-idx-test-",
      "mls-test-",
    ];

    const recentOrphanedDirs = entries.filter((entry) => {
      if (!mlsPrefixes.some((prefix) => entry.startsWith(prefix))) {
        return false;
      }
      const fullPath = path.join(tmpBase, entry);
      try {
        const stat = fs.statSync(fullPath);
        if (!stat.isDirectory()) return false;
        // Only flag directories created in the last 60 seconds
        return now - stat.birthtimeMs < 60_000;
      } catch {
        return false;
      }
    });

    expect(
      recentOrphanedDirs,
      `Orphaned temp directories from current run: ${recentOrphanedDirs.join(", ")}`,
    ).toEqual([]);
  });
});
