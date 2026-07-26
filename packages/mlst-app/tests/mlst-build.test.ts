/**
 * Tests for bin/mlst.ts — `build` command action handler.
 *
 * Tests the branching logic of the `mlst build` command:
 *   - --from-issue flag: calls fetchGitHubIssue + inferRepoFromGitRemote
 *   - inline #N in description: calls resolveIssueReference
 *   - plain description (no #N): passes through without fetchGitHubIssue calls
 *   - --from-file: reads file content, no github-issue calls
 *   - interactive prompt (no args): calls interaction.ask, no github-issue calls
 *   - error paths: print via chalk.red to stderr and exit(1)
 *   - resolveIssueReference is NOT called on --from-issue or --from-file branches
 *
 * Strategy:
 *   - Stub process.argv before each module import to control CLI arguments.
 *   - Use vi.resetModules() + vi.doMock() per test to get a fresh Commander instance.
 *   - Dynamic import of bin/mlst.ts triggers program.parse(), which fires the async action.
 *   - Use vi.waitFor() to poll for mock calls once the async action settles.
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vitest';

// ─── Stable mock handles — recreated each test ───────────────────────────────

let mockEngineBuild: ReturnType<typeof vi.fn>;
let mockEngineCancel: ReturnType<typeof vi.fn>;
let MockOrchestrationEngine: new (...args: unknown[]) => {
  build: typeof mockEngineBuild;
  cancel: typeof mockEngineCancel;
};

let mockLoadConfig: ReturnType<typeof vi.fn>;
let mockCreateProvider: ReturnType<typeof vi.fn>;
let mockReadFile: ReturnType<typeof vi.fn>;
let mockInteractionAsk: ReturnType<typeof vi.fn>;
let mockInteractionClose: ReturnType<typeof vi.fn>;

// github-issue mock handles — reassigned per test
let mockFetchGitHubIssue: ReturnType<typeof vi.fn>;
let mockInferRepoFromGitRemote: ReturnType<typeof vi.fn>;
let mockResolveIssueReference: ReturnType<typeof vi.fn>;
let MockGithubIssueError: new (msg: string) => Error;

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetModules();

  MockGithubIssueError = class GithubIssueError extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = 'GithubIssueError';
    }
  };

  mockEngineBuild = vi.fn().mockResolvedValue({
    success: true,
    summary: 'Build complete',
    state: { id: 'test-run-id' },
  });
  mockEngineCancel = vi.fn();

  MockOrchestrationEngine = class {
    build = mockEngineBuild;
    cancel = mockEngineCancel;
  };

  mockLoadConfig = vi.fn().mockResolvedValue({
    api: { token: 'tok', baseURL: 'https://example.com' },
    stateDir: '/tmp/mlst-state',
  });
  mockCreateProvider = vi.fn();
  mockReadFile = vi.fn().mockResolvedValue('file content');
  mockInteractionAsk = vi.fn().mockResolvedValue('prompted input');
  mockInteractionClose = vi.fn();

  mockFetchGitHubIssue = vi.fn().mockResolvedValue(
    'GitHub Issue #25: Test Issue\n\nBody text',
  );
  mockInferRepoFromGitRemote = vi
    .fn()
    .mockResolvedValue({ owner: 'lexicalninja', repo: 'my-little-scrum-team' });
  mockResolveIssueReference = vi
    .fn()
    .mockImplementation((input: string) => Promise.resolve(input));
});

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Set process.argv to simulate: `mlst build <...rest>` */
function setArgv(...rest: string[]) {
  process.argv = ['node', 'mlst', 'build', ...rest];
}

/**
 * Register all mocks via vi.doMock and dynamically import bin/mlst.ts.
 * Commander calls program.parse() synchronously at module load, which fires
 * the async action handler. Returns immediately; callers must use vi.waitFor().
 */
