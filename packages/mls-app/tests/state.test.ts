import { describe, it, expect } from 'vitest';
import {
  createBuildState,
  updatePhase,
  addTask,
  trackTokenUsage,
  serializeState,
  deserializeState,
} from '../src/state/store.js';
import type { TaskState } from '../src/state/types.js';

describe('BuildState', () => {
  it('creates initial state', () => {
    const state = createBuildState('Add auth', 'feature');
    expect(state.id).toBeTruthy();
    expect(state.input).toBe('Add auth');
    expect(state.inputType).toBe('feature');
    expect(state.phase).toBe('refinement');
    expect(state.tasks.size).toBe(0);
    expect(state.costEstimate).toBe(0);
  });

  it('updates phase', () => {
    const state = createBuildState('Test', 'feature');
    updatePhase(state, 'specification');
    expect(state.phase).toBe('specification');
  });

  it('adds and tracks tasks', () => {
    const state = createBuildState('Test', 'feature');
    const task: TaskState = {
      id: 'TASK-001',
      title: 'Setup DB',
      type: 'infrastructure',
      description: 'Create schema',
      acceptanceCriteria: ['Schema created'],
      dependencies: [],
      canRunInParallelWith: [],
      assignedAgent: 'infrastructure-engineer',
      status: 'pending',
      filesAffected: ['schema.sql'],
      complexity: 'medium',
      reviewIterations: 0,
    };
    addTask(state, task);
    expect(state.tasks.size).toBe(1);
    expect(state.tasks.get('TASK-001')?.title).toBe('Setup DB');
  });

  it('tracks token usage and calculates cost', () => {
    const state = createBuildState('Test', 'feature');
    trackTokenUsage(state, 'gpt-4o-mini', { input: 1000, output: 500 });
    expect(state.tokenUsage['gpt-4o-mini']).toEqual({ input: 1000, output: 500 });
    expect(state.costEstimate).toBeGreaterThan(0);

    // Accumulates
    trackTokenUsage(state, 'gpt-4o-mini', { input: 2000, output: 1000 });
    expect(state.tokenUsage['gpt-4o-mini']).toEqual({ input: 3000, output: 1500 });
  });

  it('serializes and deserializes correctly', () => {
    const state = createBuildState('Test', 'feature');
    addTask(state, {
      id: 'TASK-001',
      title: 'Test task',
      type: 'implementation',
      description: 'Do stuff',
      acceptanceCriteria: [],
      dependencies: [],
      canRunInParallelWith: [],
      assignedAgent: 'implementation-engineer',
      status: 'pending',
      filesAffected: [],
      complexity: 'low',
      reviewIterations: 0,
    });

    const serialized = serializeState(state);
    expect(serialized.tasks).not.toBeInstanceOf(Map);

    const deserialized = deserializeState(serialized);
    expect(deserialized.tasks).toBeInstanceOf(Map);
    expect(deserialized.tasks.get('TASK-001')?.title).toBe('Test task');
  });
});
