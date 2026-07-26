/**
 * MLS Pi Extension — Project Tooling
 *
 * Auto-detection and execution of test suites, linters, and project orientation
 * context. All functions accept explicit `cwd`, `exec`, and `notify` parameters
 * so they can be called from the Orchestrator without direct `this` dependencies.
 */

import * as fs from "node:fs";
import { joinCwd, joinOutput, readPackageJson, getPackageManagerCommand } from "./helpers.js";
import type { CommandSpec } from "./helpers.js";

type ExecFn = (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string; code: number }>;
type NotifyFn = (msg: string, level: "info" | "warning" | "error" | "success") => void;

// ─── Test Running ─────────────────────────────────────────────────────────────

/**
 * Auto-detect and run the project's test suite.
 *
 * Detection order:
 * 1. `package.json` `scripts.test` → run via detected package manager (pnpm/yarn/bun/npm).
 * 2. `Makefile` → `make test`.
 * 3. `pyproject.toml` → `pytest`.
 * 4. `Cargo.toml` → `cargo test`.
 * 5. `go.mod` → `go test ./...`.
 * 6. None detected → returns `{ code: 0, stdout: "No test framework detected", stderr: "" }`.
 *
 * @param cwd    - Project working directory.
 * @param exec   - Instrumented exec function (emits events + dashboard progress).
 * @param notify - Notification callback for status messages.
 * @returns The test command's exit code, stdout, and stderr.
 */
export async function runTests(
  cwd: string,
  exec: ExecFn,
  notify: NotifyFn,
): Promise<{ stdout: string; stderr: string; code: number }> {
  const jsTest = getJavaScriptTestCommand(cwd);
  if (jsTest) {
    notify(`[CODE] Tests: ${jsTest.cmd} ${jsTest.args.join(" ")}`, "info");
    return exec(jsTest.cmd, jsTest.args);
  }

  const frameworks = [
    { file: "Makefile", cmd: "make", args: ["test"] },
    { file: "pyproject.toml", cmd: "pytest", args: [] },
    { file: "Cargo.toml", cmd: "cargo", args: ["test"] },
    { file: "go.mod", cmd: "go", args: ["test", "./..."] },
  ] as const;

  for (const fw of frameworks) {
    if (fs.existsSync(joinCwd(cwd, fw.file))) {
      notify(`[CODE] Tests: ${fw.cmd} ${fw.args.join(" ")}`, "info");
      return exec(fw.cmd, [...fw.args]);
    }
  }

  return { stdout: "No test framework detected", stderr: "", code: 0 };
}

// ─── Lint Running ─────────────────────────────────────────────────────────────

/**
 * Auto-detect and run the project's linter. No-ops silently if no linter config is found.
 *
 * Detection order (checks for config file presence):
 * 1. `package.json` `scripts.lint` → run via detected package manager.
 * 2. ESLint config files → `npx --no-install eslint .`.
 * 3. Biome config → `npx --no-install biome check .`.
 * 4. Prettier config → `npx --no-install prettier --check .`.
 *
 * @param cwd    - Project working directory.
 * @param exec   - Instrumented exec function.
 * @param notify - Notification callback for status messages.
 * @throws If the detected linter exits with a non-zero code.
 */
export async function runLint(
  cwd: string,
  exec: ExecFn,
  notify: NotifyFn,
): Promise<void> {
  const command = findLintCommand(cwd);
  if (!command) {
    return;
  }

  await runCheckedCommand(command, exec, notify, "Lint");
}

// ─── Project Orientation ──────────────────────────────────────────────────────

/**
 * Return a listing of all source files in the project for agent orientation context.
 *
 * Runs `find` to collect source files, excluding build artifacts and vendor directories.
 * Returns an empty string for empty projects (no matching files), which signals
 * the caller to run the scaffolding step.
 *
 * Returned format:
 * ```
 * ## Project Structure
 * ```
 * path/to/file.ts
 * ...
 * ```
 * ```
 *
 * @param cwd       - Project working directory.
 * @param execQuiet - Silent exec function (no events or spinner).
 * @returns The formatted project structure string, or `""` if the project is empty.
 */
