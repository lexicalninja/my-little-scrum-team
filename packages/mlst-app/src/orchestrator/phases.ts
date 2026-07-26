/**
 * Phase implementations — Phase 0 through Phase 4.
 * Translates build.md's orchestration logic into executable code.
 */
import type { BuildState, BuildEventCallback, TaskState, TaskType, TaskStatus } from '../state/types.js';
import type { MLSTConfig } from '../config/schema.js';
import type { UserInteraction } from '../interaction/interface.js';
import type { AgentResult } from '../agents/base-agent.js';
import { SpecificationWriterAgent } from '../agents/specification-writer.js';
import { ScrumMasterAgent } from '../agents/scrum-master.js';
import { ImplementationEngineerAgent } from '../agents/implementation-engineer.js';
import { TestRunnerAgent } from '../agents/test-runner.js';
import { CodeReviewerAgent } from '../agents/code-reviewer.js';
import { UIUXDesignerAgent } from '../agents/ui-ux-designer.js';
import { InfrastructureEngineerAgent } from '../agents/infrastructure-engineer.js';
import { updatePhase, trackTokenUsage, addTask } from '../state/store.js';
import { saveState, saveArtifact } from '../state/persistence.js';
import { gateIdeaAgreement, gateSpecificationReview, gateTaskBreakdown, gateTestReview, gateCodeReview } from './quality-gates.js';
import { buildExecutionPlan, executeParallel } from './parallel.js';
import {
  buildSpecificationPrompt,
  buildScrumMasterPrompt,
  buildImplementationPrompt,
  buildTestRunnerPrompt,
  buildCodeReviewPrompt,
  buildBugFixPrompt,
  buildDesignPrompt,
  buildInfrastructurePrompt,
} from '../utils/prompt-builder.js';
import { logger } from '../utils/logger.js';

// Singleton agent instances
const specWriter = new SpecificationWriterAgent();
const scrumMaster = new ScrumMasterAgent();
const implEngineer = new ImplementationEngineerAgent();
const testRunner = new TestRunnerAgent();
const codeReviewer = new CodeReviewerAgent();
const uiDesigner = new UIUXDesignerAgent();
const infraEngineer = new InfrastructureEngineerAgent();

interface PhaseContext {
  state: BuildState;
  config: MLSTConfig;
  interaction: UserInteraction;
  onEvent: BuildEventCallback;
  abortSignal?: AbortSignal;
}

/** Helper to run an agent and track its token usage */
async function runAgent(
  agent: { execute: (ctx: { userPrompt: string; config?: MLSTConfig; onEvent?: BuildEventCallback; additionalContext?: string }) => Promise<AgentResult> },
  prompt: string,
  ctx: PhaseContext,
  additionalContext?: string,
): Promise<AgentResult> {
  const result = await agent.execute({
    userPrompt: prompt,
    config: ctx.config,
    onEvent: ctx.onEvent,
    additionalContext,
  });
  trackTokenUsage(ctx.state, result.model, result.tokenUsage);
  return result;
}

/**
 * Phase 0: Idea Refinement — collaborate with user to refine the idea.
 */
export async function phase0IdeaRefinement(ctx: PhaseContext): Promise<void> {
  updatePhase(ctx.state, 'refinement');
  ctx.onEvent({ type: 'phase_start', phase: 'Phase 0', description: 'Idea Refinement' });

  // Use the idea-refiner approach: ask clarifying questions, propose approaches
  const questions = await ctx.interaction.ask(
    `Let me help refine this idea. What are the key constraints or requirements I should know about?\n\n` +
    `Original input: "${ctx.state.input.slice(0, 200)}..."`
  );

  // Build a decision record from the refinement
  const decisionContext = `## Original Idea\n${ctx.state.input}\n\n## User Refinement\n${questions}`;

  // Ask for confirmation
  const agreed = await ctx.interaction.confirm('Ready to proceed with this direction?');
  if (!agreed) {
    const moreInput = await ctx.interaction.ask('What would you like to change?');
    ctx.state.decisionRecord = `${decisionContext}\n\n## Additional Input\n${moreInput}`;
  } else {
    ctx.state.decisionRecord = decisionContext;
  }

  // Quality Gate 0
  const gate = await gateIdeaAgreement(ctx.state.decisionRecord, ctx.config.models, ctx.onEvent);
  if (!gate.passed) {
    logger.warn('Gate 0 did not pass, but user confirmed. Proceeding anyway.');
  }

  // Save decision record
  if (ctx.config.saveDecisions) {
    const date = new Date().toISOString().slice(0, 10);
    const slug = ctx.state.input.slice(0, 30).replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();
    await saveArtifact(ctx.state.id, `decision-${date}-${slug}.md`, ctx.state.decisionRecord, ctx.config.stateDir);
  }

  await saveState(ctx.state, ctx.config.stateDir);
  ctx.onEvent({ type: 'phase_complete', phase: 'Phase 0', summary: 'Idea refined and agreed upon' });
}

