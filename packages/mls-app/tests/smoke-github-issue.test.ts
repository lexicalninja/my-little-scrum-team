/**
 * Integration smoke tests — CLI and MCP paths for GitHub issue resolution.
 *
 * These are smoke tests, not unit tests. They exercise the real code path
 * from the CLI/MCP entry point through the actual github-issue.ts module,
 * with ONLY execFile mocked at the OS boundary (node:child_process).
 * No intermediate module (github-issue.ts, tools.ts) is mocked.
 *
 * Acceptance criteria covered (one test per criterion):
 *   1. CLI --from-issue path: execFile mocked → string starting with
 *      'GitHub Issue #' is passed to engine.build
 *   2. CLI free-text #N path: execFile mocked for git remote + gh →
 *      description arg receives issue content injected
 *   3. CLI free-text no #N path: execFile never called, raw string unchanged
 *   4. MCP mls_build with fromIssue: engine.build called with resolved string
 *   5. MCP mls_build without fromIssue: engine.build called with raw description
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock node:child_process at the OS boundary ────────────────────────────
// This is the ONLY mock for the real code path.  github-issue.ts, tools.ts,
// and mls.ts are NOT individually mocked — they all run their real code.
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

import * as childProcess from 'node:child_process';

type ExecFileCallback = (
  err: Error | null,
  result: { stdout: string; stderr: string },
) => void;

function mockExecFile(): ReturnType<typeof vi.fn> {
  return childProcess.execFile as unknown as ReturnType<typeof vi.fn>;
}

/**
 * Program a sequence of responses for consecutive execFile calls.
 * Each entry: { stdout } = success, { error } = failure.
 */
function stubExecFileSequence(
  responses: Array<{ stdout: string } | { error: Error }>,
) {
  let idx = 0;
  mockExecFile().mockImplementation(
    (_file: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
      const entry = responses[idx++] ?? { stdout: '' };
      if ('error' in entry) {
        cb(entry.error, { stdout: '', stderr: entry.error.message });
      } else {
        cb(null, { stdout: entry.stdout, stderr: '' });
      }
      return {} as ReturnType<typeof childProcess.execFile>;
    },
  );
}

// ─── Shared issue fixtures ─────────────────────────────────────────────────

const ISSUE_JSON = JSON.stringify({
  title: 'Add OAuth login',
  body: 'Implement OAuth 2.0 login flow.',
  labels: [],
  milestone: null,
});

const ISSUE_RESOLVED_PREFIX = 'GitHub Issue #';

// ─── Smoke Test 1: CLI --from-issue path ──────────────────────────────────
//
// Strategy: reset modules, mock node:child_process + all infrastructure that
// bin/mls.ts imports (loadConfig, engine, interaction, provider …).
// Import bin/mls.ts dynamically so Commander fires the action handler.
// Assert that engine.build() receives a string starting with 'GitHub Issue #'.

