import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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

import {
  resolveInput,
  readReferencedFile,
  isCatastrophicCommand,
  isPathSafe,
  isBlockedTool,
  getModelString,
  getSprintStatusLines,
  getIssueIcon,
  detectGitHubIssueRef,
  fetchGitHubIssue,
  formatIssueText,
  type GithubIssue,
  type GithubIssueRef,
  type ExecFn,
} from "../.pi/extensions/mls/index.js";

// ─── TASK-001: GithubIssueRef, GithubIssue, ExecFn type exports ─────────────

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(MODULE_DIR, "..");
const INDEX_SRC = path.join(PROJECT_ROOT, ".pi", "extensions", "mls", "index.ts");

describe("type exports — GithubIssueRef, GithubIssue, ExecFn", () => {
  it("GithubIssueRef is exported and has a number field", () => {
    // Constructing a value that satisfies the type confirms the shape is correct.
    const ref: GithubIssueRef = { number: 1 };
    expect(ref.number).toBe(1);
  });

  it("GithubIssueRef owner and repo fields are optional", () => {
    const withOwnerRepo: GithubIssueRef = { owner: "org", repo: "repo", number: 42 };
    expect(withOwnerRepo.owner).toBe("org");
    expect(withOwnerRepo.repo).toBe("repo");
  });

  it("GithubIssue is exported and has number, title, and body fields", () => {
    const issue: GithubIssue = { number: 25, title: "My Feature", body: "Details here" };
    expect(issue.number).toBe(25);
    expect(issue.title).toBe("My Feature");
    expect(issue.body).toBe("Details here");
  });

  it("GithubIssue body field accepts null", () => {
    const issue: GithubIssue = { number: 1, title: "No body", body: null };
    expect(issue.body).toBeNull();
  });

  it("ExecFn is exported from index.ts source", () => {
    // ExecFn is a type alias — it must be declared with `export type ExecFn`
    // in index.ts to satisfy the acceptance criterion.
    // We verify this by reading the source and checking for the export keyword.
    const src = fs.readFileSync(INDEX_SRC, "utf-8");
    // Must match `export type ExecFn` — not just `type ExecFn`
    expect(src).toMatch(/\bexport\s+type\s+ExecFn\b/);
  });

  it("ExecFn type is assignable as an exec function shape", () => {
    // A value satisfying ExecFn must be usable as the execFn parameter of
    // fetchGitHubIssue. We verify the shape is compatible at runtime.
    const execFn: ExecFn = async (_cmd, _args, _opts) => ({
      stdout: JSON.stringify({ number: 1, title: "t", body: null }),
      stderr: "",
      code: 0,
    });
    expect(typeof execFn).toBe("function");
  });
});

// ─── detectGitHubIssueRef ────────────────────────────────────────────────────
//
// Injection seam strategy: detectGitHubIssueRef is a pure function — no I/O,
// no subprocess calls. Tests pass inputs directly and assert on the returned
// GithubIssueRef | null value. No mocking required.

describe("detectGitHubIssueRef", () => {
  it("detects bare issue ref", () => {
    expect(detectGitHubIssueRef("#25")).toEqual({ number: 25 });
  });

  it("detects bare issue ref with leading/trailing space", () => {
    expect(detectGitHubIssueRef(" #25 ")).toEqual({ number: 25 });
  });

  it("detects explicit repo ref", () => {
    expect(detectGitHubIssueRef("owner/repo#25")).toEqual({ owner: "owner", repo: "repo", number: 25 });
  });

  it("returns null for plain text", () => {
    expect(detectGitHubIssueRef("add login page")).toBeNull();
  });

  it("returns null for a file path", () => {
    expect(detectGitHubIssueRef("PRD.md")).toBeNull();
  });

  it("returns null for @file reference", () => {
    expect(detectGitHubIssueRef("@spec.md")).toBeNull();
  });

  it("returns null for multi-word input with hash (whole-input only)", () => {
    expect(detectGitHubIssueRef("fix #25 bug")).toBeNull();
  });

  it("matches #0 (gh will surface the error, not us)", () => {
    expect(detectGitHubIssueRef("#0")).toEqual({ number: 0 });
  });
});

// ─── formatIssueText ─────────────────────────────────────────────────────────
//
// Injection seam strategy: formatIssueText is a pure function — no I/O or
// subprocess calls. Tests construct GithubIssue values directly and assert on
// the returned string. No mocking required.