/**
 * Phase 1: Specification — spawn specification-writer agent.
 */
export async function phase1Specification(ctx: PhaseContext): Promise<void> {
  updatePhase(ctx.state, 'specification');
  ctx.onEvent({ type: 'phase_start', phase: 'Phase 1', description: 'Specification' });

  const prompt = buildSpecificationPrompt({
    idea: ctx.state.input,
    decisionRecord: ctx.state.decisionRecord,
  });

  const result = await runAgent(specWriter, prompt, ctx);
  ctx.state.specification = result.text;

  ctx.onEvent({ type: 'artifact_created', name: 'Specification', preview: result.text.slice(0, 300) });
  await saveArtifact(ctx.state.id, 'specification.md', result.text, ctx.config.stateDir);

  // Quality Gate 1
  const gate = await gateSpecificationReview(result.text, ctx.config.models, ctx.onEvent);
  if (!gate.passed) {
    // Ask user for clarification
    const clarification = await ctx.interaction.ask(`Specification needs clarification: ${gate.reason}\nPlease provide more details:`);
    // Re-run with clarification
    const retryPrompt = buildSpecificationPrompt({
      idea: ctx.state.input,
      decisionRecord: ctx.state.decisionRecord,
      knownConstraints: clarification,
    });
    const retryResult = await runAgent(specWriter, retryPrompt, ctx);
    ctx.state.specification = retryResult.text;
    await saveArtifact(ctx.state.id, 'specification.md', retryResult.text, ctx.config.stateDir);
  }

  await saveState(ctx.state, ctx.config.stateDir);
  ctx.onEvent({ type: 'phase_complete', phase: 'Phase 1', summary: 'Specification complete' });
}

/**
 * Phase 2: Task Breakdown — spawn scrum-master agent.
 */
export async function phase2TaskBreakdown(ctx: PhaseContext): Promise<void> {
  updatePhase(ctx.state, 'breakdown');
  ctx.onEvent({ type: 'phase_start', phase: 'Phase 2', description: 'Task Breakdown' });

  const prompt = buildScrumMasterPrompt({
    specification: ctx.state.specification!,
  });

  const result = await runAgent(scrumMaster, prompt, ctx);
  ctx.state.taskBreakdown = result.text;

  ctx.onEvent({ type: 'artifact_created', name: 'Task Breakdown', preview: result.text.slice(0, 300) });
  await saveArtifact(ctx.state.id, 'task-breakdown.md', result.text, ctx.config.stateDir);

  // Parse tasks from the breakdown and add to state
  const parsedTasks = parseTaskBreakdown(result.text);
  for (const task of parsedTasks) {
    addTask(ctx.state, task);
  }

  // Quality Gate 2
  const gate = await gateTaskBreakdown(result.text, ctx.config.models, ctx.onEvent);
  if (!gate.passed) {
    logger.warn(`Gate 2 concerns: ${gate.reason}. Proceeding with available tasks.`);
  }

  await saveState(ctx.state, ctx.config.stateDir);
  ctx.onEvent({
    type: 'phase_complete',
    phase: 'Phase 2',
    summary: `${ctx.state.tasks.size} tasks identified`,
  });
}

/**
 * Phase 3: Execution — parallelize agents based on task dependencies.
 */
export async function phase3Execution(ctx: PhaseContext): Promise<void> {
  updatePhase(ctx.state, 'execution');
  ctx.onEvent({ type: 'phase_start', phase: 'Phase 3', description: 'Execution' });

  const tasks = Array.from(ctx.state.tasks.values());
  const executionPlan = buildExecutionPlan(tasks);

  for (const group of executionPlan) {
    logger.phase(group.name, `${group.tasks.length} task(s)`);

    await executeParallel(group.tasks, async (task) => {
      return executeTask(task, ctx);
    });
  }

  await saveState(ctx.state, ctx.config.stateDir);
  ctx.onEvent({ type: 'phase_complete', phase: 'Phase 3', summary: 'All tasks executed' });
}

