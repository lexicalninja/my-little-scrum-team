/**
 * Unit tests for src/mcp/tools.ts — mls_build handler
 *
 * Acceptance criteria:
 * AC-1: mls_build with fromIssue calls fetchGitHubIssue and passes resolved
 *       content to engine.build()
 * AC-2: mls_build without fromIssue passes description directly to engine.build()
 * AC-3: No console.log in the new code path
 * AC-4: On error the handler throws a plain Error (not calls process.exit)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock github-issue module ─────────────────────────────────────────────────
// Dynamic import() is used inside the handler, so we mock the resolved module path.
const mockFetchGitHubIssue = vi.fn();
const mockInferRepoFromGitRemote = vi.fn();

vi.mock('../src/utils/github-issue.js', () => ({
  fetchGitHubIssue: mockFetchGitHubIssue,
  inferRepoFromGitRemote: mockInferRepoFromGitRemote,
  GithubIssueError: class GithubIssueError extends Error {},
}));

// ── Mock state/persistence so loadState / listRuns don't hit the filesystem ─
vi.mock('../src/state/persistence.js', () => ({
  listRuns: vi.fn(async () => []),
  loadState: vi.fn(async () => ({ id: 'test', phase: 'complete', tasks: new Map() })),
  loadArtifact: vi.fn(async () => ''),
  saveState: vi.fn(async () => {}),
}));

// ── Import the module under test ─────────────────────────────────────────────
import { createMCPTools } from '../src/mcp/tools.js';
import type { OrchestrationEngine } from '../src/orchestrator/engine.js';
import type { MLSConfig } from '../src/config/schema.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Minimal MLSConfig — only the fields createMCPTools uses */
function makeConfig(): MLSConfig {
  return {
    models: {},
    api: { baseURL: 'https://example.com' },
    maxSteps: 5,
    maxReviewIterations: 1,
    stateDir: '/tmp/mls-test',
    saveDecisions: false,
    decisionsDir: '/tmp/mls-test/decisions',
  };
}

/** Successful build result returned by the mock engine */
function makeSuccessResult() {
  return {
    success: true,
    summary: 'Build complete.',
    needs_clarification: false,
    state: { id: 'run-001', phase: 'complete', tasks: new Map(), tokenUsage: {} },
  };
}

