/**
 * Unit tests for src/utils/github-issue.ts
 *
 * All subprocess calls are mocked — no `gh` binary is required in CI.
 */
import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest';

// ─── Mock node:child_process before importing the module under test ───────────
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

import * as childProcess from 'node:child_process';
import {
  parseIssueRef,
  inferRepoFromGitRemote,
  fetchGitHubIssue,
  resolveIssueReference,
  GithubIssueError,
} from '../src/utils/github-issue.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

type ExecFileCallback = (
  err: Error | null,
  result: { stdout: string; stderr: string },
) => void;

/** Cast execFile to a mock we can control per-test. */
function mockExecFile(): MockInstance {
  return childProcess.execFile as unknown as MockInstance;
}

/**
 * Build a sequence of stub responses for consecutive execFile calls.
 * Each entry is either:
 *   - { stdout } → success
 *   - { error }  → failure (non-zero exit)
 */
function setupExecFileSequence(
  responses: Array<{ stdout: string } | { error: Error }>,
) {
  let callIndex = 0;
  mockExecFile().mockImplementation(
    (_file: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
      const entry = responses[callIndex++] ?? { stdout: '' };
      if ('error' in entry) {
        cb(entry.error, { stdout: '', stderr: entry.error.message });
      } else {
        cb(null, { stdout: entry.stdout, stderr: '' });
      }
      // return a minimal ChildProcess-like object so promisify is happy
      return {} as ReturnType<typeof childProcess.execFile>;
    },
  );
}

// ─── parseIssueRef ────────────────────────────────────────────────────────────

describe('parseIssueRef', () => {
  it('parses exact bare #N reference', () => {
    expect(parseIssueRef('#25')).toEqual({ owner: null, repo: null, number: 25 });
  });

  it('parses bare #N embedded in text', () => {
    expect(parseIssueRef('build feature from #42')).toEqual({
      owner: null,
      repo: null,
      number: 42,
    });
  });

  it('parses qualified owner/repo#N reference', () => {
    expect(parseIssueRef('lexicalninja/my-little-scrum-team#25')).toEqual({
      owner: 'lexicalninja',
      repo: 'my-little-scrum-team',
      number: 25,
    });
  });

  it('parses qualified reference embedded in text', () => {
    expect(parseIssueRef('see other-org/other-repo#10 for context')).toEqual({
      owner: 'other-org',
      repo: 'other-repo',
      number: 10,
    });
  });

  it('returns null for plain text with no issue reference', () => {
    expect(parseIssueRef('add user authentication')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(parseIssueRef('')).toBeNull();
  });

  it('returns null for #0 (guard against zero)', () => {
    expect(parseIssueRef('#0')).toBeNull();
  });

  it('prefers qualified reference over bare when both appear', () => {
    const result = parseIssueRef('lexicalninja/my-little-scrum-team#7 and also #99');
    expect(result).toEqual({ owner: 'lexicalninja', repo: 'my-little-scrum-team', number: 7 });
  });
});

// ─── inferRepoFromGitRemote ───────────────────────────────────────────────────

describe('inferRepoFromGitRemote', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses an HTTPS remote URL', async () => {
    setupExecFileSequence([{ stdout: 'https://github.com/lexicalninja/my-little-scrum-team.git' }]);
    expect(await inferRepoFromGitRemote()).toEqual({
      owner: 'lexicalninja',
      repo: 'my-little-scrum-team',
    });
  });

  it('parses an HTTPS remote URL without .git suffix', async () => {
    setupExecFileSequence([{ stdout: 'https://github.com/lexicalninja/my-little-scrum-team' }]);
    expect(await inferRepoFromGitRemote()).toEqual({
      owner: 'lexicalninja',
      repo: 'my-little-scrum-team',
    });
  });

  it('parses an SSH remote URL', async () => {
    setupExecFileSequence([{ stdout: 'git@github.com:lexicalninja/my-little-scrum-team.git' }]);
    expect(await inferRepoFromGitRemote()).toEqual({
      owner: 'lexicalninja',
      repo: 'my-little-scrum-team',
    });
  });

  it('throws GithubIssueError for a non-GitHub remote (GitLab)', async () => {
    setupExecFileSequence([{ stdout: 'https://gitlab.com/owner/repo.git' }]);
    await expect(inferRepoFromGitRemote()).rejects.toThrow(GithubIssueError);
    await expect(inferRepoFromGitRemote()).rejects.toThrow(/not a GitHub repository/i);
  });

  it('throws GithubIssueError when git remote command fails', async () => {
    setupExecFileSequence([{ error: new Error('not a git repo') }]);
    await expect(inferRepoFromGitRemote()).rejects.toThrow(
      GithubIssueError,
    );
  });

  it('throws GithubIssueError with /Could not determine/ message when git remote fails', async () => {
    setupExecFileSequence([{ error: new Error('not a git repo') }]);
    await expect(inferRepoFromGitRemote()).rejects.toThrow(
      /Could not determine GitHub repo/i,
    );
  });
});

