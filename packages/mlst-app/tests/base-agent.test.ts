/**
 * Tests for the two bug-fix behaviours added to BaseAgent / retryWithBackoff:
 *
 *  1. experimental_repairToolCall regex — strips raw control chars from JSON
 *  2. retryWithBackoff — retries (up to maxRetries) on InvalidToolArgumentsError
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Inline regex extracted from base-agent.ts for unit testing ──────────────
const cleanControlChars = (s: string) =>
  s.replace(/[\x00-\x09\x0B\x0C\x0E-\x1F]/g, '');

// ── Mocks (must be hoisted before any import of code under test) ─────────────
vi.mock('ai', () => ({
  generateText: vi.fn(),
  tool: (def: Record<string, unknown>) => def,
}));

vi.mock('../src/models/provider.js', () => ({
  getProvider: vi.fn(() => (modelId: string) => ({ modelId, provider: 'mock' })),
  createGitHubModelsProvider: vi.fn(
    () => (modelId: string) => ({ modelId, provider: 'mock' }),
  ),
}));

vi.mock('../src/skills/loader.js', () => ({
  loadAllSkills: vi.fn(async () => new Map()),
  getSkillContentForAgent: vi.fn(async () => ''),
  clearSkillCache: vi.fn(),
}));

import { generateText } from 'ai';
import { SpecificationWriterAgent } from '../src/agents/specification-writer.js';
import type { MLSTConfig } from '../src/config/schema.js';

// ── Minimal config ───────────────────────────────────────────────────────────
const minConfig: MLSTConfig = {
  models: {},
  api: { baseURL: 'https://models.github.ai' },
  maxSteps: 5,
  maxReviewIterations: 1,
  stateDir: '/tmp',
  saveDecisions: false,
  decisionsDir: '/tmp',
};

// ── 1. Regex unit tests ──────────────────────────────────────────────────────
describe('repairToolCall — control-char stripping regex', () => {
  it('removes a literal tab (0x09)', () => {
    expect(cleanControlChars('{"content":"hello\tworld"}')).toBe(
      '{"content":"helloworld"}',
    );
  });

  it('removes NUL through BS (0x00–0x08)', () => {
    expect(cleanControlChars('\x00\x01\x08abc')).toBe('abc');
  });

  it('removes vertical-tab (0x0B) and form-feed (0x0C)', () => {
    expect(cleanControlChars('a\x0Bb\x0Cc')).toBe('abc');
  });

  it('removes SO through US (0x0E–0x1F)', () => {
    expect(cleanControlChars('a\x0Eb\x1Fc')).toBe('abc');
  });

  it('preserves newline (0x0A)', () => {
    expect(cleanControlChars('line1\nline2')).toBe('line1\nline2');
  });

  it('preserves carriage-return (0x0D)', () => {
    expect(cleanControlChars('line1\r\nline2')).toBe('line1\r\nline2');
  });

  it('leaves a clean JSON string untouched', () => {
    const s = '{"path":"src/index.ts","content":"const x = 1;\\n"}';
    expect(cleanControlChars(s)).toBe(s);
  });
});

// ── 2. Retry behaviour tests ─────────────────────────────────────────────────
describe('retryWithBackoff — InvalidToolArgumentsError', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  const successResponse = {
    text: 'Done.',
    usage: { promptTokens: 10, completionTokens: 5 },
  };

  it('retries once after an InvalidToolArgumentsError and returns the success result', async () => {
    const mockGT = vi.mocked(generateText);
    mockGT
      .mockRejectedValueOnce(
        new Error('Invalid arguments for tool writeFile: JSON parsing failed'),
      )
      .mockResolvedValueOnce(successResponse as never);

    const agent = new SpecificationWriterAgent();
    const promise = agent.execute({ userPrompt: 'test', config: minConfig });

    // Advance past the exponential-backoff delay for attempt 0 (2000 ms)
    await vi.runAllTimersAsync();

    const result = await promise;
    expect(result.text).toBe('Done.');
    expect(mockGT).toHaveBeenCalledTimes(2);
  });

  it('retries on "JSON parsing failed" message variant', async () => {
    const mockGT = vi.mocked(generateText);
    mockGT
      .mockRejectedValueOnce(new Error('JSON parsing failed'))
      .mockResolvedValueOnce(successResponse as never);

    const agent = new SpecificationWriterAgent();
    const promise = agent.execute({ userPrompt: 'test', config: minConfig });

    await vi.runAllTimersAsync();

    const result = await promise;
    expect(result.text).toBe('Done.');
    expect(mockGT).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on an unrelated error', async () => {
    const mockGT = vi.mocked(generateText);
    mockGT.mockRejectedValue(new Error('Unexpected network failure'));

    const agent = new SpecificationWriterAgent();
    await expect(
      agent.execute({ userPrompt: 'test', config: minConfig }),
    ).rejects.toThrow('Unexpected network failure');

    expect(mockGT).toHaveBeenCalledTimes(1);
  });

  it('throws after exhausting maxRetries on persistent InvalidToolArgumentsError', async () => {
    const mockGT = vi.mocked(generateText);
    const err = new Error('Invalid arguments for tool writeFile: JSON parsing failed');
    mockGT.mockRejectedValue(err);

    const agent = new SpecificationWriterAgent();
    const promise = agent.execute({ userPrompt: 'test', config: minConfig });

    // Attach the rejection handler BEFORE advancing timers so the rejection
    // is never unhandled from Node.js's perspective.
    const assertion = expect(promise).rejects.toThrow('Invalid arguments for tool writeFile');
    await vi.runAllTimersAsync();
    await assertion;

    // default maxRetries = 5, so 6 total attempts (attempts 0–5)
    expect(mockGT).toHaveBeenCalledTimes(6);
  });
});
