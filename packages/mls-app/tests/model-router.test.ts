import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/models/provider.js', () => ({
  getProvider: vi.fn(() => (modelId: string) => ({ modelId })),
}));

import { getModelForRole, getModelId } from '../src/models/router.js';
import { DEFAULT_MODELS } from '../src/models/types.js';

describe('getModelId', () => {
  it('returns default model when no overrides', () => {
    expect(getModelId('classifier')).toBe('gpt-4o-mini');
    expect(getModelId('code-reviewer')).toBe('gpt-4o');
    expect(getModelId('implementation-engineer')).toBe('gpt-4o');
  });

  it('uses overrides when provided', () => {
    const overrides = { 'code-reviewer': 'gpt-4o' };
    expect(getModelId('code-reviewer', overrides)).toBe('gpt-4o');
  });

  it('falls back to default when override doesnt match', () => {
    const overrides = { 'other-agent': 'gpt-4o' };
    expect(getModelId('classifier', overrides)).toBe('gpt-4o-mini');
  });
});

describe('getModelForRole', () => {
  it('returns a model instance from provider', () => {
    const model = getModelForRole('classifier');
    expect(model).toEqual({ modelId: 'gpt-4o-mini' });
  });

  it('uses override model', () => {
    const model = getModelForRole('classifier', { classifier: 'gpt-4o' });
    expect(model).toEqual({ modelId: 'gpt-4o' });
  });
});