// ─── fetchGitHubIssue ─────────────────────────────────────────────────────────

describe('fetchGitHubIssue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const validIssueJSON = JSON.stringify({
    title: 'My Issue Title',
    body: 'Issue body text',
    labels: [],
    milestone: null,
  });

  it('returns a formatted string for a valid issue', async () => {
    setupExecFileSequence([
      { stdout: 'gh version 2.0.0' },           // gh --version
      { stdout: 'Logged in to github.com' },     // gh auth status
      { stdout: validIssueJSON },                // gh issue view
    ]);

    const result = await fetchGitHubIssue({
      owner: 'lexicalninja',
      repo: 'my-little-scrum-team',
      number: 25,
    });

    expect(result).toMatch(/^GitHub Issue #25:/);
    expect(result).toContain('My Issue Title');
    expect(result).toContain('Issue body text');
  });

  it('includes Labels line when labels are present', async () => {
    const issueWithLabels = JSON.stringify({
      title: 'Labelled Issue',
      body: 'body',
      labels: [{ name: 'bug' }, { name: 'enhancement' }],
      milestone: null,
    });

    setupExecFileSequence([
      { stdout: 'gh version 2.0.0' },
      { stdout: 'Logged in to github.com' },
      { stdout: issueWithLabels },
    ]);

    const result = await fetchGitHubIssue({
      owner: 'lexicalninja',
      repo: 'my-little-scrum-team',
      number: 1,
    });

    expect(result).toContain('Labels: bug, enhancement');
  });

  it('omits Labels line when labels array is empty', async () => {
    setupExecFileSequence([
      { stdout: 'gh version 2.0.0' },
      { stdout: 'Logged in to github.com' },
      { stdout: validIssueJSON },
    ]);

    const result = await fetchGitHubIssue({
      owner: 'lexicalninja',
      repo: 'my-little-scrum-team',
      number: 25,
    });

    expect(result).not.toContain('Labels:');
  });

  it('includes Milestone line when milestone is present', async () => {
    const issueWithMilestone = JSON.stringify({
      title: 'Milestone Issue',
      body: 'body',
      labels: [],
      milestone: { title: 'v2.0' },
    });

    setupExecFileSequence([
      { stdout: 'gh version 2.0.0' },
      { stdout: 'Logged in to github.com' },
      { stdout: issueWithMilestone },
    ]);

    const result = await fetchGitHubIssue({
      owner: 'lexicalninja',
      repo: 'my-little-scrum-team',
      number: 3,
    });

    expect(result).toContain('Milestone: v2.0');
  });

  it('omits Milestone line when milestone is null', async () => {
    setupExecFileSequence([
      { stdout: 'gh version 2.0.0' },
      { stdout: 'Logged in to github.com' },
      { stdout: validIssueJSON },
    ]);

    const result = await fetchGitHubIssue({
      owner: 'lexicalninja',
      repo: 'my-little-scrum-team',
      number: 25,
    });

    expect(result).not.toContain('Milestone:');
  });

  it('throws GithubIssueError with /not found/ message when gh is not in PATH', async () => {
    setupExecFileSequence([{ error: new Error('command not found: gh') }]);

    await expect(
      fetchGitHubIssue({ owner: 'lexicalninja', repo: 'my-little-scrum-team', number: 25 }),
    ).rejects.toThrow(GithubIssueError);

    setupExecFileSequence([{ error: new Error('command not found: gh') }]);
    await expect(
      fetchGitHubIssue({ owner: 'lexicalninja', repo: 'my-little-scrum-team', number: 25 }),
    ).rejects.toThrow(/not found/i);
  });

  it('throws GithubIssueError when not authenticated', async () => {
    setupExecFileSequence([
      { stdout: 'gh version 2.0.0' },
      { error: new Error('You are not logged into any GitHub hosts') },
    ]);

    await expect(
      fetchGitHubIssue({ owner: 'lexicalninja', repo: 'my-little-scrum-team', number: 25 }),
    ).rejects.toThrow(GithubIssueError);

    setupExecFileSequence([
      { stdout: 'gh version 2.0.0' },
      { error: new Error('not authenticated') },
    ]);
    await expect(
      fetchGitHubIssue({ owner: 'lexicalninja', repo: 'my-little-scrum-team', number: 25 }),
    ).rejects.toThrow(/not authenticated/i);
  });

  it('throws GithubIssueError when issue does not exist', async () => {
    setupExecFileSequence([
      { stdout: 'gh version 2.0.0' },
      { stdout: 'Logged in to github.com' },
      { error: new Error('issue not found') },
    ]);

    await expect(
      fetchGitHubIssue({ owner: 'lexicalninja', repo: 'my-little-scrum-team', number: 9999 }),
    ).rejects.toThrow(GithubIssueError);

    setupExecFileSequence([
      { stdout: 'gh version 2.0.0' },
      { stdout: 'Logged in to github.com' },
      { error: new Error('issue not found') },
    ]);
    await expect(
      fetchGitHubIssue({ owner: 'lexicalninja', repo: 'my-little-scrum-team', number: 9999 }),
    ).rejects.toThrow(/not found/i);
  });

  it('infers owner/repo from git remote when ref has null owner/repo', async () => {
    setupExecFileSequence([
      { stdout: 'gh version 2.0.0' },             // gh --version
      { stdout: 'Logged in to github.com' },       // gh auth status
      { stdout: 'https://github.com/lexicalninja/my-little-scrum-team.git' }, // git remote
      { stdout: validIssueJSON },                  // gh issue view
    ]);

    const result = await fetchGitHubIssue({ owner: null, repo: null, number: 25 });
    expect(result).toMatch(/^GitHub Issue #25:/);
  });
});