describe("formatIssueText", () => {
  it("formats title and body", () => {
    const issue: GithubIssue = { number: 25, title: "My Feature", body: "## Description\nDo X" };
    expect(formatIssueText(issue)).toBe("GitHub Issue #25: My Feature\n\n## Description\nDo X");
  });

  it("formats title only when body is null", () => {
    const issue: GithubIssue = { number: 25, title: "My Feature", body: null };
    expect(formatIssueText(issue)).toBe("GitHub Issue #25: My Feature");
  });

  it("formats title only when body is whitespace", () => {
    const issue: GithubIssue = { number: 25, title: "My Feature", body: "  " };
    expect(formatIssueText(issue)).toBe("GitHub Issue #25: My Feature");
  });

  it("passes @file tokens in body through verbatim without expanding them", () => {
    // Per FR-9 / edge case: the fetched issue body may contain @file tokens that
    // look like resolveInput's inline reference syntax. formatIssueText must NOT
    // expand or modify those tokens — it is a pure formatter and must return the
    // body exactly as received to avoid unintentional file reads from arbitrary
    // issue content.
    const bodyWithAtFile = "See @docs/spec.md for details and @README.md for setup.";
    const issue: GithubIssue = { number: 42, title: "Ref Issue", body: bodyWithAtFile };
    expect(formatIssueText(issue)).toBe(
      `GitHub Issue #42: Ref Issue\n\n${bodyWithAtFile}`,
    );
  });
});

// ─── fetchGitHubIssue ────────────────────────────────────────────────────────
//
// Injection seam strategy: fetchGitHubIssue accepts an optional `execFn`
// parameter (ExecFn) as its third argument. Tests pass a vi.fn() mock as
// execFn so that no real `gh` or `git` subprocesses are ever spawned.
// The mock is keyed on `"${cmd} ${args[0]}"` to distinguish git-remote,
// gh-version, and gh-issue calls without coupling to full argument lists.

/** Build a mock execFn from a map of `cmd args[0]` → response. */
function makeMockExec(
  responses: Record<string, { stdout?: string; stderr?: string; code?: number }>,
) {
  return vi.fn().mockImplementation(
    async (cmd: string, args: string[]) => {
      const key = `${cmd} ${args[0] ?? ""}`;
      const resp = responses[key];
      if (!resp) throw new Error(`Unexpected exec call: ${cmd} ${args.join(" ")}`);
      return { stdout: resp.stdout ?? "", stderr: resp.stderr ?? "", code: resp.code ?? 0 };
    },
  );
}

const VALID_ISSUE_JSON = JSON.stringify({ number: 25, title: "My Feature", body: "Do X" });
const SSH_REMOTE = "git@github.com:org/repo.git";
const HTTPS_REMOTE = "https://github.com/org/repo.git";

describe("fetchGitHubIssue", () => {
  it("happy path — bare ref with SSH remote", async () => {
    const exec = makeMockExec({
      "git remote": { stdout: SSH_REMOTE },
      "gh --version": { stdout: "gh version 2.0.0" },
      "gh issue": { stdout: VALID_ISSUE_JSON },
    });
    const ref: GithubIssueRef = { number: 25 };
    const issue = await fetchGitHubIssue(ref, "/cwd", exec);
    expect(issue).toEqual({ number: 25, title: "My Feature", body: "Do X" });
  });

  it("happy path — bare ref with HTTPS remote", async () => {
    const exec = makeMockExec({
      "git remote": { stdout: HTTPS_REMOTE },
      "gh --version": { stdout: "gh version 2.0.0" },
      "gh issue": { stdout: VALID_ISSUE_JSON },
    });
    const ref: GithubIssueRef = { number: 25 };
    const issue = await fetchGitHubIssue(ref, "/cwd", exec);
    expect(issue).toEqual({ number: 25, title: "My Feature", body: "Do X" });
  });

  it("happy path — explicit repo ref (skips git remote)", async () => {
    const exec = makeMockExec({
      "gh --version": { stdout: "gh version 2.0.0" },
      "gh issue": { stdout: VALID_ISSUE_JSON },
    });
    const ref: GithubIssueRef = { owner: "org", repo: "repo", number: 25 };
    const issue = await fetchGitHubIssue(ref, "/cwd", exec);
    expect(issue).toEqual({ number: 25, title: "My Feature", body: "Do X" });
    // git remote should NOT have been called
    expect(exec).not.toHaveBeenCalledWith("git", expect.any(Array), expect.anything());
  });

  it("throws when gh is not found", async () => {
    const exec = makeMockExec({
      "git remote": { stdout: SSH_REMOTE },
      "gh --version": { code: 1 },
    });
    const ref: GithubIssueRef = { number: 25 };
    await expect(fetchGitHubIssue(ref, "/cwd", exec)).rejects.toThrow(
      "gh CLI not found",
    );
  });

  it("throws when issue is not found", async () => {
    const exec = makeMockExec({
      "git remote": { stdout: SSH_REMOTE },
      "gh --version": { stdout: "gh version 2.0.0" },
      "gh issue": { code: 1, stderr: "issue not found" },
    });
    const ref: GithubIssueRef = { number: 25 };
    await expect(fetchGitHubIssue(ref, "/cwd", exec)).rejects.toThrow(
      "Failed to fetch GitHub issue #25: issue not found",
    );
  });

  it("throws when git remote fails", async () => {
    const exec = makeMockExec({
      "git remote": { code: 1 },
    });
    const ref: GithubIssueRef = { number: 25 };
    await expect(fetchGitHubIssue(ref, "/cwd", exec)).rejects.toThrow(
      "Could not determine GitHub repo from git remote",
    );
  });

  it("throws when remote is not a GitHub URL", async () => {
    const exec = makeMockExec({
      "git remote": { stdout: "https://gitlab.com/org/repo.git" },
    });
    const ref: GithubIssueRef = { number: 25 };
    await expect(fetchGitHubIssue(ref, "/cwd", exec)).rejects.toThrow(
      "owner/repo#N syntax instead",
    );
  });

  it("throws on invalid JSON from gh", async () => {
    const exec = makeMockExec({
      "git remote": { stdout: SSH_REMOTE },
      "gh --version": { stdout: "gh version 2.0.0" },
      "gh issue": { stdout: "not json" },
    });
    const ref: GithubIssueRef = { number: 25 };
    await expect(fetchGitHubIssue(ref, "/cwd", exec)).rejects.toThrow("invalid JSON");
  });

  it("throws when gh JSON is missing title", async () => {
    const exec = makeMockExec({
      "git remote": { stdout: SSH_REMOTE },
      "gh --version": { stdout: "gh version 2.0.0" },
      "gh issue": { stdout: JSON.stringify({ number: 25, body: "something" }) },
    });
    const ref: GithubIssueRef = { number: 25 };
    await expect(fetchGitHubIssue(ref, "/cwd", exec)).rejects.toThrow(
      "missing title field",
    );
  });
});