describe('Smoke 1 — CLI --from-issue path', () => {
  let mockEngineBuild: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();

    mockEngineBuild = vi.fn().mockResolvedValue({
      success: true,
      summary: 'done',
      state: { id: 'r1' },
    });

    // Stub execFile: git remote → HTTPS URL, then gh --version, gh auth status,
    // gh issue view.  (bin/mls.ts calls inferRepoFromGitRemote first for
    // --from-issue, then fetchGitHubIssue which calls gh --version / auth / view)
    stubExecFileSequence([
      { stdout: 'https://github.com/lexicalninja/my-little-scrum-team.git' }, // git remote
      { stdout: 'gh version 2.0.0' },                            // gh --version
      { stdout: 'Logged in to github.com' },                     // gh auth status
      { stdout: ISSUE_JSON },                                     // gh issue view
    ]);
  });

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('passes a string starting with "GitHub Issue #" to engine.build when --from-issue is used', async () => {
    process.argv = ['node', 'mls', 'build', '--from-issue', '7'];

    // Infrastructure mocks (everything except github-issue.ts and child_process)
    vi.doMock('node:module', async (importOriginal) => {
      const original = await importOriginal<typeof import('node:module')>();
      return {
        ...original,
        createRequire: () => () => ({ version: '0.0.0-test' }),
      };
    });

    vi.doMock('../src/config/loader.js', () => ({
      loadConfig: vi.fn().mockResolvedValue({
        api: { token: 'tok', baseURL: 'https://example.com' },
        stateDir: '/tmp/mls-smoke',
      }),
    }));

    const capturedEngineBuild = mockEngineBuild;
    vi.doMock('../src/orchestrator/engine.js', () => ({
      OrchestrationEngine: class {
        build = capturedEngineBuild;
        cancel = vi.fn();
      },
    }));

    vi.doMock('../src/interaction/cli.js', () => ({
      CLIInteraction: class {
        ask = vi.fn().mockResolvedValue('');
        close = vi.fn();
        confirm = vi.fn().mockResolvedValue(true);
        choose = vi.fn().mockResolvedValue('');
      },
      AutoInteraction: class {
        ask = vi.fn().mockResolvedValue('');
        close = vi.fn();
        confirm = vi.fn().mockResolvedValue(true);
        choose = vi.fn().mockResolvedValue('');
      },
    }));

    vi.doMock('../src/models/provider.js', () => ({
      createGitHubModelsProvider: vi.fn(),
    }));

    vi.doMock('../src/state/persistence.js', () => ({
      listRuns: vi.fn().mockResolvedValue([]),
    }));

    vi.doMock('../src/utils/logger.js', () => ({
      setLogLevel: vi.fn(),
    }));

    vi.doMock('node:fs/promises', () => ({
      readFile: vi.fn().mockResolvedValue(''),
    }));

    // Dynamic import fires program.parse() → async action handler
    await import('../bin/mls.js');

    await vi.waitFor(() => {
      expect(capturedEngineBuild).toHaveBeenCalledOnce();
    });

    const [inputArg] = capturedEngineBuild.mock.calls[0] as [string, ...unknown[]];
    expect(inputArg).toMatch(new RegExp(`^${ISSUE_RESOLVED_PREFIX}`));
    expect(inputArg).toContain('Add OAuth login');
  });
});

// ─── Smoke Test 2: CLI free-text #N path ──────────────────────────────────
//
// The user passes "implement #7" as the description argument.
// execFile is mocked for: git remote, gh --version, gh auth status, gh issue view.
// engine.build must receive the description with the issue content injected.

describe('Smoke 2 — CLI free-text #N path', () => {
  let mockEngineBuild: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();

    mockEngineBuild = vi.fn().mockResolvedValue({
      success: true,
      summary: 'done',
      state: { id: 'r2' },
    });

    // resolveIssueReference calls: gh --version, gh auth status,
    // git remote get-url, gh issue view
    stubExecFileSequence([
      { stdout: 'gh version 2.0.0' },                            // gh --version
      { stdout: 'Logged in to github.com' },                     // gh auth status
      { stdout: 'https://github.com/lexicalninja/my-little-scrum-team.git' }, // git remote
      { stdout: ISSUE_JSON },                                     // gh issue view
    ]);
  });

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('injects resolved issue content into the description when #N is present in free-text', async () => {
    process.argv = ['node', 'mls', 'build', 'implement', '#7'];

    vi.doMock('node:module', async (importOriginal) => {
      const original = await importOriginal<typeof import('node:module')>();
      return {
        ...original,
        createRequire: () => () => ({ version: '0.0.0-test' }),
      };
    });

    vi.doMock('../src/config/loader.js', () => ({
      loadConfig: vi.fn().mockResolvedValue({
        api: { token: 'tok', baseURL: 'https://example.com' },
        stateDir: '/tmp/mls-smoke',
      }),
    }));

    const capturedEngineBuild = mockEngineBuild;
    vi.doMock('../src/orchestrator/engine.js', () => ({
      OrchestrationEngine: class {
        build = capturedEngineBuild;
        cancel = vi.fn();
      },
    }));

    vi.doMock('../src/interaction/cli.js', () => ({
      CLIInteraction: class {
        ask = vi.fn().mockResolvedValue('');
        close = vi.fn();
        confirm = vi.fn().mockResolvedValue(true);
        choose = vi.fn().mockResolvedValue('');
      },
      AutoInteraction: class {
        ask = vi.fn().mockResolvedValue('');
        close = vi.fn();
        confirm = vi.fn().mockResolvedValue(true);
        choose = vi.fn().mockResolvedValue('');
      },
    }));

    vi.doMock('../src/models/provider.js', () => ({
      createGitHubModelsProvider: vi.fn(),
    }));

    vi.doMock('../src/state/persistence.js', () => ({
      listRuns: vi.fn().mockResolvedValue([]),
    }));

    vi.doMock('../src/utils/logger.js', () => ({
      setLogLevel: vi.fn(),
    }));

    vi.doMock('node:fs/promises', () => ({
      readFile: vi.fn().mockResolvedValue(''),
    }));

    await import('../bin/mls.js');

    await vi.waitFor(() => {
      expect(capturedEngineBuild).toHaveBeenCalledOnce();
    });

    const [inputArg] = capturedEngineBuild.mock.calls[0] as [string, ...unknown[]];

    // The original text prefix must be preserved
    expect(inputArg).toContain('implement ');
    // The issue content must be injected
    expect(inputArg).toContain('GitHub Issue #7:');
    expect(inputArg).toContain('Add OAuth login');
    // execFile must have been called (subprocess was used to resolve the issue)
    expect(mockExecFile()).toHaveBeenCalled();
  });
});