/**
 * Execute a single task through the implementation → test → review cycle.
 */
async function executeTask(task: TaskState, ctx: PhaseContext): Promise<void> {
  task.status = 'in-progress';
  const maxIterations = ctx.config.maxReviewIterations;

  // Route to appropriate agent based on task type
  if (task.type === 'design') {
    const prompt = buildDesignPrompt({
      task: `${task.title}\n\n${task.description}`,
      requirements: task.acceptanceCriteria.join('\n'),
    });
    const result = await runAgent(uiDesigner, prompt, ctx);
    task.output = result.text;
    task.status = 'complete';
    return;
  }

  if (task.type === 'infrastructure' || task.type === 'deployment') {
    const prompt = buildInfrastructurePrompt({
      task: `${task.title}\n\n${task.description}`,
      requirements: task.acceptanceCriteria.join('\n'),
    });
    const result = await runAgent(infraEngineer, prompt, ctx);
    task.output = result.text;
    // Infrastructure also goes through review cycle
  } else {
    // Implementation task
    const prompt = buildImplementationPrompt({
      task: `${task.title}\n\n${task.description}`,
      files: task.filesAffected.join('\n'),
      steps: task.description,
      acceptanceCriteria: task.acceptanceCriteria.join('\n'),
      context: ctx.state.specification ?? ctx.state.input,
    });
    const result = await runAgent(implEngineer, prompt, ctx);
    task.output = result.text;
  }

  // Test → Review loop
  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    task.reviewIterations = iteration;
    ctx.onEvent({
      type: 'iteration',
      agent: 'review-cycle',
      iteration,
      maxIterations,
      reason: iteration === 1 ? 'Initial review' : 'Addressing feedback',
    });

    // Run tests
    task.status = 'testing';
    const testPrompt = buildTestRunnerPrompt({
      whatChanged: task.output ?? '',
      filesModified: task.filesAffected.join('\n'),
      acceptanceCriteria: task.acceptanceCriteria.join('\n'),
    });
    const testResult = await runAgent(testRunner, testPrompt, ctx);

    const testGate = await gateTestReview(testResult.text, ctx.config.models, ctx.onEvent);
    if (!testGate.passed) {
      // Send back to implementation
      const fixPrompt = buildImplementationPrompt({
        task: `Fix failing tests for: ${task.title}`,
        files: task.filesAffected.join('\n'),
        steps: `Fix the following test failures:\n\n${testResult.text}`,
        acceptanceCriteria: task.acceptanceCriteria.join('\n'),
        context: task.output ?? '',
      });
      const fixResult = await runAgent(implEngineer, fixPrompt, ctx);
      task.output = fixResult.text;
      continue; // Re-test
    }

    // Code review
    task.status = 'reviewing';
    const reviewPrompt = buildCodeReviewPrompt({
      whatChanged: task.output ?? '',
      filesToReview: task.filesAffected.join('\n'),
      context: `Task: ${task.title}\n\nSpec: ${ctx.state.specification?.slice(0, 500) ?? ctx.state.input.slice(0, 500)}`,
    });
    const reviewResult = await runAgent(codeReviewer, reviewPrompt, ctx);

    const reviewGate = await gateCodeReview(reviewResult.text, ctx.config.models, ctx.onEvent);
    if (reviewGate.passed) {
      task.status = 'approved';
      break;
    }

    // Address review feedback
    if (iteration < maxIterations) {
      const fixPrompt = buildImplementationPrompt({
        task: `Address code review feedback for: ${task.title}`,
        files: task.filesAffected.join('\n'),
        steps: `Address the following review feedback:\n\n${reviewResult.text}`,
        acceptanceCriteria: task.acceptanceCriteria.join('\n'),
        context: task.output ?? '',
      });
      const fixResult = await runAgent(implEngineer, fixPrompt, ctx);
      task.output = fixResult.text;
    } else {
      // Max iterations reached — escalate
      task.status = 'escalated';
      ctx.onEvent({
        type: 'error',
        message: `Task ${task.id} reached max review iterations (${maxIterations}). Escalating.`,
        recoverable: true,
      });
      logger.warn(`Task ${task.id} escalated after ${maxIterations} iterations`);
    }
  }

  if (task.status === 'approved') {
    task.status = 'complete';
  }
}

/**
 * Phase 4: Completion — summary and verification.
 */