export async function detectProjectOrientation(
  cwd: string,
  execQuiet: ExecFn,
): Promise<string> {
  const result = await execQuiet("find", [
    ".", "-type", "f",
    "-not", "-path", "*/node_modules/*",
    "-not", "-path", "*/.git/*",
    "-not", "-path", "*/dist/*",
    "-not", "-path", "*/out/*",
    "-not", "-path", "*/build/*",
    "-not", "-path", "*/vendor/*",
    "-not", "-path", "*/__pycache__/*",
    "-not", "-path", "*/.next/*",
    "-not", "-path", "*/.mls/*",
    "(",
      "-name", "*.ts", "-o", "-name", "*.tsx",
      "-o", "-name", "*.js", "-o", "-name", "*.jsx",
      "-o", "-name", "*.py", "-o", "-name", "*.go",
      "-o", "-name", "*.rs", "-o", "-name", "*.java",
      "-o", "-name", "*.vue", "-o", "-name", "*.svelte",
      "-o", "-name", "package.json",
      "-o", "-name", "tsconfig.json",
      "-o", "-name", "pyproject.toml",
      "-o", "-name", "Cargo.toml",
      "-o", "-name", "go.mod",
    ")",
  ]);

  if (result.code !== 0 || !result.stdout.trim()) {
    return "";
  }

  const files = result.stdout.trim().split("\n")
    .map((f) => f.replace(/^\.\//, ""))
    .sort()
    .slice(0, 100);

  return `## Project Structure\n\`\`\`\n${files.join("\n")}\n\`\`\``;
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

/**
 * Detect the project's lint command from config-file presence.
 *
 * Detection order:
 * 1. `package.json` `scripts.lint` → run via detected package manager.
 * 2. ESLint config files → `npx --no-install eslint .`.
 * 3. Biome config → `npx --no-install biome check .`.
 * 4. Prettier config → `npx --no-install prettier --check .`.
 *
 * @returns The detected lint command spec, or `null` if no linter is configured.
 */
function findLintCommand(cwd: string): CommandSpec | null {
  const scriptLint = getPackageScriptCommand(cwd, "lint");
  if (scriptLint) {
    return scriptLint;
  }

  const linters: Array<{ files: string[]; command: CommandSpec }> = [
    {
      files: ["eslint.config.js", "eslint.config.cjs", "eslint.config.mjs", ".eslintrc", ".eslintrc.js", ".eslintrc.cjs", ".eslintrc.json", ".eslintrc.yaml", ".eslintrc.yml"],
      command: { cmd: "npx", args: ["--no-install", "eslint", "."] },
    },
    {
      files: ["biome.json", "biome.jsonc"],
      command: { cmd: "npx", args: ["--no-install", "biome", "check", "."] },
    },
    {
      files: [".prettierrc", ".prettierrc.js", ".prettierrc.cjs", ".prettierrc.json", ".prettierrc.yaml", ".prettierrc.yml", "prettier.config.js", "prettier.config.cjs", "prettier.config.mjs"],
      command: { cmd: "npx", args: ["--no-install", "prettier", "--check", "."] },
    },
  ];

  for (const linter of linters) {
    if (linter.files.some((file) => fs.existsSync(joinCwd(cwd, file)))) {
      return linter.command;
    }
  }

  return null;
}

/**
 * Run a command and throw a descriptive error if it exits non-zero.
 *
 * Notifies the user via the info channel before running. Used by `runLint` and
 * can be reused for any deterministic CLI gate that must pass to continue.
 *
 * @param command - Command spec to execute.
 * @param exec    - Instrumented exec function.
 * @param notify  - Notification callback.
 * @param label   - Human-readable name shown in the notification and error message (e.g. `"Lint"`).
 * @throws If the command exits with a non-zero code.
 */
async function runCheckedCommand(
  command: CommandSpec,
  exec: ExecFn,
  notify: NotifyFn,
  label: string,
): Promise<void> {
  notify(`[CODE] ${label}: ${command.cmd} ${command.args.join(" ")}`, "info");
  const result = await exec(command.cmd, command.args);
  if (result.code !== 0) {
    throw new Error(`${label} failed:\n${joinOutput(result.stdout, result.stderr)}`);
  }
}

/**
 * Detect the JavaScript/TypeScript test command from `package.json`.
 *
 * Returns `null` when `package.json` is missing, has no `scripts` field, or the
 * `test` script is absent or empty (which would cause npm to run a placeholder).
 *
 * @param cwd - Project working directory.
 * @returns Command spec for running the test suite, or `null` if not applicable.
 */
function getJavaScriptTestCommand(cwd: string): { cmd: string; args: string[] } | null {
  const pkg = readPackageJson(cwd);
  if (!pkg?.scripts || typeof pkg.scripts.test !== "string" || pkg.scripts.test.trim() === "") {
    return null;
  }

  return getPackageManagerCommand(cwd, "test");
}

/**
 * Build the package manager command for a named npm script.
 *
 * Returns `null` when `package.json` is absent, has no matching script, or the
 * script value is empty. Delegates package manager detection to
 * {@link getPackageManagerCommand}.
 *
 * @param cwd        - Project working directory.
 * @param scriptName - npm script name to look up (e.g. `"lint"`, `"build"`).
 * @returns Command spec for running the script, or `null` if not defined.
 */
function getPackageScriptCommand(cwd: string, scriptName: string): { cmd: string; args: string[] } | null {
  const pkg = readPackageJson(cwd);
  if (!pkg?.scripts || typeof pkg.scripts[scriptName] !== "string" || (pkg.scripts[scriptName] as string).trim() === "") {
    return null;
  }

  return getPackageManagerCommand(cwd, scriptName);
}