// ─── resolveIssueReference ────────────────────────────────────────────────────

describe('resolveIssueReference', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const validIssueJSON = JSON.stringify({
    title: 'Fetched Title',
    body: 'Fetched body',
    labels: [],
    milestone: null,
  });

  it('replaces exact #N input with fetched issue content', async () => {
    setupExecFileSequence([
      { stdout: 'gh version 2.0.0' },
      { stdout: 'Logged in to github.com' },
      { stdout: 'https://github.com/lexicalninja/my-little-scrum-team.git' },
      { stdout: validIssueJSON },
    ]);

    const result = await resolveIssueReference('#25');
    expect(result).toMatch(/^GitHub Issue #25:/);
    expect(result).toContain('Fetched Title');
  });

  it('embeds issue content when #N appears mid-string', async () => {
    setupExecFileSequence([
      { stdout: 'gh version 2.0.0' },
      { stdout: 'Logged in to github.com' },
      { stdout: 'https://github.com/lexicalninja/my-little-scrum-team.git' },
      { stdout: validIssueJSON },
    ]);

    const result = await resolveIssueReference('build feature from #25');
    expect(result).toContain('build feature from ');
    expect(result).toContain('GitHub Issue #25:');
  });

  it('returns input unchanged when no issue reference is present', async () => {
    const result = await resolveIssueReference('add user authentication');
    expect(result).toBe('add user authentication');
    // execFile must NOT have been called
    expect(mockExecFile()).not.toHaveBeenCalled();
  });

  it('resolves qualified owner/repo#N references', async () => {
    setupExecFileSequence([
      { stdout: 'gh version 2.0.0' },
      { stdout: 'Logged in to github.com' },
      { stdout: validIssueJSON },
    ]);

    const result = await resolveIssueReference('see other-org/other-repo#10');
    expect(result).toContain('GitHub Issue #10:');
  });

  it('does not call execFile for plain text (zero subprocess overhead)', async () => {
    await resolveIssueReference('just a plain description with no hash');
    expect(mockExecFile()).not.toHaveBeenCalled();
  });
});