export async function phase4Completion(ctx: PhaseContext): Promise<string> {
  updatePhase(ctx.state, 'complete');
  ctx.onEvent({ type: 'phase_start', phase: 'Phase 4', description: 'Completion' });

  const tasks = Array.from(ctx.state.tasks.values());
  const completed = tasks.filter((t) => t.status === 'complete').length;
  const failed = tasks.filter((t) => t.status === 'failed' || t.status === 'escalated').length;

  const totalTokens = Object.values(ctx.state.tokenUsage).reduce(
    (sum, u) => sum + u.input + u.output, 0
  );

  const summary = `## Complete

### Summary
- Tasks Completed: ${completed}/${tasks.length}
- Failed/Escalated: ${failed}
- Total Tokens: ${totalTokens.toLocaleString()}
- Estimated Cost: $${ctx.state.costEstimate}

### Token Usage by Model
${Object.entries(ctx.state.tokenUsage).map(
    ([model, usage]) => `- ${model}: ${(usage.input + usage.output).toLocaleString()} tokens`
  ).join('\n')}

### Tasks
${tasks.map((t) => `- ${t.id}: ${t.title} — ${t.status}`).join('\n')}`;

  await saveState(ctx.state, ctx.config.stateDir);
  ctx.onEvent({ type: 'build_complete', summary });
  ctx.onEvent({ type: 'phase_complete', phase: 'Phase 4', summary: 'Build complete' });

  return summary;
}

/**
 * Fast Path: Bug fixes — impl → test → review cycle without spec/breakdown.
 */
export async function fastPathBugFix(ctx: PhaseContext): Promise<string> {
  updatePhase(ctx.state, 'execution');
  ctx.onEvent({ type: 'phase_start', phase: 'Fast Path', description: 'Bug Fix' });

  // Create a synthetic task for tracking
  const task: TaskState = {
    id: 'TASK-001',
    title: 'Bug Fix',
    type: 'implementation',
    description: ctx.state.input,
    acceptanceCriteria: ['Bug is fixed', 'Regression test passes'],
    dependencies: [],
    canRunInParallelWith: [],
    assignedAgent: 'implementation-engineer',
    status: 'in-progress',
    filesAffected: [],
    complexity: 'medium',
    reviewIterations: 0,
  };
  addTask(ctx.state, task);

  const bugPrompt = buildBugFixPrompt({
    bugDescription: ctx.state.input,
    filePaths: '(analyze from bug description)',
  });

  const implResult = await runAgent(implEngineer, bugPrompt, ctx);
  task.output = implResult.text;

  const maxIterations = ctx.config.maxReviewIterations;
  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    task.reviewIterations = iteration;
    ctx.onEvent({
      type: 'iteration',
      agent: 'review-cycle',
      iteration,
      maxIterations,
      reason: iteration === 1 ? 'Initial review' : 'Addressing feedback',
    });

    task.status = 'testing';
    const testPrompt = buildTestRunnerPrompt({
      whatChanged: task.output ?? '',
      filesModified: '(see implementation output)',
      acceptanceCriteria: 'Bug is fixed and regression test passes',
    });
    const testResult = await runAgent(testRunner, testPrompt, ctx);

    const testGate = await gateTestReview(testResult.text, ctx.config.models, ctx.onEvent);
    if (!testGate.passed) {
      const fixPrompt = buildImplementationPrompt({
        task: 'Fix failing tests for: Bug Fix',
        files: '(see implementation output)',
        steps: `Fix the following test failures:\n\n${testResult.text}`,
        acceptanceCriteria: 'Bug is fixed and regression test passes',
        context: task.output ?? '',
      });
      const fixResult = await runAgent(implEngineer, fixPrompt, ctx);
      task.output = fixResult.text;
      continue;
    }

    task.status = 'reviewing';
    const reviewPrompt = buildCodeReviewPrompt({
      whatChanged: task.output ?? '',
      filesToReview: '(see implementation output)',
      context: `Bug fix: ${ctx.state.input.slice(0, 300)}`,
    });
    const reviewResult = await runAgent(codeReviewer, reviewPrompt, ctx);

    const reviewGate = await gateCodeReview(reviewResult.text, ctx.config.models, ctx.onEvent);
    if (reviewGate.passed) {
      task.status = 'complete';
      break;
    }

    if (iteration < maxIterations) {
      const fixPrompt = buildImplementationPrompt({
        task: 'Address code review feedback for: Bug Fix',
        files: '(see implementation output)',
        steps: `Address the following review feedback:\n\n${reviewResult.text}`,
        acceptanceCriteria: 'Bug is fixed and regression test passes',
        context: task.output ?? '',
      });
      const fixResult = await runAgent(implEngineer, fixPrompt, ctx);
      task.output = fixResult.text;
    } else {
      task.status = 'escalated';
      ctx.onEvent({
        type: 'error',
        message: `Task ${task.id} reached max review iterations (${maxIterations}). Escalating.`,
        recoverable: true,
      });
      logger.warn(`Task ${task.id} escalated after ${maxIterations} iterations`);
    }
  }

  return phase4Completion(ctx);
}