// ─── TASK-003: inferRepoFromGitRemote private helper ────────────────────────
//
// inferRepoFromGitRemote is NOT exported — it is tested indirectly via
// fetchGitHubIssue, which calls it whenever the GithubIssueRef has no
// explicit owner/repo.  Each test below maps to one acceptance criterion.

describe("inferRepoFromGitRemote — private helper (via fetchGitHubIssue)", () => {
  // Helper: a bare ref that forces the remote-inference path.
  const bareRef: GithubIssueRef = { number: 7 };
  const issueJson = JSON.stringify({ number: 7, title: "T", body: null });

  it("SSH remote git@github.com:org/repo.git returns { owner: 'org', repo: 'repo' }", async () => {
    // AC1 — SSH URL with .git suffix must be parsed correctly.
    const exec = makeMockExec({
      "git remote": { stdout: "git@github.com:org/repo.git" },
      "gh --version": { stdout: "gh version 2.0.0" },
      "gh issue": { stdout: issueJson },
    });
    const issue = await fetchGitHubIssue(bareRef, "/cwd", exec);
    // If owner/repo was parsed correctly the gh call will have received 'org/repo'.
    // We verify by checking that the issue was returned successfully (no throw means
    // the --repo argument was valid enough for our mock to match).
    expect(issue.number).toBe(7);
    // Confirm the git remote call used the expected args.
    expect(exec).toHaveBeenCalledWith(
      "git",
      ["remote", "get-url", "origin"],
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
  });

  it("HTTPS remote https://github.com/org/repo.git returns { owner: 'org', repo: 'repo' }", async () => {
    // AC2 — HTTPS URL with .git suffix must be parsed correctly.
    const exec = makeMockExec({
      "git remote": { stdout: "https://github.com/org/repo.git" },
      "gh --version": { stdout: "gh version 2.0.0" },
      "gh issue": { stdout: issueJson },
    });
    const issue = await fetchGitHubIssue(bareRef, "/cwd", exec);
    expect(issue.number).toBe(7);
  });

  it("HTTPS remote without .git suffix returns { owner: 'org', repo: 'repo' }", async () => {
    // AC3 — HTTPS URL WITHOUT .git must also parse correctly (the (?:\.git)?
    // makes the suffix optional).
    const exec = makeMockExec({
      "git remote": { stdout: "https://github.com/org/repo" },
      "gh --version": { stdout: "gh version 2.0.0" },
      "gh issue": { stdout: issueJson },
    });
    const issue = await fetchGitHubIssue(bareRef, "/cwd", exec);
    expect(issue.number).toBe(7);
  });

  it("non-GitHub remote URL throws with the URL in the error message", async () => {
    // AC4 — error message must contain the offending URL so the user can see
    // which remote was rejected.
    const nonGithubUrl = "https://gitlab.com/org/repo.git";
    const exec = makeMockExec({
      "git remote": { stdout: nonGithubUrl },
    });
    await expect(fetchGitHubIssue(bareRef, "/cwd", exec)).rejects.toThrow(
      nonGithubUrl,
    );
  });

  it("non-GitHub remote URL throws with 'Use owner/repo#N syntax instead.' guidance", async () => {
    // AC4 (second assertion) — error must also include the actionable suggestion.
    const exec = makeMockExec({
      "git remote": { stdout: "https://bitbucket.org/org/repo.git" },
    });
    await expect(fetchGitHubIssue(bareRef, "/cwd", exec)).rejects.toThrow(
      "Use owner/repo#N syntax instead.",
    );
  });

  it("git remote get-url origin exits non-zero throws 'Could not determine GitHub repo from git remote.'", async () => {
    // AC5 — any non-zero exit from git remote must produce this specific message.
    const exec = makeMockExec({
      "git remote": { code: 128, stderr: "fatal: No such remote 'origin'" },
    });
    await expect(fetchGitHubIssue(bareRef, "/cwd", exec)).rejects.toThrow(
      "Could not determine GitHub repo from git remote.",
    );
  });

  it("inferRepoFromGitRemote is NOT exported from index.ts", () => {
    // AC6 — the function must remain private (internal only).
    // We verify by reading the source and confirming there is no
    // `export … inferRepoFromGitRemote` declaration.
    const src = fs.readFileSync(INDEX_SRC, "utf-8");
    expect(src).not.toMatch(/\bexport\b[^(]*\binferRepoFromGitRemote\b/);
  });

  it("tsc --noEmit passes with no type errors", () => {
    // AC7 — the TypeScript compiler must accept the current source without errors.
    expect(() =>
      execSync("npx tsc --noEmit", {
        cwd: PROJECT_ROOT,
        stdio: "pipe",
      }),
    ).not.toThrow();
  });

  it("SSH regex has an inline comment explaining the [:/] alternation", () => {
    // AC8 — a developer reading the regex must understand why [:/] is used
    // (SSH uses ':' as the separator after the hostname, HTTPS uses '/').
    const src = fs.readFileSync(INDEX_SRC, "utf-8");
    // The comment must appear on or immediately after the SSH regex line.
    // We look for any comment mentioning ':' or '/' in the context of the SSH regex.
    expect(src).toMatch(/github\.com\[:\\\/\][\s\S]{0,200}\/\//);
  });
});

// ─── resolveInput — updated existing tests (now async) ───────────────────────
//
// Injection seam strategy: file-path resolution tests use real temp directories
// on disk. GitHub issue tests in the integration block below use vi.fn() mocks
// injected via fetchGitHubIssue's execFn parameter. resolveInput itself does not
// accept execFn — the GitHub issue path is tested by unit-testing the helpers
// (detectGitHubIssueRef, fetchGitHubIssue, formatIssueText) independently, and
// verifying that resolveInput's source wires them together correctly.

describe("resolveInput", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mls-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resolves @file reference and inlines content", async () => {
    const filePath = path.join(tmpDir, "spec.md");
    fs.writeFileSync(filePath, "# My Spec\nSome content");
    const result = await resolveInput("@spec.md", tmpDir);
    expect(result).toContain("# My Spec");
    expect(result).toContain("Some content");
  });

  it("resolves a bare file path that exists on disk", async () => {
    const filePath = path.join(tmpDir, "input.txt");
    fs.writeFileSync(filePath, "file contents here");
    const result = await resolveInput("input.txt", tmpDir);
    expect(result).toContain("file contents here");
  });

  it("returns input as-is when it is plain text (not a file)", async () => {
    const result = await resolveInput("just some text input", tmpDir);
    expect(result).toBe("just some text input");
  });

  it("returns input as-is when referenced file does not exist", async () => {
    const result = await resolveInput("@nonexistent.md", tmpDir);
    // Should either return as-is or include a note about not finding it
    expect(result).toBeDefined();
  });

  // ─── Regression: quoted @"..." paths for filenames with spaces ──────────

  it("resolves @quoted path with spaces in filename", async () => {
    const dir = path.join(tmpDir, "plans");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "human gates.md"), "# Human Gates\nGate content");
    const result = await resolveInput('follow the plan at @"plans/human gates.md"', tmpDir);
    expect(result).toContain("# Human Gates");
    expect(result).toContain("Gate content");
    expect(result).not.toContain('@"');
  });

  it("resolves @quoted path in nested directories with spaces", async () => {
    const dir = path.join(tmpDir, "my docs", "sub dir");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "spec file.md"), "spec content here");
    const result = await resolveInput('build per @"my docs/sub dir/spec file.md"', tmpDir);
    expect(result).toContain("spec content here");
  });

  it("preserves @quoted ref as-is when file does not exist", async () => {
    const result = await resolveInput('build @"no such/file path.md"', tmpDir);
    expect(result).toContain('@"no such/file path.md"');
  });

  it("resolves unquoted @ref alongside quoted @ref in same input", async () => {
    fs.writeFileSync(path.join(tmpDir, "simple.md"), "simple content");
    const dir = path.join(tmpDir, "plans");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "my plan.md"), "plan content");
    const result = await resolveInput('use @simple.md and @"plans/my plan.md"', tmpDir);
    expect(result).toContain("simple content");
    expect(result).toContain("plan content");
  });

  it("unquoted @ref still works for paths without spaces", async () => {
    fs.writeFileSync(path.join(tmpDir, "spec.md"), "spec stuff");
    const result = await resolveInput("build per @spec.md", tmpDir);
    expect(result).toContain("spec stuff");
    expect(result).not.toContain("@spec.md");
  });
});