// ─── AC: fetchGitHubIssue uses execFile (not exec) ───────────────────────────

describe('fetchGitHubIssue uses execFile (not exec) for all subprocess calls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const validIssueJSON = JSON.stringify({
    title: 'Test Title',
    body: 'Test body',
    labels: [],
    milestone: null,
  });

  it('calls execFile (not exec) for every subprocess invocation', async () => {
    setupExecFileSequence([
      { stdout: 'gh version 2.0.0' },
      { stdout: 'Logged in to github.com' },
      { stdout: validIssueJSON },
    ]);

    await fetchGitHubIssue({ owner: 'lexicalninja', repo: 'my-little-scrum-team', number: 1 });

    // execFile must have been called (not exec which is not mocked)
    expect(mockExecFile()).toHaveBeenCalled();
  });

  it('exec (shell-based) is never imported or used', async () => {
    // The module under test must only import execFile from node:child_process.
    // We verify this indirectly: our mock only stubs execFile. If the module
    // used exec, the call would reach the real exec and fail in the test env,
    // or the mock would not intercept it and execFile call count would be wrong.
    setupExecFileSequence([
      { stdout: 'gh version 2.0.0' },
      { stdout: 'Logged in to github.com' },
      { stdout: validIssueJSON },
    ]);

    await fetchGitHubIssue({ owner: 'lexicalninja', repo: 'my-little-scrum-team', number: 1 });

    // All three subprocess calls (gh --version, gh auth status, gh issue view)
    // must have gone through execFile.
    expect(mockExecFile()).toHaveBeenCalledTimes(3);
  });
});

// ─── AC: Every execFile call has timeout: 10_000 ─────────────────────────────

describe('every execFile call includes timeout: 10_000', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const validIssueJSON = JSON.stringify({
    title: 'T',
    body: 'B',
    labels: [],
    milestone: null,
  });

  it('passes timeout: 10_000 on the gh --version call', async () => {
    setupExecFileSequence([
      { stdout: 'gh version 2.0.0' },
      { stdout: 'Logged in to github.com' },
      { stdout: validIssueJSON },
    ]);

    await fetchGitHubIssue({ owner: 'lexicalninja', repo: 'my-little-scrum-team', number: 1 });

    const firstCallOpts = mockExecFile().mock.calls[0][2] as { timeout?: number };
    expect(firstCallOpts.timeout).toBe(10_000);
  });

  it('passes timeout: 10_000 on the gh auth status call', async () => {
    setupExecFileSequence([
      { stdout: 'gh version 2.0.0' },
      { stdout: 'Logged in to github.com' },
      { stdout: validIssueJSON },
    ]);

    await fetchGitHubIssue({ owner: 'lexicalninja', repo: 'my-little-scrum-team', number: 1 });

    const secondCallOpts = mockExecFile().mock.calls[1][2] as { timeout?: number };
    expect(secondCallOpts.timeout).toBe(10_000);
  });

  it('passes timeout: 10_000 on the gh issue view call', async () => {
    setupExecFileSequence([
      { stdout: 'gh version 2.0.0' },
      { stdout: 'Logged in to github.com' },
      { stdout: validIssueJSON },
    ]);

    await fetchGitHubIssue({ owner: 'lexicalninja', repo: 'my-little-scrum-team', number: 1 });

    const thirdCallOpts = mockExecFile().mock.calls[2][2] as { timeout?: number };
    expect(thirdCallOpts.timeout).toBe(10_000);
  });

  it('passes timeout: 10_000 on the git remote get-url call', async () => {
    setupExecFileSequence([
      { stdout: 'https://github.com/lexicalninja/my-little-scrum-team.git' },
    ]);

    await inferRepoFromGitRemote();

    const firstCallOpts = mockExecFile().mock.calls[0][2] as { timeout?: number };
    expect(firstCallOpts.timeout).toBe(10_000);
  });
});

