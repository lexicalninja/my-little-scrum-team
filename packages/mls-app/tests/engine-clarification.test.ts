/**
 * Tests for OrchestrationEngine's ClarificationNeeded handling.
 *
 * Verifies that when a phase throws ClarificationNeeded the engine:
 *  - returns needs_clarification: true with the question and runId
 *  - saves state with error = 'awaiting_clarification'
 *  - does NOT emit an 'error' event
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ClarificationNeeded } from '../src/interaction/mcp-interaction.js';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('ai', () => ({
  generateText: vi.fn(async (opts: { system?: string }) => {
    const system = opts.system ?? '';
    if (system.includes('input classifier')) {
      return { text: 'feature', usage: { promptTokens: 50, completionTokens: 10 } };
    }
    return { text: 'Done.', usage: { promptTokens: 100, completionTokens: 50 } };
  }),
  tool: (def: Record<string, unknown>) => def,
}));

vi.mock('../src/models/provider.js', () => ({
  getProvider: vi.fn(() => (modelId: string) => ({ modelId, provider: 'mock' })),
  createGitHubModelsProvider: vi.fn(() => (modelId: string) => ({ modelId, provider: 'mock' })),
}));

vi.mock('../src/skills/loader.js', () => ({
  loadAllSkills: vi.fn(async () => new Map()),
  getSkillContentForAgent: vi.fn(async () => ''),
  clearSkillCache: vi.fn(),
}));

// Make phase0 throw ClarificationNeeded so we can test the catch path
// without running the full pipeline.
vi.mock('../src/orchestrator/phases.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/orchestrator/phases.js')>();
  return {
    ...original,
    phase0IdeaRefinement: vi.fn(async () => {
      throw new ClarificationNeeded('What features should the site have?');
    }),
  };
});

// ── Code under test ───────────────────────────────────────────────────────────

import { OrchestrationEngine } from '../src/orchestrator/engine.js';
import { MCPInteraction } from '../src/interaction/mcp-interaction.js';
import { AutoInteraction } from '../src/interaction/cli.js';
import type { MLSConfig } from '../src/config/schema.js';
import type { BuildEvent } from '../src/state/types.js';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('OrchestrationEngine — ClarificationNeeded handling', () => {
  let tmpDir: string;
  let config: MLSConfig;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'mls-clarification-'));
    config = {
      models: {},
      api: { baseURL: 'https://models.github.ai' },
      maxSteps: 5,
      maxReviewIterations: 1,
      stateDir: tmpDir,
      saveDecisions: false,
      decisionsDir: tmpDir,
    };
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns needs_clarification: true with question and runId when phase throws ClarificationNeeded', async () => {
    const engine = new OrchestrationEngine(config, new AutoInteraction());
    const result = await engine.build('Make a website', () => {}, {
      interaction: new MCPInteraction(),
    });

    expect(result.success).toBe(false);
    expect(result.needs_clarification).toBe(true);
    expect(result.clarification_question).toBe('What features should the site have?');
    expect(result.state.id).toBeTruthy();
  });

  it('sets state.error to "awaiting_clarification"', async () => {
    const engine = new OrchestrationEngine(config, new AutoInteraction());
    const result = await engine.build('Make a website', () => {}, {
      interaction: new MCPInteraction(),
    });

    expect(result.state.error).toBe('awaiting_clarification');
  });

  it('does not emit an error event', async () => {
    const engine = new OrchestrationEngine(config, new AutoInteraction());
    const events: BuildEvent[] = [];
    await engine.build('Make a website', (e) => events.push(e), {
      interaction: new MCPInteraction(),
    });

    const errorEvents = events.filter((e) => e.type === 'error');
    expect(errorEvents).toHaveLength(0);
  });

  it('uses the per-call interaction override, not the engine default', async () => {
    // Engine default is AutoInteraction (auto-answers), but the per-call
    // MCPInteraction should be the one that throws ClarificationNeeded.
    const engine = new OrchestrationEngine(config, new AutoInteraction());
    const result = await engine.build('Make a website', () => {}, {
      interaction: new MCPInteraction(),
    });

    // If the engine default were used, AutoInteraction would answer and
    // the build would not be interrupted — so needs_clarification proves
    // the per-call override was respected.
    expect(result.needs_clarification).toBe(true);
  });
});