// ─── Smoke Test 3: CLI free-text no #N path ───────────────────────────────
//
// The user passes a plain description with no #N pattern.
// execFile must NOT be called at all, and engine.build receives the raw string.

describe('Smoke 3 — CLI free-text no #N path', () => {
  let mockEngineBuild: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();

    mockEngineBuild = vi.fn().mockResolvedValue({
      success: true,
      summary: 'done',
      state: { id: 'r3' },
    });

    // No stubbing needed — execFile must not be called
    mockExecFile().mockImplementation(() => {
      throw new Error('execFile must not be called for plain text input');
    });
  });

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('passes the raw string to engine.build and never calls execFile when no #N is present', async () => {
    process.argv = ['node', 'mls', 'build', 'add', 'user', 'authentication'];

    vi.doMock('node:module', async (importOriginal) => {
      const original = await importOriginal<typeof import('node:module')>();
      return {
        ...original,
        createRequire: () => () => ({ version: '0.0.0-test' }),
      };
    });

    vi.doMock('../src/config/loader.js', () => ({
      loadConfig: vi.fn().mockResolvedValue({
        api: { token: 'tok', baseURL: 'https://example.com' },
        stateDir: '/tmp/mls-smoke',
      }),
    }));

    const capturedEngineBuild = mockEngineBuild;
    vi.doMock('../src/orchestrator/engine.js', () => ({
      OrchestrationEngine: class {
        build = capturedEngineBuild;
        cancel = vi.fn();
      },
    }));

    vi.doMock('../src/interaction/cli.js', () => ({
      CLIInteraction: class {
        ask = vi.fn().mockResolvedValue('');
        close = vi.fn();
        confirm = vi.fn().mockResolvedValue(true);
        choose = vi.fn().mockResolvedValue('');
      },
      AutoInteraction: class {
        ask = vi.fn().mockResolvedValue('');
        close = vi.fn();
        confirm = vi.fn().mockResolvedValue(true);
        choose = vi.fn().mockResolvedValue('');
      },
    }));

    vi.doMock('../src/models/provider.js', () => ({
      createGitHubModelsProvider: vi.fn(),
    }));

    vi.doMock('../src/state/persistence.js', () => ({
      listRuns: vi.fn().mockResolvedValue([]),
    }));

    vi.doMock('../src/utils/logger.js', () => ({
      setLogLevel: vi.fn(),
    }));

    vi.doMock('node:fs/promises', () => ({
      readFile: vi.fn().mockResolvedValue(''),
    }));

    await import('../bin/mls.js');

    await vi.waitFor(() => {
      expect(capturedEngineBuild).toHaveBeenCalledOnce();
    });

    const [inputArg] = capturedEngineBuild.mock.calls[0] as [string, ...unknown[]];
    expect(inputArg).toBe('add user authentication');

    // execFile must not have been called for a plain-text description
    expect(mockExecFile()).not.toHaveBeenCalled();
  });
});

// ─── Smoke Tests 4 & 5: MCP mls_build handler ─────────────────────────────
//
// For MCP tests we import createMCPTools directly (no Commander involved).
// execFile is mocked at the OS boundary; github-issue.ts runs its real code.
// tools.ts is imported fresh (vi.resetModules() in beforeEach).