async function loadMlstWithMocks() {
  // bin/mlst.ts uses createRequire(import.meta.url)('../../package.json') for version.
  // When running from source (bin/mlst.ts), the path resolves to root package.json
  // which doesn't exist. Mock node:module to avoid the require call failing.
  vi.doMock('node:module', async (importOriginal) => {
    const original = await importOriginal<typeof import('node:module')>();
    return {
      ...original,
      createRequire: () => (_path: string) => ({ version: '0.0.0-test' }),
    };
  });

  vi.doMock('../src/config/loader.js', () => ({
    loadConfig: () => mockLoadConfig(),
  }));

  vi.doMock('../src/orchestrator/engine.js', () => ({
    OrchestrationEngine: MockOrchestrationEngine,
  }));

  vi.doMock('../src/interaction/cli.js', () => {
    const MockCLI = class {
      ask = mockInteractionAsk;
      close = mockInteractionClose;
      confirm = vi.fn().mockResolvedValue(true);
      choose = vi.fn().mockResolvedValue('option');
    };
    const MockAuto = class {
      ask = mockInteractionAsk;
      close = mockInteractionClose;
      confirm = vi.fn().mockResolvedValue(true);
      choose = vi.fn().mockResolvedValue('option');
    };
    return { CLIInteraction: MockCLI, AutoInteraction: MockAuto };
  });

  vi.doMock('../src/models/provider.js', () => ({
    createGitHubModelsProvider: (...args: unknown[]) => mockCreateProvider(...args),
  }));

  vi.doMock('../src/state/persistence.js', () => ({
    listRuns: vi.fn().mockResolvedValue([]),
  }));

  vi.doMock('../src/utils/logger.js', () => ({
    setLogLevel: vi.fn(),
  }));

  vi.doMock('node:fs/promises', () => ({
    readFile: (...args: unknown[]) => mockReadFile(...args),
  }));

  vi.doMock('../src/utils/github-issue.js', () => ({
    fetchGitHubIssue: mockFetchGitHubIssue,
    inferRepoFromGitRemote: mockInferRepoFromGitRemote,
    resolveIssueReference: mockResolveIssueReference,
    GithubIssueError: MockGithubIssueError,
  }));

  // Import triggers program.parse() → fires async action
  await import('../bin/mlst.js');
}

// ─── AC 1: --from-issue calls fetchGitHubIssue and passes resolved string to engine.build() ──

describe('--from-issue flag', () => {
  it('calls fetchGitHubIssue with parsed issue number and inferred repo', async () => {
    setArgv('--from-issue', '25');

    await loadMlstWithMocks();

    await vi.waitFor(() => {
      expect(mockFetchGitHubIssue).toHaveBeenCalledOnce();
    });

    expect(mockInferRepoFromGitRemote).toHaveBeenCalledOnce();
    expect(mockFetchGitHubIssue).toHaveBeenCalledWith(
      { owner: 'lexicalninja', repo: 'my-little-scrum-team', number: 25 },
      expect.any(String),
    );
  });

  it('passes the resolved issue string to engine.build()', async () => {
    setArgv('--from-issue', '25');
    mockFetchGitHubIssue.mockResolvedValue('GitHub Issue #25: My Issue\n\nBody');

    await loadMlstWithMocks();

    await vi.waitFor(() => {
      expect(mockEngineBuild).toHaveBeenCalledOnce();
    });

    const [inputArg] = mockEngineBuild.mock.calls[0] as [string, ...unknown[]];
    expect(inputArg).toBe('GitHub Issue #25: My Issue\n\nBody');
  });

  it('does NOT call resolveIssueReference on the --from-issue branch', async () => {
    setArgv('--from-issue', '25');

    await loadMlstWithMocks();

    await vi.waitFor(() => {
      expect(mockEngineBuild).toHaveBeenCalledOnce();
    });

    expect(mockResolveIssueReference).not.toHaveBeenCalled();
  });
});

// ─── AC 2: inline #N in description calls resolveIssueReference ───────────────

describe('inline #N in description', () => {
  it('calls resolveIssueReference with the joined description', async () => {
    setArgv('implement', 'feature', 'from', '#25');
    mockResolveIssueReference.mockResolvedValue(
      'implement feature from GitHub Issue #25: Test\n\nBody',
    );

    await loadMlstWithMocks();

    await vi.waitFor(() => {
      expect(mockResolveIssueReference).toHaveBeenCalledOnce();
    });

    expect(mockResolveIssueReference).toHaveBeenCalledWith(
      'implement feature from #25',
      expect.any(String),
    );
  });

  it('passes the resolved string from resolveIssueReference to engine.build()', async () => {
    setArgv('implement', 'feature', 'from', '#25');
    const resolvedInput =
      'implement feature from GitHub Issue #25: Test\n\nBody';
    mockResolveIssueReference.mockResolvedValue(resolvedInput);

    await loadMlstWithMocks();

    await vi.waitFor(() => {
      expect(mockEngineBuild).toHaveBeenCalledOnce();
    });

    const [inputArg] = mockEngineBuild.mock.calls[0] as [string, ...unknown[]];
    expect(inputArg).toBe(resolvedInput);
  });
});