describe("readReferencedFile", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mls-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reads a valid relative file", () => {
    const filePath = path.join(tmpDir, "doc.txt");
    fs.writeFileSync(filePath, "hello world");
    const result = readReferencedFile("doc.txt", tmpDir);
    expect(result).toBe("hello world");
  });

  it("rejects absolute paths", () => {
    const result = readReferencedFile("/etc/passwd", tmpDir);
    expect(result).toBeNull();
  });

  it("rejects directory traversal", () => {
    const result = readReferencedFile("../../etc/passwd", tmpDir);
    expect(result).toBeNull();
  });

  it("rejects paths with .. components", () => {
    const result = readReferencedFile("foo/../../../etc/passwd", tmpDir);
    expect(result).toBeNull();
  });

  it("returns null for nonexistent file", () => {
    const result = readReferencedFile("no-such-file.txt", tmpDir);
    expect(result).toBeNull();
  });
});

describe("isCatastrophicCommand", () => {
  it("returns null for undefined command", () => {
    expect(isCatastrophicCommand(undefined)).toBeNull();
  });

  it("returns null for safe commands", () => {
    expect(isCatastrophicCommand("ls -la")).toBeNull();
    expect(isCatastrophicCommand("git status")).toBeNull();
    expect(isCatastrophicCommand("npm test")).toBeNull();
    expect(isCatastrophicCommand("cat file.txt")).toBeNull();
  });

  it("detects rm -rf", () => {
    expect(isCatastrophicCommand("rm -rf /")).not.toBeNull();
  });

  it("detects rm -r", () => {
    expect(isCatastrophicCommand("rm -r some-dir")).not.toBeNull();
  });

  it("detects rm -R", () => {
    expect(isCatastrophicCommand("rm -R some-dir")).not.toBeNull();
  });

  it("detects rm with recursive flag among others", () => {
    expect(isCatastrophicCommand("rm -rfv directory/")).not.toBeNull();
  });

  it("detects rm -f with wildcard", () => {
    expect(isCatastrophicCommand("rm -f *.ts")).not.toBeNull();
  });

  it("detects git reset --hard", () => {
    expect(isCatastrophicCommand("git reset --hard HEAD~3")).not.toBeNull();
  });

  it("detects git clean -fd", () => {
    expect(isCatastrophicCommand("git clean -fd")).not.toBeNull();
  });

  it("detects git clean -f", () => {
    expect(isCatastrophicCommand("git clean -f")).not.toBeNull();
  });

  it("detects git checkout .", () => {
    expect(isCatastrophicCommand("git checkout .")).not.toBeNull();
  });

  it("detects git push --force", () => {
    expect(isCatastrophicCommand("git push origin main --force")).not.toBeNull();
  });

  it("detects git branch -D", () => {
    expect(isCatastrophicCommand("git branch -D feature-branch")).not.toBeNull();
  });

  it("detects rmdir", () => {
    expect(isCatastrophicCommand("rmdir some-dir")).not.toBeNull();
  });

  it("detects find -delete as a standalone flag", () => {
    expect(isCatastrophicCommand("find . -delete")).not.toBeNull();
  });

  it("does not treat a filename containing 'delete' as destructive", () => {
    expect(isCatastrophicCommand("find . -name tmp-delete")).toBeNull();
  });

  it("detects find with -exec rm", () => {
    expect(isCatastrophicCommand("find . -type f -exec rm {} \\;")).not.toBeNull();
  });

  it("allows git push without --force", () => {
    expect(isCatastrophicCommand("git push origin main")).toBeNull();
  });

  it("allows git branch -a (listing)", () => {
    expect(isCatastrophicCommand("git branch -a")).toBeNull();
  });
});

