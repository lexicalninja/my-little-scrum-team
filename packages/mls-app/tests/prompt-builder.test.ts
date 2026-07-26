import { describe, it, expect } from 'vitest';
import {
  buildImplementationPrompt,
  buildSpecificationPrompt,
  buildScrumMasterPrompt,
  buildTestRunnerPrompt,
  buildCodeReviewPrompt,
  buildBugFixPrompt,
} from '../src/utils/prompt-builder.js';

describe('buildImplementationPrompt', () => {
  it('includes all sections', () => {
    const prompt = buildImplementationPrompt({
      task: 'Add login endpoint',
      files: 'src/auth.ts',
      steps: '1. Create route\n2. Add validation',
      acceptanceCriteria: 'Returns JWT on success',
      context: 'Auth system spec',
    });

    expect(prompt).toContain('## Task');
    expect(prompt).toContain('Add login endpoint');
    expect(prompt).toContain('## Files');
    expect(prompt).toContain('src/auth.ts');
    expect(prompt).toContain('## Steps');
    expect(prompt).toContain('## Acceptance Criteria');
    expect(prompt).toContain('## Context');
  });
});

describe('buildSpecificationPrompt', () => {
  it('includes idea and optional fields', () => {
    const prompt = buildSpecificationPrompt({
      idea: 'Password reset flow',
      decisionRecord: 'Use email verification',
      knownConstraints: 'Must work with existing auth',
    });

    expect(prompt).toContain('## Idea');
    expect(prompt).toContain('Password reset flow');
    expect(prompt).toContain('## Decision Record');
    expect(prompt).toContain('## Known Constraints');
  });

  it('omits optional sections when not provided', () => {
    const prompt = buildSpecificationPrompt({ idea: 'Simple feature' });
    expect(prompt).toContain('## Idea');
    expect(prompt).not.toContain('## Decision Record');
    expect(prompt).not.toContain('## Known Constraints');
  });
});

describe('buildScrumMasterPrompt', () => {
  it('includes specification', () => {
    const prompt = buildScrumMasterPrompt({ specification: 'Full spec here' });
    expect(prompt).toContain('## Specification');
    expect(prompt).toContain('Full spec here');
  });
});

describe('buildTestRunnerPrompt', () => {
  it('includes all sections', () => {
    const prompt = buildTestRunnerPrompt({
      whatChanged: 'Added auth endpoint',
      filesModified: 'src/auth.ts',
      acceptanceCriteria: 'Tests pass',
    });
    expect(prompt).toContain('## What Changed');
    expect(prompt).toContain('## Files Modified');
    expect(prompt).toContain('## Acceptance Criteria');
  });
});

describe('buildCodeReviewPrompt', () => {
  it('includes all sections', () => {
    const prompt = buildCodeReviewPrompt({
      whatChanged: 'Auth implementation',
      filesToReview: 'src/auth.ts',
      context: 'Password reset feature',
    });
    expect(prompt).toContain('## What Changed');
    expect(prompt).toContain('## Files to Review');
    expect(prompt).toContain('## Context');
  });
});

describe('buildBugFixPrompt', () => {
  it('includes required and optional sections', () => {
    const prompt = buildBugFixPrompt({
      bugDescription: '500 error on login',
      filePaths: 'src/auth.ts',
      errorMessages: 'TypeError: null reference',
      reproductionSteps: '1. Click login\n2. See error',
    });
    expect(prompt).toContain('## Bug Description');
    expect(prompt).toContain('## Error Messages');
    expect(prompt).toContain('## Reproduction Steps');
  });
});