/**
 * Implementation Fast Path — pre-specified work goes straight to implementation.
 */
export async function fastPathImplSpec(ctx: PhaseContext): Promise<string> {
  updatePhase(ctx.state, 'execution');
  ctx.onEvent({ type: 'phase_start', phase: 'Implementation Fast Path', description: 'Pre-specified work' });

  // Create a synthetic task for tracking
  const task: TaskState = {
    id: 'TASK-001',
    title: 'Implementation',
    type: 'implementation',
    description: ctx.state.input,
    acceptanceCriteria: ['Implementation matches spec'],
    dependencies: [],
    canRunInParallelWith: [],
    assignedAgent: 'implementation-engineer',
    status: 'in-progress',
    filesAffected: [],
    complexity: 'medium',
    reviewIterations: 0,
  };
  addTask(ctx.state, task);

  const implResult = await runAgent(implEngineer, ctx.state.input, ctx);
  task.output = implResult.text;

  const maxIterations = ctx.config.maxReviewIterations;
  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    task.reviewIterations = iteration;
    ctx.onEvent({
      type: 'iteration',
      agent: 'review-cycle',
      iteration,
      maxIterations,
      reason: iteration === 1 ? 'Initial review' : 'Addressing feedback',
    });

    task.status = 'testing';
    const testPrompt = buildTestRunnerPrompt({
      whatChanged: task.output ?? '',
      filesModified: '(see implementation output)',
      acceptanceCriteria: '(from implementation spec)',
    });
    const testResult = await runAgent(testRunner, testPrompt, ctx);

    const testGate = await gateTestReview(testResult.text, ctx.config.models, ctx.onEvent);
    if (!testGate.passed) {
      const fixPrompt = buildImplementationPrompt({
        task: 'Fix failing tests for: Implementation',
        files: '(see implementation output)',
        steps: `Fix the following test failures:\n\n${testResult.text}`,
        acceptanceCriteria: '(from implementation spec)',
        context: task.output ?? '',
      });
      const fixResult = await runAgent(implEngineer, fixPrompt, ctx);
      task.output = fixResult.text;
      continue;
    }

    task.status = 'reviewing';
    const reviewPrompt = buildCodeReviewPrompt({
      whatChanged: task.output ?? '',
      filesToReview: '(see implementation output)',
      context: ctx.state.input.slice(0, 500),
    });
    const reviewResult = await runAgent(codeReviewer, reviewPrompt, ctx);

    const reviewGate = await gateCodeReview(reviewResult.text, ctx.config.models, ctx.onEvent);
    if (reviewGate.passed) {
      task.status = 'complete';
      break;
    }

    if (iteration < maxIterations) {
      const fixPrompt = buildImplementationPrompt({
        task: 'Address code review feedback for: Implementation',
        files: '(see implementation output)',
        steps: `Address the following review feedback:\n\n${reviewResult.text}`,
        acceptanceCriteria: '(from implementation spec)',
        context: task.output ?? '',
      });
      const fixResult = await runAgent(implEngineer, fixPrompt, ctx);
      task.output = fixResult.text;
    } else {
      task.status = 'escalated';
      ctx.onEvent({
        type: 'error',
        message: `Task ${task.id} reached max review iterations (${maxIterations}). Escalating.`,
        recoverable: true,
      });
      logger.warn(`Task ${task.id} escalated after ${maxIterations} iterations`);
    }
  }

  return phase4Completion(ctx);
}

/**
 * Parse task breakdown markdown into TaskState objects.
 * Extracts task IDs, titles, types, dependencies, etc.
 */