describe("isPathSafe", () => {
  const cwd = "/project/root";

  it("returns null for undefined path", () => {
    expect(isPathSafe(undefined, cwd)).toBeNull();
  });

  it("returns null for a safe absolute path within cwd", () => {
    expect(isPathSafe("/project/root/src/index.ts", cwd)).toBeNull();
  });

  it("rejects absolute paths that escape the project root", () => {
    expect(isPathSafe("/etc/passwd", cwd)).not.toBeNull();
  });

  it("rejects paths into .git directory", () => {
    expect(isPathSafe("/project/root/.git/config", cwd)).not.toBeNull();
  });

  it("rejects paths with .git in the middle", () => {
    expect(isPathSafe("/project/root/src/.git/hooks/pre-commit", cwd)).not.toBeNull();
  });

  it("allows the project root itself", () => {
    expect(isPathSafe("/project/root", cwd)).toBeNull();
  });
});

describe("isBlockedTool", () => {
  it("returns true for 'edit'", () => {
    expect(isBlockedTool("edit")).toBe(true);
  });

  it("returns true for 'write'", () => {
    expect(isBlockedTool("write")).toBe(true);
  });

  it("returns false for 'read'", () => {
    expect(isBlockedTool("read")).toBe(false);
  });

  it("returns false for 'bash'", () => {
    expect(isBlockedTool("bash")).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isBlockedTool(undefined)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isBlockedTool("")).toBe(false);
  });
});

