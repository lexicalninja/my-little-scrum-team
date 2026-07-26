/**
 * Delegation prompt templates — translated from build.md:32-103.
 * Builds the prompts that the orchestrator sends to each agent.
 */

export interface ImplementationPromptParams {
  task: string;
  files: string;
  steps: string;
  acceptanceCriteria: string;
  context: string;
}

export function buildImplementationPrompt(params: ImplementationPromptParams): string {
  return `## Task
${params.task}

## Files
${params.files}

## Steps
${params.steps}

## Acceptance Criteria
${params.acceptanceCriteria}

## Context
${params.context}`;
}

export interface SpecificationPromptParams {
  idea: string;
  decisionRecord?: string;
  knownConstraints?: string;
}

export function buildSpecificationPrompt(params: SpecificationPromptParams): string {
  let prompt = `## Idea
${params.idea}`;

  if (params.decisionRecord) {
    prompt += `\n\n## Decision Record\n${params.decisionRecord}`;
  }
  if (params.knownConstraints) {
    prompt += `\n\n## Known Constraints\n${params.knownConstraints}`;
  }
  return prompt;
}

export interface ScrumMasterPromptParams {
  specification: string;
  notes?: string;
}

export function buildScrumMasterPrompt(params: ScrumMasterPromptParams): string {
  let prompt = `## Specification
${params.specification}`;

  if (params.notes) {
    prompt += `\n\n## Notes\n${params.notes}`;
  }
  return prompt;
}

export interface TestRunnerPromptParams {
  whatChanged: string;
  filesModified: string;
  acceptanceCriteria: string;
}

export function buildTestRunnerPrompt(params: TestRunnerPromptParams): string {
  return `## What Changed
${params.whatChanged}

## Files Modified
${params.filesModified}

## Acceptance Criteria
${params.acceptanceCriteria}`;
}

export interface CodeReviewPromptParams {
  whatChanged: string;
  filesToReview: string;
  context: string;
}

export function buildCodeReviewPrompt(params: CodeReviewPromptParams): string {
  return `## What Changed
${params.whatChanged}

## Files to Review
${params.filesToReview}

## Context
${params.context}`;
}

export interface BugFixPromptParams {
  bugDescription: string;
  filePaths: string;
  errorMessages?: string;
  reproductionSteps?: string;
}

export function buildBugFixPrompt(params: BugFixPromptParams): string {
  let prompt = `## Bug Description
${params.bugDescription}

## Relevant Files
${params.filePaths}`;

  if (params.errorMessages) {
    prompt += `\n\n## Error Messages\n${params.errorMessages}`;
  }
  if (params.reproductionSteps) {
    prompt += `\n\n## Reproduction Steps\n${params.reproductionSteps}`;
  }
  return prompt;
}

export interface DesignPromptParams {
  task: string;
  requirements: string;
  existingDesignSystem?: string;
}

export function buildDesignPrompt(params: DesignPromptParams): string {
  let prompt = `## Task
${params.task}

## Requirements
${params.requirements}`;

  if (params.existingDesignSystem) {
    prompt += `\n\n## Existing Design System\n${params.existingDesignSystem}`;
  }
  return prompt;
}

export interface InfrastructurePromptParams {
  task: string;
  requirements: string;
  existingInfra?: string;
}

export function buildInfrastructurePrompt(params: InfrastructurePromptParams): string {
  let prompt = `## Task
${params.task}

## Requirements
${params.requirements}`;

  if (params.existingInfra) {
    prompt += `\n\n## Existing Infrastructure\n${params.existingInfra}`;
  }
  return prompt;
}