// ─── AC 3: plain description (no #N) passes through without fetchGitHubIssue ──

describe('plain description with no #N reference', () => {
  it('passes the description unchanged to engine.build()', async () => {
    setArgv('add', 'user', 'auth');
    // resolveIssueReference is a pass-through for plain text
    mockResolveIssueReference.mockImplementation((s: string) =>
      Promise.resolve(s),
    );

    await loadMlstWithMocks();

    await vi.waitFor(() => {
      expect(mockEngineBuild).toHaveBeenCalledOnce();
    });

    const [inputArg] = mockEngineBuild.mock.calls[0] as [string, ...unknown[]];
    expect(inputArg).toBe('add user auth');
  });

  it('does NOT call fetchGitHubIssue (the underlying subprocess) for plain text', async () => {
    setArgv('add', 'user', 'auth');
    mockResolveIssueReference.mockImplementation((s: string) =>
      Promise.resolve(s),
    );

    await loadMlstWithMocks();

    await vi.waitFor(() => {
      expect(mockEngineBuild).toHaveBeenCalledOnce();
    });

    expect(mockFetchGitHubIssue).not.toHaveBeenCalled();
  });
});

// ─── AC 4: --from-file path is unchanged ──────────────────────────────────────

describe('--from-file flag', () => {
  it('reads the file and passes its content to engine.build()', async () => {
    setArgv('--from-file', '/tmp/spec.md');
    mockReadFile.mockResolvedValue('# Spec\n\nDo something.');

    await loadMlstWithMocks();

    await vi.waitFor(() => {
      expect(mockEngineBuild).toHaveBeenCalledOnce();
    });

    expect(mockReadFile).toHaveBeenCalledOnce();
    const [inputArg] = mockEngineBuild.mock.calls[0] as [string, ...unknown[]];
    expect(inputArg).toBe('# Spec\n\nDo something.');
  });

  it('does NOT call resolveIssueReference on the --from-file branch', async () => {
    setArgv('--from-file', '/tmp/spec.md');
    mockReadFile.mockResolvedValue('some spec content');

    await loadMlstWithMocks();

    await vi.waitFor(() => {
      expect(mockEngineBuild).toHaveBeenCalledOnce();
    });

    expect(mockResolveIssueReference).not.toHaveBeenCalled();
  });

  it('does NOT call fetchGitHubIssue on the --from-file branch', async () => {
    setArgv('--from-file', '/tmp/spec.md');
    mockReadFile.mockResolvedValue('some spec content');

    await loadMlstWithMocks();

    await vi.waitFor(() => {
      expect(mockEngineBuild).toHaveBeenCalledOnce();
    });

    expect(mockFetchGitHubIssue).not.toHaveBeenCalled();
  });
});

// ─── AC 5: interactive prompt path (no args) is unchanged ─────────────────────

describe('interactive prompt path (no arguments)', () => {
  it('calls interaction.ask and passes the answer to engine.build()', async () => {
    setArgv(); // no description args, no flags
    mockInteractionAsk.mockResolvedValue('build a login page');

    await loadMlstWithMocks();

    await vi.waitFor(() => {
      expect(mockEngineBuild).toHaveBeenCalledOnce();
    });

    expect(mockInteractionAsk).toHaveBeenCalledOnce();
    const [inputArg] = mockEngineBuild.mock.calls[0] as [string, ...unknown[]];
    expect(inputArg).toBe('build a login page');
  });

  it('does NOT call resolveIssueReference on the interactive prompt branch', async () => {
    setArgv();
    mockInteractionAsk.mockResolvedValue('just a plain description');

    await loadMlstWithMocks();

    await vi.waitFor(() => {
      expect(mockEngineBuild).toHaveBeenCalledOnce();
    });

    expect(mockResolveIssueReference).not.toHaveBeenCalled();
  });

  it('does NOT call fetchGitHubIssue on the interactive prompt branch', async () => {
    setArgv();
    mockInteractionAsk.mockResolvedValue('just a plain description');

    await loadMlstWithMocks();

    await vi.waitFor(() => {
      expect(mockEngineBuild).toHaveBeenCalledOnce();
    });

    expect(mockFetchGitHubIssue).not.toHaveBeenCalled();
  });
});