describe('Smoke 4 — MCP mls_build with fromIssue', () => {
  beforeEach(() => {
    vi.resetModules();

    // execFile sequence: gh --version, gh auth status, gh issue view
    // (owner/repo are known from the call, so no git remote needed)
    stubExecFileSequence([
      { stdout: 'gh version 2.0.0' },        // gh --version
      { stdout: 'Logged in to github.com' }, // gh auth status
      { stdout: ISSUE_JSON },                // gh issue view
    ]);
  });

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('engine.build is called with the resolved issue string when fromIssue is provided', async () => {
    // Mock state/persistence so the handler does not touch the filesystem
    vi.doMock('../src/state/persistence.js', () => ({
      listRuns: vi.fn().mockResolvedValue([]),
      loadState: vi.fn().mockResolvedValue({ id: 'x', phase: 'complete', tasks: new Map() }),
      loadArtifact: vi.fn().mockResolvedValue(''),
    }));

    // Import real createMCPTools (tools.ts runs its real code)
    const { createMCPTools } = await import('../src/mcp/tools.js');

    const mockBuild = vi.fn().mockResolvedValue({
      success: true,
      summary: 'done',
      needs_clarification: false,
      state: { id: 'r4', phase: 'complete', tasks: new Map(), tokenUsage: {} },
    });

    const engine = {
      build: mockBuild,
      cancel: vi.fn(),
      getStatus: vi.fn(),
    };

    const config = {
      models: {},
      api: { baseURL: 'https://example.com' },
      maxSteps: 5,
      maxReviewIterations: 1,
      stateDir: '/tmp/mls-smoke',
      saveDecisions: false,
      decisionsDir: '/tmp/mls-smoke/decisions',
    };

    // inferRepoFromGitRemote is called by fetchGitHubIssue only when owner/repo
    // are null.  Here we pass them explicitly through fromIssue, so tools.ts
    // calls inferRepoFromGitRemote itself.  We need one more stub for that.
    stubExecFileSequence([
      { stdout: 'https://github.com/lexicalninja/my-little-scrum-team.git' }, // git remote
      { stdout: 'gh version 2.0.0' },                            // gh --version
      { stdout: 'Logged in to github.com' },                     // gh auth status
      { stdout: ISSUE_JSON },                                     // gh issue view
    ]);

    const tools = createMCPTools(engine as never, config as never);
    const mlsBuild = tools.find((t) => t.name === 'mls_build')!;

    await mlsBuild.handler({ description: '', fromIssue: 7 });

    expect(mockBuild).toHaveBeenCalledOnce();
    const [inputArg] = mockBuild.mock.calls[0] as [string, ...unknown[]];
    expect(inputArg).toMatch(new RegExp(`^${ISSUE_RESOLVED_PREFIX}`));
    expect(inputArg).toContain('Add OAuth login');
  });
});

describe('Smoke 5 — MCP mls_build without fromIssue', () => {
  beforeEach(() => {
    vi.resetModules();

    // execFile must NOT be called — no issue to resolve
    mockExecFile().mockImplementation(() => {
      throw new Error('execFile must not be called when fromIssue is absent');
    });
  });

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('engine.build is called with the raw description and execFile is never called when fromIssue is absent', async () => {
    vi.doMock('../src/state/persistence.js', () => ({
      listRuns: vi.fn().mockResolvedValue([]),
      loadState: vi.fn().mockResolvedValue({ id: 'x', phase: 'complete', tasks: new Map() }),
      loadArtifact: vi.fn().mockResolvedValue(''),
    }));

    const { createMCPTools } = await import('../src/mcp/tools.js');

    const mockBuild = vi.fn().mockResolvedValue({
      success: true,
      summary: 'done',
      needs_clarification: false,
      state: { id: 'r5', phase: 'complete', tasks: new Map(), tokenUsage: {} },
    });

    const engine = {
      build: mockBuild,
      cancel: vi.fn(),
      getStatus: vi.fn(),
    };

    const config = {
      models: {},
      api: { baseURL: 'https://example.com' },
      maxSteps: 5,
      maxReviewIterations: 1,
      stateDir: '/tmp/mls-smoke',
      saveDecisions: false,
      decisionsDir: '/tmp/mls-smoke/decisions',
    };

    const tools = createMCPTools(engine as never, config as never);
    const mlsBuild = tools.find((t) => t.name === 'mls_build')!;

    await mlsBuild.handler({ description: 'build the login page' });

    expect(mockBuild).toHaveBeenCalledOnce();
    const [inputArg] = mockBuild.mock.calls[0] as [string, ...unknown[]];
    expect(inputArg).toBe('build the login page');

    // No subprocess must have been spawned
    expect(mockExecFile()).not.toHaveBeenCalled();
  });
});