// ─── AC: Output format matches spec ──────────────────────────────────────────

describe('output format matches spec: header line, blank line, body, optional metadata lines', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('formats output as "GitHub Issue #N: <title>\\n\\n<body>"', async () => {
    const issueJSON = JSON.stringify({
      title: 'Add login page',
      body: 'Users need a login page.',
      labels: [],
      milestone: null,
    });

    setupExecFileSequence([
      { stdout: 'gh version 2.0.0' },
      { stdout: 'Logged in to github.com' },
      { stdout: issueJSON },
    ]);

    const result = await fetchGitHubIssue({
      owner: 'lexicalninja',
      repo: 'my-little-scrum-team',
      number: 42,
    });

    // Header line
    expect(result).toMatch(/^GitHub Issue #42: Add login page/);
    // Blank line between header and body (i.e., two consecutive newlines after header)
    expect(result).toContain('GitHub Issue #42: Add login page\n\nUsers need a login page.');
  });

  it('appends Labels line after body, separated by a blank line', async () => {
    const issueJSON = JSON.stringify({
      title: 'Bug fix',
      body: 'Something broke.',
      labels: [{ name: 'bug' }],
      milestone: null,
    });

    setupExecFileSequence([
      { stdout: 'gh version 2.0.0' },
      { stdout: 'Logged in to github.com' },
      { stdout: issueJSON },
    ]);

    const result = await fetchGitHubIssue({
      owner: 'lexicalninja',
      repo: 'my-little-scrum-team',
      number: 7,
    });

    // Body followed by blank line then Labels
    expect(result).toContain('Something broke.\n\nLabels: bug');
  });

  it('appends Milestone line immediately after Labels line when both are present', async () => {
    const issueJSON = JSON.stringify({
      title: 'Feature',
      body: 'Do the thing.',
      labels: [{ name: 'enhancement' }],
      milestone: { title: 'v3.0' },
    });

    setupExecFileSequence([
      { stdout: 'gh version 2.0.0' },
      { stdout: 'Logged in to github.com' },
      { stdout: issueJSON },
    ]);

    const result = await fetchGitHubIssue({
      owner: 'lexicalninja',
      repo: 'my-little-scrum-team',
      number: 5,
    });

    expect(result).toContain('Labels: enhancement\nMilestone: v3.0');
  });
});

// ─── AC: Exact user-facing error message strings ──────────────────────────────

describe('error messages match user-facing strings from spec', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('gh not in PATH error message matches spec exactly', async () => {
    setupExecFileSequence([{ error: new Error('command not found: gh') }]);

    await expect(
      fetchGitHubIssue({ owner: 'lexicalninja', repo: 'my-little-scrum-team', number: 25 }),
    ).rejects.toThrow(
      "'gh' CLI not found. Install it from https://cli.github.com and run 'gh auth login'.",
    );
  });

  it('not-authenticated error message matches spec exactly', async () => {
    setupExecFileSequence([
      { stdout: 'gh version 2.0.0' },
      { error: new Error('not logged in') },
    ]);

    await expect(
      fetchGitHubIssue({ owner: 'lexicalninja', repo: 'my-little-scrum-team', number: 25 }),
    ).rejects.toThrow(
      "Not authenticated with GitHub CLI. Run 'gh auth login' first.",
    );
  });

  it('issue-not-found error message matches spec exactly', async () => {
    setupExecFileSequence([
      { stdout: 'gh version 2.0.0' },
      { stdout: 'Logged in to github.com' },
      { error: new Error('no issue found') },
    ]);

    await expect(
      fetchGitHubIssue({ owner: 'lexicalninja', repo: 'my-little-scrum-team', number: 9999 }),
    ).rejects.toThrow(
      'GitHub issue #9999 not found in lexicalninja/my-little-scrum-team.',
    );
  });

  it('git-remote-failure error message matches spec exactly', async () => {
    setupExecFileSequence([{ error: new Error('not a git repository') }]);

    await expect(inferRepoFromGitRemote()).rejects.toThrow(
      "Could not determine GitHub repo from git remote. Use 'owner/repo#N' syntax instead.",
    );
  });
});
