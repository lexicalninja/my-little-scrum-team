/**
 * Main orchestration engine — ties classification, phases, and state together.
 * This is the central entry point that implements the full build pipeline.
 */
import type { BuildState, BuildResult, BuildEvent, BuildEventCallback } from '../state/types.js';
import type { MLSTConfig } from '../config/schema.js';
import type { UserInteraction } from '../interaction/interface.js';
import { ClarificationNeeded } from '../interaction/mcp-interaction.js';
import { createBuildState } from '../state/store.js';
import { saveState, loadState } from '../state/persistence.js';
import { classifyInput } from './classifier.js';
import {
  phase0IdeaRefinement,
  phase1Specification,
  phase2TaskBreakdown,
  phase3Execution,
  phase4Completion,
  fastPathBugFix,
  fastPathImplSpec,
} from './phases.js';
import { logger } from '../utils/logger.js';

export interface BuildOptions {
  /** Per-call interaction override */
  interaction?: UserInteraction;
  /** Pre-classified input type (skips classifier) */
  inputType?: string;
  /** Resume from a previous run */
  resumeId?: string;
  /** Additional context for resumed builds */
  resumeContext?: string;
  /** GitHub issue number to fetch */
  fromIssue?: number;
  /** File path containing the input */
  fromFile?: string;
}

export class OrchestrationEngine {
  private config: MLSTConfig;
  private interaction: UserInteraction;
  private abortController: AbortController;

  constructor(config: MLSTConfig, interaction: UserInteraction) {
    this.config = config;
    this.interaction = interaction;
    this.abortController = new AbortController();
  }

  /**
   * Main entry point — run a full build from input to completion.
   */
  async build(
    input: string,
    onEvent: BuildEventCallback = () => {},
    options: BuildOptions = {},
  ): Promise<BuildResult> {
    let state: BuildState;

    // Handle resume
    if (options.resumeId) {
      try {
        state = await loadState(options.resumeId, this.config.stateDir);
        if (options.resumeContext) {
          state.resumeContext = options.resumeContext;
        }
        logger.info(`Resuming build ${state.id} from phase: ${state.phase}`);
        onEvent({ type: 'phase_start', phase: 'Resume', description: `Resuming from ${state.phase}` });
      } catch (error) {
        return {
          success: false,
          state: createBuildState(input, 'feature'),
          summary: `Failed to resume build: ${error}`,
        };
      }
    } else {
      // Classify input
      const inputType = await classifyInput(input, this.config.models);
      state = createBuildState(input, inputType);
      logger.info(`Build ${state.id} started — input type: ${inputType}`);
    }

    const ctx = {
      state,
      config: this.config,
      interaction: options.interaction ?? this.interaction,
      onEvent,
      abortSignal: this.abortController.signal,
    };

    try {
      let summary: string;

      // Route based on input type
      switch (state.inputType) {
        case 'bug':
          summary = await fastPathBugFix(ctx);
          break;

        case 'impl-spec':
          summary = await fastPathImplSpec(ctx);
          break;

        case 'requirements':
          // Skip Phase 0, go straight to spec
          await phase1Specification(ctx);
          await phase2TaskBreakdown(ctx);
          await phase3Execution(ctx);
          summary = await phase4Completion(ctx);
          break;

        case 'plan':
          // Plan decomposition → then run each epic through full pipeline
          // For now, treat as a single feature through the full pipeline
          // TODO: Implement plan decomposition with multiple epics
          await phase0IdeaRefinement(ctx);
          await phase1Specification(ctx);
          await phase2TaskBreakdown(ctx);
          await phase3Execution(ctx);
          summary = await phase4Completion(ctx);
          break;

        case 'epic':
        case 'feature':
        default:
          // Full pipeline: Phase 0 → 1 → 2 → 3 → 4
          // Handle resume: skip completed phases
          if (state.phase === 'refinement' || !state.decisionRecord) {
            await phase0IdeaRefinement(ctx);
          }
          if (state.phase === 'refinement' || state.phase === 'specification' || !state.specification) {
            await phase1Specification(ctx);
          }
          if (state.phase !== 'execution' && state.phase !== 'complete') {
            await phase2TaskBreakdown(ctx);
          }
          if (state.phase !== 'complete') {
            await phase3Execution(ctx);
          }
          summary = await phase4Completion(ctx);
          break;
      }

      return { success: true, state, summary };
    } catch (error) {
      if (error instanceof ClarificationNeeded) {
        state.error = 'awaiting_clarification';
        await saveState(state, this.config.stateDir);
        return {
          success: false,
          state,
          summary: 'Clarification needed before build can proceed.',
          needs_clarification: true,
          clarification_question: error.question,
        };
      }

      const message = error instanceof Error ? error.message : String(error);

      // Save state for resume on error
      state.error = message;
      await saveState(state, this.config.stateDir);

      onEvent({ type: 'error', message, recoverable: true });
      logger.error(`Build ${state.id} failed: ${message}`);

      return {
        success: false,
        state,
        summary: `Build failed: ${message}\nResume with: mlst build --resume ${state.id}`,
      };
    }
  }

  /** Cancel the current build gracefully */
  cancel() {
    this.abortController.abort();
    logger.info('Build cancellation requested');
  }

  /** Get status of a build run */
  async getStatus(runId: string): Promise<BuildState> {
    return loadState(runId, this.config.stateDir);
  }
}