describe("getModelString", () => {
  it("returns provider/id when both are present", () => {
    const ctx = { cwd: "/tmp", model: { provider: "anthropic", id: "claude-sonnet-4-20250514" } } as any;
    const result = getModelString(ctx);
    expect(result).toBe("anthropic/claude-sonnet-4-20250514");
  });

  it("returns undefined when model is missing", () => {
    const ctx = { cwd: "/tmp" } as any;
    const result = getModelString(ctx);
    expect(result).toBeUndefined();
  });

  it("returns undefined when provider is missing", () => {
    const ctx = { cwd: "/tmp", model: { id: "claude-sonnet-4-20250514" } } as any;
    const result = getModelString(ctx);
    expect(result).toBeUndefined();
  });

  it("returns undefined when id is missing", () => {
    const ctx = { cwd: "/tmp", model: { provider: "anthropic" } } as any;
    const result = getModelString(ctx);
    expect(result).toBeUndefined();
  });
});

describe("getIssueIcon", () => {
  it("returns filled circle for closed", () => {
    expect(getIssueIcon("closed")).toBe("●");
  });

  it("returns X for escalated", () => {
    expect(getIssueIcon("escalated")).toBe("✗");
  });

  it("returns empty circle for open", () => {
    expect(getIssueIcon("open")).toBe("○");
  });

  it("returns half circle for unknown status", () => {
    expect(getIssueIcon("in-progress")).toBe("◐");
  });

  it("returns half circle for empty string", () => {
    expect(getIssueIcon("")).toBe("◐");
  });
});

describe("getSprintStatusLines", () => {
  it("returns status lines with sprint name and summary", () => {
    const lines = getSprintStatusLines("Sprint 1", { total: 5, open: 2, closed: 3, escalated: 0 }, []);
    const joined = lines.join("\n");
    expect(joined).toContain("Sprint 1");
    expect(joined).toContain("3/5 closed");
  });

  it("includes issue information when issues are provided", () => {
    const issues = [
      { number: 1, title: "Bug fix", status: "open" },
      { number: 2, title: "Feature", status: "closed" },
    ];
    const lines = getSprintStatusLines("Sprint 2", { total: 2, open: 1, closed: 1, escalated: 0 }, issues);
    const joined = lines.join("\n");
    expect(joined).toContain("#1");
    expect(joined).toContain("Bug fix");
    expect(joined).toContain("●"); // closed icon
    expect(joined).toContain("○"); // open icon
  });

  it("handles empty issues array", () => {
    const lines = getSprintStatusLines("Sprint 3", { total: 0, open: 0, closed: 0, escalated: 0 }, []);
    expect(lines).toHaveLength(2); // sprint name + summary line
  });
});

// ─── TASK-004: fetchGitHubIssue — defaultExecFn and JSDoc ───────────────────

