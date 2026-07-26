/**
 * Base agent — wraps Vercel AI SDK generateText() with tool loop.
 * Each agent gets a system prompt (from markdown + skills), a model (from router),
 * and a set of permitted tools.
 */
import { generateText, type LanguageModel, type CoreTool, type StepResult } from 'ai';
import type { ToolSet } from '../tools/types.js';
import type { AgentName } from '../models/types.js';
import type { MLSTConfig } from '../config/schema.js';
import type { BuildEventCallback, TokenUsage } from '../state/types.js';
import { getModelForRole, getModelId } from '../models/router.js';
import { getToolsForPermission, AGENT_PERMISSIONS } from '../tools/registry.js';
import { getSkillContentForAgent } from '../skills/loader.js';
import { AGENT_SKILLS } from '../skills/registry.js';
import { logger } from '../utils/logger.js';

export interface AgentContext {
  /** The prompt/task to execute */
  userPrompt: string;
  /** Optional additional system context */
  additionalContext?: string;
  /** Build event callback for streaming updates */
  onEvent?: BuildEventCallback;
  /** Config overrides */
  config?: MLSTConfig;
  /** Path to skills markdown directory */
  skillsDir?: string;
}

export interface AgentResult {
  text: string;
  tokenUsage: TokenUsage;
  model: string;
  steps: number;
}

export abstract class BaseAgent {
  abstract readonly name: AgentName;
  abstract readonly systemPromptBase: string;

  async getSystemPrompt(skillsDir?: string): Promise<string> {
    const skillNames = AGENT_SKILLS[this.name] ?? [];
    const skillContent = await getSkillContentForAgent(skillNames, skillsDir);

    const parts = [this.systemPromptBase];
    if (skillContent) {
      parts.push(skillContent);
    }
    return parts.join('\n\n');
  }

  getModel(config?: MLSTConfig): LanguageModel {
    return getModelForRole(this.name, config?.models);
  }

  getTools(): ToolSet {
    const permission = AGENT_PERMISSIONS[this.name] ?? 'readOnly';
    return getToolsForPermission(permission);
  }

  async execute(context: AgentContext): Promise<AgentResult> {
    const model = this.getModel(context.config);
    const modelId = getModelId(this.name, context.config?.models);
    const tools = this.getTools();
    const systemPrompt = await this.getSystemPrompt(context.skillsDir);
    const maxSteps = context.config?.maxSteps ?? 50;

    const fullSystemPrompt = context.additionalContext
      ? `${systemPrompt}\n\n## Additional Context\n\n${context.additionalContext}`
      : systemPrompt;

    context.onEvent?.({
      type: 'agent_start',
      agent: this.name,
      task: context.userPrompt.slice(0, 100),
      model: modelId,
    });

    logger.agent(this.name, `Starting (${modelId})`);

    let stepCount = 0;

    const result = await retryWithBackoff(() => generateText({
      model,
      system: fullSystemPrompt,
      prompt: context.userPrompt,
      tools: tools as Record<string, CoreTool>,
      maxSteps,
      experimental_repairToolCall: async ({ toolCall }) => {
        const cleaned = toolCall.args.replace(/[\x00-\x09\x0B\x0C\x0E-\x1F]/g, '');
        return { ...toolCall, args: cleaned };
      },
      onStepFinish: (step: StepResult<Record<string, CoreTool>>) => {
        stepCount++;

        // Log tool usage
        if (step.toolCalls && step.toolCalls.length > 0) {
          for (const tc of step.toolCalls) {
            const inputPreview = JSON.stringify(tc.args).slice(0, 100);
            logger.agent(this.name, `Tool: ${tc.toolName}(${inputPreview})`);
            context.onEvent?.({
              type: 'agent_tool_use',
              agent: this.name,
              tool: tc.toolName,
              input: inputPreview,
            });
          }
        }

        // Log thinking
        if (step.text) {
          const preview = step.text.slice(0, 200);
          context.onEvent?.({
            type: 'agent_thinking',
            agent: this.name,
            content: preview,
          });
        }
      },
    }), this.name);

    const tokenUsage: TokenUsage = {
      input: result.usage?.promptTokens ?? 0,
      output: result.usage?.completionTokens ?? 0,
    };

    const totalTokens = tokenUsage.input + tokenUsage.output;
    logger.agent(this.name, `Complete (${totalTokens} tokens, ${stepCount} steps)`);

    context.onEvent?.({
      type: 'agent_complete',
      agent: this.name,
      summary: result.text.slice(0, 200),
      tokens: totalTokens,
    });

    return {
      text: result.text,
      tokenUsage,
      model: modelId,
      steps: stepCount,
    };
  }
}

/** Retry with exponential backoff for rate-limit errors */
async function retryWithBackoff<T>(fn: () => Promise<T>, agentName: string, maxRetries = 5): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const isRateLimit = message.includes('Rate limit') || message.includes('429') || message.includes('rate_limit');
      const isInvalidArgs =
        message.includes('Invalid arguments for tool') ||
        message.includes('JSON parsing failed');

      if ((!isRateLimit && !isInvalidArgs) || attempt === maxRetries) {
        throw error;
      }

      // Parse wait time from error message if available, otherwise use exponential backoff
      const waitMatch = message.match(/wait (\d+) seconds/i);
      const waitMs = waitMatch
        ? parseInt(waitMatch[1]) * 1000 + 1000 // add 1s buffer
        : Math.min(2000 * Math.pow(2, attempt), 60000);

      logger.info(`[${agentName}] Rate limited, waiting ${Math.round(waitMs / 1000)}s before retry ${attempt + 1}/${maxRetries}`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  throw new Error('Unreachable');
}
