/**
 * GitHub issue resolution utilities.
 *
 * Detects #N and owner/repo#N patterns in user input, fetches the issue
 * content via the `gh` CLI, and returns a structured description string
 * suitable for passing to the orchestration engine.
 *
 * No shell injection is possible because all subprocess calls use
 * execFile (not exec) with arguments passed as separate array elements.
 */
import { execFile as _execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(_execFile);

const TIMEOUT_MS = 10_000;

// Qualified reference first — owner/repo#N
const QUALIFIED_ISSUE_RE = /([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#(\d+)/;
// Bare reference — #N anywhere in the string
const BARE_ISSUE_RE = /#(\d+)/;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface IssueRef {
  owner: string | null;
  repo: string | null;
  number: number;
}

interface GitHubIssueData {
  title: string;
  body: string;
  labels: Array<{ name: string }>;
  milestone: { title: string } | null;
}

// ─── Error class ─────────────────────────────────────────────────────────────

export class GithubIssueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GithubIssueError';
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Run an external binary with a fixed timeout.
 * Throws GithubIssueError on non-zero exit or timeout.
 */
async function runCommand(
  file: string,
  args: string[],
  cwd?: string,
): Promise<string> {
  try {
    const { stdout } = await execFile(file, args, {
      timeout: TIMEOUT_MS,
      cwd: cwd ?? process.cwd(),
      env: { ...process.env },
    });
    return stdout.trim();
  } catch (err: unknown) {
    const e = err as { killed?: boolean; code?: number; stderr?: string; message?: string };
    if (e.killed) {
      throw new GithubIssueError(
        `Command '${file}' timed out after ${TIMEOUT_MS / 1000}s.`,
      );
    }
    throw err; // re-throw so callers can inspect
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse an issue reference from a string.
 * Returns null if no reference is found or the number is < 1.
 * Qualified references (owner/repo#N) take priority over bare (#N).
 */
export function parseIssueRef(input: string): IssueRef | null {
  const qualified = QUALIFIED_ISSUE_RE.exec(input);
  if (qualified) {
    const num = parseInt(qualified[3], 10);
    if (num < 1) return null;
    return { owner: qualified[1], repo: qualified[2], number: num };
  }

  const bare = BARE_ISSUE_RE.exec(input);
  if (bare) {
    const num = parseInt(bare[1], 10);
    if (num < 1) return null;
    return { owner: null, repo: null, number: num };
  }

  return null;
}

/**
 * Infer the GitHub owner/repo from the git remote `origin` URL.
 * Supports both HTTPS and SSH remote formats.
 * Throws GithubIssueError if the remote cannot be determined or is not on github.com.
 */
export async function inferRepoFromGitRemote(
  cwd?: string,
): Promise<{ owner: string; repo: string }> {
  let remoteUrl: string;
  try {
    remoteUrl = await runCommand('git', ['remote', 'get-url', 'origin'], cwd);
  } catch {
    throw new GithubIssueError(
      "Could not determine GitHub repo from git remote. Use 'owner/repo#N' syntax instead.",
    );
  }

  // HTTPS: https://github.com/owner/repo.git
  const httpsMatch = /github\.com[/:]([^/]+)\/([^/.]+)(\.git)?$/.exec(remoteUrl);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }

  // SSH: git@github.com:owner/repo.git
  const sshMatch = /git@github\.com:([^/]+)\/([^/.]+)(\.git)?$/.exec(remoteUrl);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }

  throw new GithubIssueError(
    `Remote '${remoteUrl}' is not a GitHub repository. ` +
      "Use 'owner/repo#N' syntax to reference issues in non-GitHub remotes.",
  );
}

/**
 * Fetch and format a GitHub issue as a structured description string.
 *
 * Verifies that `gh` is available and authenticated before fetching.
 * Throws GithubIssueError on any failure.
 */
export async function fetchGitHubIssue(ref: IssueRef, cwd?: string): Promise<string> {
  // 1. Check gh is in PATH
  try {
    await runCommand('gh', ['--version'], cwd);
  } catch {
    throw new GithubIssueError(
      "'gh' CLI not found. Install it from https://cli.github.com and run 'gh auth login'.",
    );
  }

  // 2. Check authentication
  try {
    await runCommand('gh', ['auth', 'status'], cwd);
  } catch {
    throw new GithubIssueError(
      "Not authenticated with GitHub CLI. Run 'gh auth login' first.",
    );
  }

  // 3. Resolve owner/repo
  let owner = ref.owner;
  let repo = ref.repo;
  if (!owner || !repo) {
    const inferred = await inferRepoFromGitRemote(cwd);
    owner = inferred.owner;
    repo = inferred.repo;
  }

  // 4. Fetch issue JSON
  let raw: string;
  try {
    raw = await runCommand(
      'gh',
      [
        'issue',
        'view',
        String(ref.number),
        '--repo',
        `${owner}/${repo}`,
        '--json',
        'title,body,labels,milestone',
      ],
      cwd,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('timed out')) throw err; // preserve timeout error
    throw new GithubIssueError(
      `GitHub issue #${ref.number} not found in ${owner}/${repo}.`,
    );
  }

  // 5. Parse and format
  let data: GitHubIssueData;
  try {
    data = JSON.parse(raw) as GitHubIssueData;
  } catch {
    throw new GithubIssueError(
      `Unexpected response from 'gh issue view' for #${ref.number}.`,
    );
  }

  const lines: string[] = [
    `GitHub Issue #${ref.number}: ${data.title}`,
    '',
    data.body ?? '',
  ];

  if (data.labels && data.labels.length > 0) {
    lines.push('');
    lines.push(`Labels: ${data.labels.map((l) => l.name).join(', ')}`);
  }

  if (data.milestone?.title) {
    lines.push(`Milestone: ${data.milestone.title}`);
  }

  return lines.join('\n').trimEnd();
}

/**
 * High-level resolver: detects #N or owner/repo#N patterns in input,
 * fetches the issue, and returns the expanded string.
 *
 * Returns the input unchanged (with zero subprocess calls) when no
 * issue reference pattern is present.
 *
 * Only the first match is resolved per invocation.
 */
export async function resolveIssueReference(
  input: string,
  cwd?: string,
): Promise<string> {
  const ref = parseIssueRef(input);
  if (!ref) {
    // NFR-2: no subprocess spawned
    return input;
  }

  const resolved = await fetchGitHubIssue(ref, cwd);

  // Determine which match to replace
  const qualifiedMatch = QUALIFIED_ISSUE_RE.exec(input);
  if (qualifiedMatch) {
    return input.replace(qualifiedMatch[0], resolved);
  }

  const bareMatch = BARE_ISSUE_RE.exec(input);
  if (bareMatch) {
    return input.replace(bareMatch[0], resolved);
  }

  return resolved; // unreachable but satisfies TypeScript
}
