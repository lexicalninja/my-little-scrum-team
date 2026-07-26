/**
 * Quality gate checks — uses a fast model for pass/fail evaluations.
 * Implements Gates 0-4 from build.md.
 */
import { generateText } from 'ai';
import { getModelForRole } from '../models/router.js';
import type { ModelConfig } from '../models/types.js';
import type { BuildEventCallback } from '../state/types.js';
import { logger } from '../utils/logger.js';

export interface GateResult {
  passed: boolean;
  reason: string;
}

async function evaluateGate(
  gateName: string,
  criteria: string,
  content: string,
  modelOverrides?: ModelConfig,
  onEvent?: BuildEventCallback,
): Promise<GateResult> {
  try {
    const model = getModelForRole('quality-gate', modelOverrides);
    const { text } = await generateText({
      model,
      system: `You are a quality gate evaluator. Evaluate whether the given content meets the criteria.
Respond in this exact format:
RESULT: PASS or FAIL
REASON: <one-sentence explanation>`,
      prompt: `## Gate: ${gateName}\n\n## Criteria\n${criteria}\n\n## Content to Evaluate\n${content}`,
      maxSteps: 1,
    });

    const passed = text.toUpperCase().includes('RESULT: PASS');
    const reasonMatch = text.match(/REASON:\s*(.+)/i);
    const reason = reasonMatch?.[1]?.trim() ?? text.trim();

    logger.gate(`Quality Gate: ${gateName}`, passed, reason);
    onEvent?.({ type: 'quality_gate', gate: gateName, result: passed ? 'pass' : 'fail', reason });

    return { passed, reason };
  } catch (error) {
    const reason = `Gate evaluation failed: ${error}`;
    logger.error(reason);
    onEvent?.({ type: 'quality_gate', gate: gateName, result: 'fail', reason });
    return { passed: false, reason };
  }
}

/** Gate 0: Idea Agreement — Has the user agreed on an approach? */
export async function gateIdeaAgreement(
  decisionRecord: string,
  modelOverrides?: ModelConfig,
  onEvent?: BuildEventCallback,
): Promise<GateResult> {
  return evaluateGate(
    'Gate 0: Idea Agreement',
    'Has the user agreed on an approach? Is there a clear decision with reasoning?',
    decisionRecord,
    modelOverrides,
    onEvent,
  );
}

/** Gate 1: Specification Review — Is the spec complete and unambiguous? */
export async function gateSpecificationReview(
  specification: string,
  modelOverrides?: ModelConfig,
  onEvent?: BuildEventCallback,
): Promise<GateResult> {
  return evaluateGate(
    'Gate 1: Specification Review',
    'Is the specification complete and unambiguous? Are success criteria defined? Are there open questions that block implementation?',
    specification,
    modelOverrides,
    onEvent,
  );
}

/** Gate 2: Task Breakdown Review — Are tasks atomic and actionable? */
export async function gateTaskBreakdown(
  taskBreakdown: string,
  modelOverrides?: ModelConfig,
  onEvent?: BuildEventCallback,
): Promise<GateResult> {
  return evaluateGate(
    'Gate 2: Task Breakdown',
    'Are tasks atomic and actionable? Are dependencies correctly identified? Does each task have acceptance criteria?',
    taskBreakdown,
    modelOverrides,
    onEvent,
  );
}

/** Gate 3: Test Review — Do all tests pass? */
export async function gateTestReview(
  testResults: string,
  modelOverrides?: ModelConfig,
  onEvent?: BuildEventCallback,
): Promise<GateResult> {
  return evaluateGate(
    'Gate 3: Test Review',
    'Do all tests pass? Are there any failures that need to be addressed?',
    testResults,
    modelOverrides,
    onEvent,
  );
}

/** Gate 4: Code Review — Are all Must-Fix issues resolved? */
export async function gateCodeReview(
  reviewFeedback: string,
  modelOverrides?: ModelConfig,
  onEvent?: BuildEventCallback,
): Promise<GateResult> {
  return evaluateGate(
    'Gate 4: Code Review',
    'Are all Must-Fix issues resolved? Has the code reviewer indicated approval? Are there no blocking issues remaining?',
    reviewFeedback,
    modelOverrides,
    onEvent,
  );
}
