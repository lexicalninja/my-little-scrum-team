import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the AI SDK before imports
vi.mock('ai', () => ({
  generateText: vi.fn(),
}));

vi.mock('../src/models/router.js', () => ({
  getModelForRole: vi.fn(() => 'mock-model'),
}));

import { classifyInput } from '../src/orchestrator/classifier.js';
import { generateText } from 'ai';

const mockGenerateText = vi.mocked(generateText);

describe('classifyInput', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('classifies bug reports correctly', async () => {
    mockGenerateText.mockResolvedValue({
      text: 'bug',
      usage: { promptTokens: 10, completionTokens: 1 },
    } as any);

    const result = await classifyInput('The login button returns a 500 error');
    expect(result).toBe('bug');
  });

  it('classifies feature requests correctly', async () => {
    mockGenerateText.mockResolvedValue({
      text: 'feature',
      usage: { promptTokens: 10, completionTokens: 1 },
    } as any);

    const result = await classifyInput('Add a password reset flow');
    expect(result).toBe('feature');
  });

  it('classifies implementation specs correctly', async () => {
    mockGenerateText.mockResolvedValue({
      text: 'impl-spec',
      usage: { promptTokens: 10, completionTokens: 1 },
    } as any);

    const result = await classifyInput('Create src/auth.ts with login() and logout() functions...');
    expect(result).toBe('impl-spec');
  });

  it('defaults to feature on unrecognized output', async () => {
    mockGenerateText.mockResolvedValue({
      text: 'something-unknown',
      usage: { promptTokens: 10, completionTokens: 1 },
    } as any);

    const result = await classifyInput('Do something');
    expect(result).toBe('feature');
  });

  it('extracts type from verbose response', async () => {
    mockGenerateText.mockResolvedValue({
      text: 'This looks like a plan with multiple epics.',
      usage: { promptTokens: 10, completionTokens: 1 },
    } as any);

    const result = await classifyInput('Build a complete auth system');
    expect(result).toBe('plan');
  });

  it('handles API errors gracefully', async () => {
    mockGenerateText.mockRejectedValue(new Error('API unavailable'));

    const result = await classifyInput('Some input');
    expect(result).toBe('feature');
  });
});