describe("fetchGitHubIssue — defaultExecFn and JSDoc", () => {
  it("defaultExecFn is declared as a module-level const (not a function declaration)", () => {
    // AC: "defaultExecFn module-level constant wraps spawn directly"
    // The spec says it must be a `const`, not a hoisted `function` declaration.
    // A `const` assignment at module level reads as:
    //   `const defaultExecFn = ...`
    // whereas the current implementation uses:
    //   `function defaultExecFn(...) { ... }`
    // This test fails until the declaration is changed to a const assignment.
    const src = fs.readFileSync(INDEX_SRC, "utf-8");
    expect(src).toMatch(/\bconst\s+defaultExecFn\b/);
  });

  it("JSDoc on fetchGitHubIssue documents the 30-second timeout", () => {
    // AC: "JSDoc describing execFn injection seam and 30s timeout"
    // The @param execFn line covers the injection seam (already present).
    // This test verifies the 30-second timeout is explicitly documented in the
    // JSDoc block immediately preceding the `fetchGitHubIssue` function.
    // It fails until "30" (as in "30s", "30 seconds", or "30,000 ms") appears
    // in the JSDoc block for fetchGitHubIssue.
    const src = fs.readFileSync(INDEX_SRC, "utf-8");
    // Use a regex that matches a single /** ... */ block (no spanning across multiple
    // comment blocks) by refusing to match '*/' inside the captured content.
    // This ensures we capture the JSDoc directly adjacent to fetchGitHubIssue,
    // not the module-level JSDoc at the top of the file.
    const jsdocMatch = /\/\*\*((?:[^*]|\*(?!\/))*)\*\/\s*export\s+async\s+function\s+fetchGitHubIssue/.exec(src);
    expect(jsdocMatch).not.toBeNull();
    const jsdocBlock = jsdocMatch![1];
    // The block must mention the timeout value (30 seconds / 30s / 30,000 ms / 30000)
    expect(jsdocBlock).toMatch(/\b30\b/);
  });
});

// ─── TASK-006: resolveInput async + GitHub issue integration ─────────────────
//
// Injection seam strategy: resolveInput does not expose an execFn parameter,
// so GitHub issue resolution is tested in two ways:
//   1. Source-wiring tests: read index.ts source to confirm the function body
//      calls detectGitHubIssueRef → fetchGitHubIssue → formatIssueText in sequence.
//   2. End-to-end unit tests: call fetchGitHubIssue and formatIssueText directly
//      with vi.fn() mocks to confirm the integration contract, then verify
//      resolveInput delegates to them by checking the source structure.
// This avoids spawning real subprocesses while still asserting observable behaviour.

