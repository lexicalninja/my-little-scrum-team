import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('ai', () => ({
  generateText: vi.fn(),
}));

vi.mock('../src/models/router.js', () => ({
  getModelForRole: vi.fn(() => 'mock-model'),
}));

import {
  gateSpecificationReview,
  gateTaskBreakdown,
  gateTestReview,
  gateCodeReview,
} from '../src/orchestrator/quality-gates.js';
import { generateText } from 'ai';

const mockGenerateText = vi.mocked(generateText);

describe('Quality Gates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('gateSpecificationReview', () => {
    it('passes when spec is complete', async () => {
      mockGenerateText.mockResolvedValue({
        text: 'RESULT: PASS\nREASON: Specification is complete with all required sections.',
        usage: { promptTokens: 100, completionTokens: 20 },
      } as any);

      const result = await gateSpecificationReview('Complete spec with requirements and criteria');
      expect(result.passed).toBe(true);
      expect(result.reason).toContain('complete');
    });

    it('fails when spec is incomplete', async () => {
      mockGenerateText.mockResolvedValue({
        text: 'RESULT: FAIL\nREASON: Missing success criteria and technical specifications.',
        usage: { promptTokens: 100, completionTokens: 20 },
      } as any);

      const result = await gateSpecificationReview('Vague spec');
      expect(result.passed).toBe(false);
    });
  });

  describe('gateTestReview', () => {
    it('passes when all tests pass', async () => {
      mockGenerateText.mockResolvedValue({
        text: 'RESULT: PASS\nREASON: All tests pass successfully.',
        usage: { promptTokens: 100, completionTokens: 20 },
      } as any);

      const result = await gateTestReview('Test Results: PASS - 10/10 tests passed');
      expect(result.passed).toBe(true);
    });

    it('fails when tests fail', async () => {
      mockGenerateText.mockResolvedValue({
        text: 'RESULT: FAIL\nREASON: 3 tests are failing.',
        usage: { promptTokens: 100, completionTokens: 20 },
      } as any);

      const result = await gateTestReview('Test Results: FAIL - 7/10 passed, 3 failed');
      expect(result.passed).toBe(false);
    });
  });

  describe('gateCodeReview', () => {
    it('passes when no must-fix issues', async () => {
      mockGenerateText.mockResolvedValue({
        text: 'RESULT: PASS\nREASON: No blocking issues found.',
        usage: { promptTokens: 100, completionTokens: 20 },
      } as any);

      const result = await gateCodeReview('Code Review: APPROVED. 0 Must-Fix issues.');
      expect(result.passed).toBe(true);
    });
  });

  describe('error handling', () => {
    it('returns fail on API error', async () => {
      mockGenerateText.mockRejectedValue(new Error('API error'));

      const result = await gateSpecificationReview('Some spec');
      expect(result.passed).toBe(false);
      expect(result.reason).toContain('failed');
    });
  });
});