export function parseTaskBreakdown(markdown: string): TaskState[] {
  const tasks: TaskState[] = [];
  // Match task headers like "### TASK-001: Title" or "### TASK-001" (title may be on a separate line)
  const taskRegex = /###\s+(TASK-\d+)(?::\s*(.+))?/g;

  // Collect all matches first to avoid global-regex lastIndex bugs with peek-ahead
  const matches: { id: string; title: string; headerStart: number; bodyStart: number }[] = [];
  let match: RegExpExecArray | null;
  while ((match = taskRegex.exec(markdown)) !== null) {
    matches.push({
      id: match[1],
      title: match[2]?.trim() ?? '',
      headerStart: match.index,
      bodyStart: match.index + match[0].length,
    });
  }

  for (let i = 0; i < matches.length; i++) {
    const { id, title, bodyStart } = matches[i];
    const endIdx = i + 1 < matches.length ? matches[i + 1].headerStart : markdown.length;
    const section = markdown.slice(bodyStart, endIdx);

    // Parse fields from the section
    const resolvedTitle = (title || extractField(section, 'Title')) ?? id;
    const type = extractField(section, 'Type') as TaskType ?? 'implementation';
    const complexity = extractField(section, 'Complexity') as 'low' | 'medium' | 'high' ?? 'medium';
    const deps = extractList(section, 'Dependencies');
    const parallel = extractList(section, 'Can Run In Parallel With') ?? extractList(section, 'Parallel With');
    const files = extractList(section, 'Files Affected') ?? extractList(section, 'Files');
    const criteria = extractList(section, 'Acceptance Criteria');
    const description = extractBlock(section, 'Description') ?? resolvedTitle;

    // Map type to assigned agent
    const agentMap: Record<string, string> = {
      'implementation': 'implementation-engineer',
      'testing': 'test-runner',
      'documentation': 'implementation-engineer',
      'infrastructure': 'infrastructure-engineer',
      'deployment': 'infrastructure-engineer',
      'design': 'ui-ux-designer',
    };

    tasks.push({
      id,
      title: resolvedTitle,
      type: normalizeType(type),
      description,
      acceptanceCriteria: criteria,
      dependencies: deps.filter((d) => d.startsWith('TASK-')),
      canRunInParallelWith: parallel.filter((p) => p.startsWith('TASK-')),
      assignedAgent: agentMap[normalizeType(type)] ?? 'implementation-engineer',
      status: 'pending' as TaskStatus,
      filesAffected: files,
      complexity: normalizeComplexity(complexity),
      reviewIterations: 0,
    });
  }

  return tasks;
}

function extractField(section: string, fieldName: string): string | null {
  const regex = new RegExp(`\\*\\*${fieldName}\\*\\*:\\s*(.+)`, 'i');
  const match = section.match(regex);
  return match?.[1]?.trim().replace(/^None$/i, '') || null;
}

function extractList(section: string, fieldName: string): string[] {
  const regex = new RegExp(`\\*\\*${fieldName}\\*\\*:?\\s*\\n([\\s\\S]*?)(?=\\n\\*\\*|$)`, 'i');
  const match = section.match(regex);
  if (!match) {
    // Try inline list
    const inlineRegex = new RegExp(`\\*\\*${fieldName}\\*\\*:\\s*(.+)`, 'i');
    const inlineMatch = section.match(inlineRegex);
    if (inlineMatch) {
      return inlineMatch[1].split(',').map((s) => s.trim()).filter(Boolean);
    }
    return [];
  }
  return match[1]
    .split('\n')
    .map((line) => line.replace(/^[\s-]*\[[ x]?\]\s*/, '').replace(/^[\s-]+/, '').trim())
    .filter(Boolean);
}

function extractBlock(section: string, fieldName: string): string | null {
  const regex = new RegExp(`\\*\\*${fieldName}:?\\*\\*:?\\s*\\n([\\s\\S]*?)(?=\\n\\*\\*|$)`, 'i');
  const match = section.match(regex);
  return match?.[1]?.trim() || null;
}

function normalizeType(type: string): TaskType {
  const normalized = type.toLowerCase().trim();
  const typeMap: Record<string, TaskType> = {
    'implementation': 'implementation',
    'testing': 'testing',
    'test': 'testing',
    'documentation': 'documentation',
    'docs': 'documentation',
    'infrastructure': 'infrastructure',
    'infra': 'infrastructure',
    'deployment': 'deployment',
    'deploy': 'deployment',
    'design': 'design',
    'ui': 'design',
    'ux': 'design',
  };
  return typeMap[normalized] ?? 'implementation';
}

function normalizeComplexity(c: string): 'low' | 'medium' | 'high' {
  const normalized = c.toLowerCase().trim();
  if (normalized.includes('low')) return 'low';
  if (normalized.includes('high')) return 'high';
  return 'medium';
}