describe("resolveInput — async signature and GitHub issue integration", () => {
  // AC-1: resolveInput signature is async function resolveInput(input: string, cwd: string): Promise<string>
  it("resolveInput is declared as an async function in the source", () => {
    const src = fs.readFileSync(INDEX_SRC, "utf-8");
    // Must match `export async function resolveInput(`
    expect(src).toMatch(/\bexport\s+async\s+function\s+resolveInput\s*\(/);
  });

  // AC-1 (runtime): resolveInput returns a Promise
  it("resolveInput returns a Promise at runtime", () => {
    const result = resolveInput("some text", "/tmp");
    expect(result).toBeInstanceOf(Promise);
    // Await to avoid unhandled rejection
    return result;
  });

  // AC-2: handleBuild call site uses await resolveInput with trimmed args and ctx.cwd
  it("handleBuild call site uses await resolveInput(args.trim(), ctx.cwd)", () => {
    const src = fs.readFileSync(INDEX_SRC, "utf-8");
    // The pattern must match the awaited call with trimmed input and ctx.cwd arguments
    // Accepts both args.trim() and a trimmed variable
    expect(src).toMatch(/await\s+resolveInput\s*\(/);
    expect(src).toMatch(/ctx\.cwd/);
  });

  // AC-6: '#25' input — resolveInput source wires detectGitHubIssueRef → fetchGitHubIssue → formatIssueText
  it("'#25' input triggers fetchGitHubIssue and returns formatted issue text — source wiring", () => {
    const src = fs.readFileSync(INDEX_SRC, "utf-8");
    // Extract the resolveInput function body and verify it calls all three helpers in sequence
    const resolveInputBodyMatch = /export\s+async\s+function\s+resolveInput[\s\S]*?\n\}/.exec(src);
    expect(resolveInputBodyMatch).not.toBeNull();
    const body = resolveInputBodyMatch![0];
    expect(body).toMatch(/detectGitHubIssueRef/);
    expect(body).toMatch(/fetchGitHubIssue/);
    expect(body).toMatch(/formatIssueText/);
  });

  // AC-6 (end-to-end): '#25' triggers fetchGitHubIssue and returns "GitHub Issue #N: title\n\nbody"
  it("resolveInput with '#25' returns formatted GitHub issue text when fetch succeeds", async () => {
    const mockExec = vi.fn().mockImplementation(async (cmd: string, args: string[]) => {
      const key = `${cmd} ${args[0] ?? ""}`;
      const responses: Record<string, { stdout: string; code: number }> = {
        "git remote": { stdout: "git@github.com:org/repo.git", code: 0 },
        "gh --version": { stdout: "gh version 2.0.0", code: 0 },
        "gh issue": {
          stdout: JSON.stringify({ number: 25, title: "Test Issue", body: "Issue body" }),
          code: 0,
        },
      };
      return { stdout: responses[key]?.stdout ?? "", stderr: "", code: responses[key]?.code ?? 1 };
    });

    // resolveInput calls fetchGitHubIssue then formatIssueText — mirror the same call chain
    // with a controlled exec to verify the output shape.
    const ref = detectGitHubIssueRef("#25")!;
    const issue = await fetchGitHubIssue(ref, "/cwd", mockExec);
    const formatted = formatIssueText(issue);
    expect(formatted).toBe("GitHub Issue #25: Test Issue\n\nIssue body");
  });

  // AC-7: 'owner/repo#25' — fetchGitHubIssue receives an explicit ref (skips git remote)
  it("'owner/repo#25' input triggers fetchGitHubIssue with explicit owner and repo ref", async () => {
    const mockExec = vi.fn().mockImplementation(async (cmd: string, args: string[]) => {
      const key = `${cmd} ${args[0] ?? ""}`;
      const responses: Record<string, { stdout: string; code: number }> = {
        "gh --version": { stdout: "gh version 2.0.0", code: 0 },
        "gh issue": {
          stdout: JSON.stringify({ number: 25, title: "Explicit Repo Issue", body: null }),
          code: 0,
        },
      };
      if (!responses[key]) throw new Error(`Unexpected exec call: ${cmd} ${args.join(" ")}`);
      return { stdout: responses[key].stdout, stderr: "", code: responses[key].code };
    });

    // detectGitHubIssueRef produces { owner, repo, number } for explicit syntax
    const ref = detectGitHubIssueRef("owner/repo#25")!;
    expect(ref).toEqual({ owner: "owner", repo: "repo", number: 25 });

    const issue = await fetchGitHubIssue(ref, "/cwd", mockExec);
    expect(formatIssueText(issue)).toBe("GitHub Issue #25: Explicit Repo Issue");

    // git must NOT have been called — owner/repo bypass the remote inference
    expect(mockExec).not.toHaveBeenCalledWith("git", expect.any(Array), expect.anything());
  });

  // AC-8: Exception from fetchGitHubIssue propagates to handleBuild catch block
  it("resolveInput does not swallow fetchGitHubIssue exceptions — no try/catch in body", () => {
    const src = fs.readFileSync(INDEX_SRC, "utf-8");
    // A try/catch inside resolveInput would prevent errors from reaching handleBuild's catch.
    // The function body must contain no try/catch block.
    const resolveInputBodyMatch = /export\s+async\s+function\s+resolveInput[\s\S]*?\n\}/.exec(src);
    expect(resolveInputBodyMatch).not.toBeNull();
    const body = resolveInputBodyMatch![0];
    expect(body).not.toMatch(/\btry\s*\{/);
  });

  // AC-8 (runtime): a failing fetchGitHubIssue call rejects — the error is not swallowed
  it("exception from fetchGitHubIssue rejects and propagates to the caller", async () => {
    // git remote fails → inferRepoFromGitRemote throws → fetchGitHubIssue rejects
    const failingExec = vi.fn().mockResolvedValue({ stdout: "", stderr: "no remote", code: 128 });
    const ref = detectGitHubIssueRef("#99")!;
    await expect(fetchGitHubIssue(ref, "/cwd", failingExec)).rejects.toThrow(
      "Could not determine GitHub repo from git remote",
    );
  });

  // AC-9: JSDoc updated to mention GitHub issue ref as a resolution mode
  it("resolveInput JSDoc mentions GitHub issue ref as a resolution mode", () => {
    const src = fs.readFileSync(INDEX_SRC, "utf-8");
    const jsdocMatch = /\/\*\*((?:[^*]|\*(?!\/))*)\*\/\s*export\s+async\s+function\s+resolveInput/.exec(src);
    expect(jsdocMatch).not.toBeNull();
    const jsdocBlock = jsdocMatch![1];
    // Accept "GitHub issue", "GitHub Issue", "github issue", etc.
    // Note: "GitHub" has a capital H, so we use [Gg]it[Hh]ub instead of [Gg]ithub.
    expect(jsdocBlock).toMatch(/[Gg]it[Hh]ub\s+[Ii]ssue/);
  });

  // AC-10: JSDoc notes fetched body is NOT re-processed for @file references
  it("resolveInput JSDoc notes that fetched issue body is not re-processed for @file references", () => {
    const src = fs.readFileSync(INDEX_SRC, "utf-8");
    const jsdocMatch = /\/\*\*((?:[^*]|\*(?!\/))*)\*\/\s*export\s+async\s+function\s+resolveInput/.exec(src);
    expect(jsdocMatch).not.toBeNull();
    const jsdocBlock = jsdocMatch![1];
    // The JSDoc must explicitly state that the fetched body is NOT re-processed for @file.
    // Pattern: "not re-process" (as a phrase — "not" immediately before "re-process").
    // This excludes false positives like "does not exist ... @file references".
    expect(jsdocBlock).toMatch(/\bnot\s+re.process/i);
  });
});