// ─── AC 6: --from-issue errors print to stderr via chalk.red and exit code 1 ──

describe('--from-issue error handling', () => {
  it('calls console.error and process.exit(1) when fetchGitHubIssue throws GithubIssueError', async () => {
    setArgv('--from-issue', '25');

    const stderrSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((_code?: number | string) => undefined as never);

    mockFetchGitHubIssue.mockRejectedValue(
      new MockGithubIssueError(
        "'gh' CLI not found. Install it from https://cli.github.com and run 'gh auth login'.",
      ),
    );

    await loadMlstWithMocks();

    await vi.waitFor(() => {
      expect(exitSpy).toHaveBeenCalled();
    });

    expect(stderrSpy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('error message contains the GithubIssueError message', async () => {
    setArgv('--from-issue', '25');

    const stderrMessages: string[] = [];
    const stderrSpy = vi
      .spyOn(console, 'error')
      .mockImplementation((msg: unknown) => {
        stderrMessages.push(String(msg));
      });
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never);

    mockFetchGitHubIssue.mockRejectedValue(
      new MockGithubIssueError(
        "Not authenticated with GitHub CLI. Run 'gh auth login' first.",
      ),
    );

    await loadMlstWithMocks();

    await vi.waitFor(() => {
      expect(exitSpy).toHaveBeenCalled();
    });

    const fullOutput = stderrMessages.join('');
    expect(fullOutput).toContain(
      "Not authenticated with GitHub CLI. Run 'gh auth login' first.",
    );
  });
});

// ─── AC 7: inline resolution errors print to stderr via chalk.red and exit code 1 ──

describe('inline #N resolution error handling', () => {
  it('calls console.error and process.exit(1) when resolveIssueReference throws GithubIssueError', async () => {
    setArgv('#25');

    const stderrSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never);

    mockResolveIssueReference.mockRejectedValue(
      new MockGithubIssueError(
        'GitHub issue #25 not found in lexicalninja/my-little-scrum-team.',
      ),
    );

    await loadMlstWithMocks();

    await vi.waitFor(() => {
      expect(exitSpy).toHaveBeenCalled();
    });

    expect(stderrSpy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('error message contains the GithubIssueError message', async () => {
    setArgv('#25');

    const stderrMessages: string[] = [];
    const stderrSpy = vi
      .spyOn(console, 'error')
      .mockImplementation((msg: unknown) => {
        stderrMessages.push(String(msg));
      });
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never);

    mockResolveIssueReference.mockRejectedValue(
      new MockGithubIssueError(
        'GitHub issue #25 not found in lexicalninja/my-little-scrum-team.',
      ),
    );

    await loadMlstWithMocks();

    await vi.waitFor(() => {
      expect(exitSpy).toHaveBeenCalled();
    });

    const fullOutput = stderrMessages.join('');
    expect(fullOutput).toContain(
      'GitHub issue #25 not found in lexicalninja/my-little-scrum-team.',
    );
  });
});

// ─── AC 8: resolveIssueReference is NOT called on --from-issue or --from-file branches ──

describe('resolveIssueReference is not called on non-description branches', () => {
  it('is not called when --from-issue is used', async () => {
    setArgv('--from-issue', '42');

    await loadMlstWithMocks();

    await vi.waitFor(() => {
      expect(mockEngineBuild).toHaveBeenCalledOnce();
    });

    expect(mockResolveIssueReference).not.toHaveBeenCalled();
  });

  it('is not called when --from-file is used', async () => {
    setArgv('--from-file', '/tmp/spec.md');
    mockReadFile.mockResolvedValue('file content');

    await loadMlstWithMocks();

    await vi.waitFor(() => {
      expect(mockEngineBuild).toHaveBeenCalledOnce();
    });

    expect(mockResolveIssueReference).not.toHaveBeenCalled();
  });
});
