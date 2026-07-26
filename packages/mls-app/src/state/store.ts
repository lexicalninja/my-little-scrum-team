/**
 * Central build state management.
 */
import { randomUUID } from 'node:crypto';
import type { BuildState, BuildPhase, InputType, TaskState, TokenUsage } from './types.js';

export function createBuildState(input: string, inputType: InputType): BuildState {
  return {
    id: randomUUID().slice(0, 8),
    input,
    inputType,
    phase: 'refinement',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tasks: new Map(),
    tokenUsage: {},
    costEstimate: 0,
  };
}

export function updatePhase(state: BuildState, phase: BuildPhase): BuildState {
  state.phase = phase;
  state.updatedAt = new Date().toISOString();
  return state;
}

export function addTask(state: BuildState, task: TaskState): BuildState {
  state.tasks.set(task.id, task);
  state.updatedAt = new Date().toISOString();
  return state;
}

export function updateTask(state: BuildState, taskId: string, updates: Partial<TaskState>): BuildState {
  const task = state.tasks.get(taskId);
  if (task) {
    Object.assign(task, updates);
    state.updatedAt = new Date().toISOString();
  }
  return state;
}

/** Track token usage per model for cost visibility */
export function trackTokenUsage(state: BuildState, model: string, usage: TokenUsage): BuildState {
  const existing = state.tokenUsage[model] ?? { input: 0, output: 0 };
  state.tokenUsage[model] = {
    input: existing.input + usage.input,
    output: existing.output + usage.output,
  };
  state.costEstimate = calculateCost(state.tokenUsage);
  state.updatedAt = new Date().toISOString();
  return state;
}

/** Rough cost estimates per model (per 1M tokens) */
const COST_PER_1M: Record<string, { input: number; output: number }> = {
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4o': { input: 2.50, output: 10.00 },
  'claude-sonnet-4-20250514': { input: 3.00, output: 15.00 },
  'claude-opus-4-20250115': { input: 15.00, output: 75.00 },
};

function calculateCost(usage: Record<string, TokenUsage>): number {
  let total = 0;
  for (const [model, tokens] of Object.entries(usage)) {
    const rates = COST_PER_1M[model] ?? { input: 3.00, output: 15.00 }; // default to sonnet-ish
    total += (tokens.input / 1_000_000) * rates.input;
    total += (tokens.output / 1_000_000) * rates.output;
  }
  return Math.round(total * 10000) / 10000;
}

/** Serialize state for persistence (Map → Object) */
export function serializeState(state: BuildState): Record<string, unknown> {
  return {
    ...state,
    tasks: Object.fromEntries(state.tasks),
  };
}

/** Deserialize state from persistence (Object → Map) */
export function deserializeState(data: Record<string, unknown>): BuildState {
  const state = { ...data } as unknown as BuildState;
  if (data.tasks && typeof data.tasks === 'object' && !(data.tasks instanceof Map)) {
    state.tasks = new Map(Object.entries(data.tasks as Record<string, TaskState>));
  }
  return state;
}
