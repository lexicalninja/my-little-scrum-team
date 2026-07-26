/**
 * Integration test — runs OrchestrationEngine.build() through all 5 phases.
 *
 * Mocks:
 * - `generateText` from 'ai' — returns context-appropriate canned responses
 * - `getProvider` from models/provider — returns a fake provider
 * - `UserInteraction` — canned answers for ask/confirm/choose
 *
 * Uses a temp directory for state persistence so nothing leaks to disk.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ── Track generateText calls ───────────────────────────────────────────
let generateTextCallCount = 0;

// ── Canned scrum-master response with parseable TASK headers ───────────
const TASK_BREAKDOWN_RESPONSE = `# Task Breakdown

### TASK-001: Implement authentication module

**Type**: implementation
**Complexity**: medium
**Dependencies**: None
**Files Affected**: src/auth.ts, src/middleware.ts
**Acceptance Criteria**:
- User can log in with credentials
- JWT tokens are issued on success

**Description**:
Implement the core authentication module with login endpoint.

### TASK-002: Write auth tests

**Type**: testing
**Complexity**: low
**Dependencies**: TASK-001
**Files Affected**: tests/auth.test.ts
**Acceptance Criteria**:
- Unit tests cover login flow
- Edge cases for invalid credentials

**Description**:
Write comprehensive tests for the authentication module.
`;

// ── Mock 'ai' — lightweight, no importActual ──────────────────────────
vi.mock('ai', () => ({
  generateText: vi.fn(async (opts: { system?: string; prompt?: string }) => {
    generateTextCallCount++;
    const system = opts.system ?? '';

    // Classifier: return "feature"
    if (system.includes('input classifier')) {
      return { text: 'feature', usage: { promptTokens: 50, completionTokens: 10 } };
    }

    // Quality gates: always pass
    if (system.includes('quality gate evaluator')) {
      return { text: 'RESULT: PASS\nREASON: Looks good.', usage: { promptTokens: 100, completionTokens: 20 } };
    }

    // Scrum-master: return parseable task breakdown
    if (system.toLowerCase().includes('scrum')) {
      return {
        text: TASK_BREAKDOWN_RESPONSE,
        usage: { promptTokens: 200, completionTokens: 300 },
      };
    }

    // Default: generic agent response
    return {
      text: 'Done. Implementation complete.',
      usage: { promptTokens: 150, completionTokens: 100 },
    };
  }),
  // `tool` is used by src/tools/*.ts — passthrough that returns the definition as-is
  tool: (def: Record<string, unknown>) => def,
}));

// ── Mock the provider so it never hits a real API ──────────────────────
vi.mock('../src/models/provider.js', () => ({
  getProvider: vi.fn(() => {
    return (modelId: string) => ({ modelId, provider: 'mock' });
  }),
  createGitHubModelsProvider: vi.fn(() => {
    return (modelId: string) => ({ modelId, provider: 'mock' });
  }),
}));

// ── Mock the skills loader so it doesn't read SKILL.md files ───────────
vi.mock('../src/skills/loader.js', () => ({
  loadAllSkills: vi.fn(async () => new Map()),
  getSkillContentForAgent: vi.fn(async () => ''),
  clearSkillCache: vi.fn(),
}));

// ── Now import the code under test ────────────────────────────────────
import { OrchestrationEngine } from '../src/orchestrator/engine.js';
import type { MLSTConfig } from '../src/config/schema.js';
import type { UserInteraction } from '../src/interaction/interface.js';
import type { BuildEvent } from '../src/state/types.js';

// ── Helpers ───────────────────────────────────────────────────────────

function createMockInteraction(): UserInteraction {
  return {
    ask: vi.fn(async () => 'Looks good, proceed.'),
    choose: vi.fn(async (_q: string, opts: string[]) => opts[0]),
    confirm: vi.fn(async () => true),
    display: vi.fn(),
    close: vi.fn(),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('Integration: full build pipeline', () => {
  let tmpDir: string;
  let config: MLSTConfig;
  let interaction: UserInteraction;
  let events: BuildEvent[];

  beforeEach(async () => {
    generateTextCallCount = 0;
    tmpDir = await mkdtemp(join(tmpdir(), 'mlst-integration-'));
    config = {
      models: {},
      api: { baseURL: 'https://models.github.ai' },
      maxSteps: 5,
      maxReviewIterations: 1, // keep the test fast — 1 iteration
      stateDir: tmpDir,
      saveDecisions: true,
      decisionsDir: join(tmpDir, 'decisions'),
    };
    interaction = createMockInteraction();
    events = [];
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('runs all 5 phases (0-4) for a feature input and completes successfully', async () => {
    const engine = new OrchestrationEngine(config, interaction);
    const onEvent = (e: BuildEvent) => events.push(e);

    const result = await engine.build(
      'Add user authentication with JWT tokens and role-based access control',
      onEvent,
    );

    // ── Build succeeded ──────────────────────────────────────────────
    expect(result.success).toBe(true);
    expect(result.summary).toContain('Complete');

    // ── State progressed through all phases ──────────────────────────
    expect(result.state.phase).toBe('complete');

    // ── Tasks were parsed from scrum-master output ──────────────────
    expect(result.state.tasks.size).toBeGreaterThanOrEqual(2);
    const task1 = result.state.tasks.get('TASK-001');
    expect(task1).toBeDefined();
    expect(task1!.title).toBe('Implement authentication module');

    const task2 = result.state.tasks.get('TASK-002');
    expect(task2).toBeDefined();
    expect(task2!.type).toBe('testing');
    expect(task2!.dependencies).toContain('TASK-001');

    // ── Artifacts were saved ─────────────────────────────────────────
    expect(result.state.specification).toBeTruthy();
    expect(result.state.taskBreakdown).toBeTruthy();
    expect(result.state.decisionRecord).toBeTruthy();

    // ── Events include all 5 phase starts ────────────────────────────
    const phaseStarts = events
      .filter((e): e is Extract<BuildEvent, { type: 'phase_start' }> => e.type === 'phase_start')
      .map((e) => e.phase);

    expect(phaseStarts).toContain('Phase 0');
    expect(phaseStarts).toContain('Phase 1');
    expect(phaseStarts).toContain('Phase 2');
    expect(phaseStarts).toContain('Phase 3');
    expect(phaseStarts).toContain('Phase 4');

    // ── Phase completes were emitted ─────────────────────────────────
    const phaseCompletes = events.filter((e) => e.type === 'phase_complete');
    expect(phaseCompletes.length).toBeGreaterThanOrEqual(5);

    // ── build_complete event was emitted ──────────────────────────────
    const buildComplete = events.find((e) => e.type === 'build_complete');
    expect(buildComplete).toBeDefined();

    // ── Interaction was used (Phase 0 ask + confirm) ─────────────────
    expect(interaction.ask).toHaveBeenCalled();
    expect(interaction.confirm).toHaveBeenCalled();

    // ── generateText was called multiple times ───────────────────────
    expect(generateTextCallCount).toBeGreaterThan(5);

    // ── Token usage was tracked ──────────────────────────────────────
    const totalTokens = Object.values(result.state.tokenUsage).reduce(
      (sum, u) => sum + u.input + u.output, 0,
    );
    expect(totalTokens).toBeGreaterThan(0);
  });

  it('tasks reach complete or approved status after execution', async () => {
    const engine = new OrchestrationEngine(config, interaction);
    const result = await engine.build(
      'Add user authentication with JWT tokens',
    );

    expect(result.success).toBe(true);

    const tasks = Array.from(result.state.tasks.values());
    for (const task of tasks) {
      expect(['complete', 'approved', 'escalated']).toContain(task.status);
    }
  });

  it('persists state to the temp directory', async () => {
    const engine = new OrchestrationEngine(config, interaction);
    const result = await engine.build('Build a dashboard');

    expect(result.success).toBe(true);

    // Verify we can load the state back
    const loaded = await engine.getStatus(result.state.id);
    expect(loaded.id).toBe(result.state.id);
    expect(loaded.phase).toBe('complete');
    expect(loaded.tasks.size).toBeGreaterThanOrEqual(2);
  });
});
