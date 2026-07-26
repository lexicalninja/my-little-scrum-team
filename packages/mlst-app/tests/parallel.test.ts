import { describe, it, expect } from 'vitest';
import { buildExecutionPlan, executeParallel } from '../src/orchestrator/parallel.js';
import type { TaskState } from '../src/state/types.js';

function makeTask(id: string, type: string, deps: string[] = []): TaskState {
  return {
    id,
    title: `Task ${id}`,
    type: type as any,
    description: '',
    acceptanceCriteria: [],
    dependencies: deps,
    canRunInParallelWith: [],
    assignedAgent: 'implementation-engineer',
    status: 'pending',
    filesAffected: [],
    complexity: 'medium',
    reviewIterations: 0,
  };
}

describe('buildExecutionPlan', () => {
  it('groups independent tasks together', () => {
    const tasks = [
      makeTask('TASK-001', 'infrastructure'),
      makeTask('TASK-002', 'design'),
      makeTask('TASK-003', 'implementation', ['TASK-001', 'TASK-002']),
    ];

    const plan = buildExecutionPlan(tasks);
    expect(plan).toHaveLength(2);
    expect(plan[0].tasks).toHaveLength(2); // TASK-001 and TASK-002 in parallel
    expect(plan[1].tasks).toHaveLength(1); // TASK-003 after both
  });

  it('handles linear dependencies', () => {
    const tasks = [
      makeTask('TASK-001', 'infrastructure'),
      makeTask('TASK-002', 'implementation', ['TASK-001']),
      makeTask('TASK-003', 'testing', ['TASK-002']),
    ];

    const plan = buildExecutionPlan(tasks);
    expect(plan).toHaveLength(3);
    expect(plan[0].tasks[0].id).toBe('TASK-001');
    expect(plan[1].tasks[0].id).toBe('TASK-002');
    expect(plan[2].tasks[0].id).toBe('TASK-003');
  });

  it('handles tasks with no dependencies', () => {
    const tasks = [
      makeTask('TASK-001', 'implementation'),
      makeTask('TASK-002', 'implementation'),
      makeTask('TASK-003', 'implementation'),
    ];

    const plan = buildExecutionPlan(tasks);
    expect(plan).toHaveLength(1);
    expect(plan[0].tasks).toHaveLength(3);
  });

  it('names groups based on task types', () => {
    const tasks = [
      makeTask('TASK-001', 'infrastructure'),
      makeTask('TASK-002', 'design'),
    ];

    const plan = buildExecutionPlan(tasks);
    expect(plan[0].name).toContain('Design + Infrastructure');
  });
});

describe('executeParallel', () => {
  it('executes all tasks and returns results', async () => {
    const tasks = [
      makeTask('TASK-001', 'implementation'),
      makeTask('TASK-002', 'implementation'),
    ];

    const results = await executeParallel(tasks, async (task) => {
      return `Result for ${task.id}`;
    });

    expect(results.size).toBe(2);
    expect(results.get('TASK-001')).toBe('Result for TASK-001');
    expect(results.get('TASK-002')).toBe('Result for TASK-002');
  });
});
