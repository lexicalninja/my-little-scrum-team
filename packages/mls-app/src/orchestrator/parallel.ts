/**
 * Parallel execution manager — resolves task dependencies and runs
 * independent tasks concurrently using Promise.all.
 */
import type { TaskState } from '../state/types.js';

export interface ExecutionGroup {
  /** Group name (e.g., "Design + Infrastructure", "Implementation") */
  name: string;
  /** Tasks in this group — can be executed in parallel */
  tasks: TaskState[];
}

/**
 * Topological sort of tasks by dependencies, grouped into parallel execution layers.
 */
export function buildExecutionPlan(tasks: TaskState[]): ExecutionGroup[] {
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const completed = new Set<string>();
  const groups: ExecutionGroup[] = [];

  let remaining = [...tasks];
  let groupIndex = 0;

  while (remaining.length > 0) {
    // Find tasks whose dependencies are all completed
    const ready = remaining.filter((task) =>
      task.dependencies.every((dep) => completed.has(dep))
    );

    if (ready.length === 0) {
      // Circular dependency or missing dependencies — just take remaining
      groups.push({
        name: `Group ${groupIndex + 1}: Remaining (unresolved dependencies)`,
        tasks: remaining,
      });
      break;
    }

    // Categorize by type for naming
    const types = new Set(ready.map((t) => t.type));
    let groupName: string;
    if (types.has('design') && types.has('infrastructure')) {
      groupName = `Group ${groupIndex + 1}: Design + Infrastructure`;
    } else if (types.has('design')) {
      groupName = `Group ${groupIndex + 1}: Design`;
    } else if (types.has('infrastructure')) {
      groupName = `Group ${groupIndex + 1}: Infrastructure`;
    } else if (types.has('implementation')) {
      groupName = `Group ${groupIndex + 1}: Implementation`;
    } else if (types.has('testing')) {
      groupName = `Group ${groupIndex + 1}: Testing`;
    } else {
      groupName = `Group ${groupIndex + 1}`;
    }

    groups.push({ name: groupName, tasks: ready });

    for (const task of ready) {
      completed.add(task.id);
    }

    remaining = remaining.filter((t) => !completed.has(t.id));
    groupIndex++;
  }

  return groups;
}

/**
 * Execute tasks in parallel within a group.
 * @param tasks Tasks to execute in parallel
 * @param executor Function that executes a single task and returns its result
 */
export async function executeParallel<T>(
  tasks: TaskState[],
  executor: (task: TaskState) => Promise<T>,
): Promise<Map<string, T>> {
  const results = new Map<string, T>();
  const promises = tasks.map(async (task) => {
    const result = await executor(task);
    results.set(task.id, result);
    return result;
  });

  await Promise.all(promises);
  return results;
}