/** Create a mock OrchestrationEngine whose build() is controllable */
function makeMockEngine(buildImpl?: () => Promise<unknown>): OrchestrationEngine {
  return {
    build: vi.fn(buildImpl ?? (async () => makeSuccessResult())),
    cancel: vi.fn(),
    getStatus: vi.fn(async () => ({ id: 'run-001', phase: 'complete', tasks: new Map() })),
  } as unknown as OrchestrationEngine;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('mls_build handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // AC-1: mls_build with fromIssue calls fetchGitHubIssue and passes resolved
  //       content to engine.build()
  describe('AC-1: fromIssue resolves via fetchGitHubIssue', () => {
    it('calls fetchGitHubIssue with the correct issue number when fromIssue is provided', async () => {
      mockInferRepoFromGitRemote.mockResolvedValue({ owner: 'adhocteam', repo: 'hoc-market' });
      mockFetchGitHubIssue.mockResolvedValue('GitHub Issue #25: My Title\n\nBody text');

      const engine = makeMockEngine();
      const tools = createMCPTools(engine, makeConfig());
      const mlsBuild = tools.find((t) => t.name === 'mls_build')!;

      await mlsBuild.handler({ description: '', fromIssue: 25 });

      expect(mockFetchGitHubIssue).toHaveBeenCalledOnce();
      expect(mockFetchGitHubIssue).toHaveBeenCalledWith(
        { owner: 'adhocteam', repo: 'hoc-market', number: 25 },
        expect.any(String),
      );
    });

    it('passes the resolved issue content (not the original description) to engine.build()', async () => {
      const resolvedContent = 'GitHub Issue #25: My Title\n\nBody text';
      mockInferRepoFromGitRemote.mockResolvedValue({ owner: 'adhocteam', repo: 'hoc-market' });
      mockFetchGitHubIssue.mockResolvedValue(resolvedContent);

      const engine = makeMockEngine();
      const tools = createMCPTools(engine, makeConfig());
      const mlsBuild = tools.find((t) => t.name === 'mls_build')!;

      await mlsBuild.handler({ description: 'original description', fromIssue: 25 });

      const buildCall = (engine.build as ReturnType<typeof vi.fn>).mock.calls[0];
      // First argument to engine.build() must be the resolved issue content
      expect(buildCall[0]).toBe(resolvedContent);
    });
  });

  // AC-2: mls_build without fromIssue passes description directly to engine.build()
  describe('AC-2: without fromIssue, description passes through unchanged', () => {
    it('passes description directly to engine.build() when fromIssue is absent', async () => {
      const engine = makeMockEngine();
      const tools = createMCPTools(engine, makeConfig());
      const mlsBuild = tools.find((t) => t.name === 'mls_build')!;

      await mlsBuild.handler({ description: 'add user authentication' });

      const buildCall = (engine.build as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(buildCall[0]).toBe('add user authentication');
    });

    it('does not call fetchGitHubIssue when fromIssue is absent', async () => {
      const engine = makeMockEngine();
      const tools = createMCPTools(engine, makeConfig());
      const mlsBuild = tools.find((t) => t.name === 'mls_build')!;

      await mlsBuild.handler({ description: 'build the thing' });

      expect(mockFetchGitHubIssue).not.toHaveBeenCalled();
    });

    it('does not call inferRepoFromGitRemote when fromIssue is absent', async () => {
      const engine = makeMockEngine();
      const tools = createMCPTools(engine, makeConfig());
      const mlsBuild = tools.find((t) => t.name === 'mls_build')!;

      await mlsBuild.handler({ description: 'build the thing' });

      expect(mockInferRepoFromGitRemote).not.toHaveBeenCalled();
    });
  });

  // AC-3: No console.log in the new code path
  describe('AC-3: no console.log is called during fromIssue resolution', () => {
    it('does not call console.log when fromIssue resolves successfully', async () => {
      const logSpy = vi.spyOn(console, 'log');
      mockInferRepoFromGitRemote.mockResolvedValue({ owner: 'adhocteam', repo: 'hoc-market' });
      mockFetchGitHubIssue.mockResolvedValue('GitHub Issue #25: Title\n\nBody');

      const engine = makeMockEngine();
      const tools = createMCPTools(engine, makeConfig());
      const mlsBuild = tools.find((t) => t.name === 'mls_build')!;

      await mlsBuild.handler({ description: '', fromIssue: 25 });

      expect(logSpy).not.toHaveBeenCalled();
      logSpy.mockRestore();
    });

    it('does not call console.log when fromIssue is absent', async () => {
      const logSpy = vi.spyOn(console, 'log');
      const engine = makeMockEngine();
      const tools = createMCPTools(engine, makeConfig());
      const mlsBuild = tools.find((t) => t.name === 'mls_build')!;

      await mlsBuild.handler({ description: 'build auth module' });

      expect(logSpy).not.toHaveBeenCalled();
      logSpy.mockRestore();
    });
  });

  // AC-4: On error, handler throws a plain Error (not calls process.exit)
  describe('AC-4: errors propagate as thrown Error, not process.exit', () => {
    it('throws an Error when fetchGitHubIssue rejects', async () => {
      mockInferRepoFromGitRemote.mockResolvedValue({ owner: 'adhocteam', repo: 'hoc-market' });
      mockFetchGitHubIssue.mockRejectedValue(new Error("'gh' CLI not found."));

      const engine = makeMockEngine();
      const tools = createMCPTools(engine, makeConfig());
      const mlsBuild = tools.find((t) => t.name === 'mls_build')!;

      await expect(
        mlsBuild.handler({ description: '', fromIssue: 25 }),
      ).rejects.toThrow(Error);
    });

    it('does not call process.exit when fetchGitHubIssue rejects', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit was called');
      });

      mockInferRepoFromGitRemote.mockResolvedValue({ owner: 'adhocteam', repo: 'hoc-market' });
      mockFetchGitHubIssue.mockRejectedValue(new Error("'gh' CLI not found."));

      const engine = makeMockEngine();
      const tools = createMCPTools(engine, makeConfig());
      const mlsBuild = tools.find((t) => t.name === 'mls_build')!;

      // The handler should reject, but process.exit must NOT have been called
      try {
        await mlsBuild.handler({ description: '', fromIssue: 25 });
      } catch {
        // expected — we just care process.exit was not involved
      }

      expect(exitSpy).not.toHaveBeenCalled();
      exitSpy.mockRestore();
    });

    it('throws when inferRepoFromGitRemote rejects', async () => {
      mockInferRepoFromGitRemote.mockRejectedValue(
        new Error('Could not determine GitHub repo from git remote.'),
      );

      const engine = makeMockEngine();
      const tools = createMCPTools(engine, makeConfig());
      const mlsBuild = tools.find((t) => t.name === 'mls_build')!;

      await expect(
        mlsBuild.handler({ description: '', fromIssue: 25 }),
      ).rejects.toThrow(Error);
    });
  });
});
