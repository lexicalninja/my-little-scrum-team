import { describe, it, expect } from 'vitest';
import { parseTaskBreakdown } from '../src/orchestrator/phases.js';

const INLINE_FORMAT = `
### TASK-001: Set up project structure

**Type**: infrastructure
**Complexity**: low
**Dependencies**: None
**Can Run In Parallel With**: None
**Files Affected**: package.json, tsconfig.json
**Acceptance Criteria**:
- [ ] Project builds successfully
- [ ] Dependencies installed

**Description**: Initialize the project with required configuration files.
`;

const SPLIT_FORMAT = `
### TASK-001

**Title**: Set up project structure
**Type**: infrastructure
**Complexity**: low
**Dependencies**: None
**Can Run In Parallel With**: None
**Files Affected**: package.json, tsconfig.json
**Acceptance Criteria**:
- [ ] Project builds successfully
- [ ] Dependencies installed

**Description**: Initialize the project with required configuration files.
`;

const MIXED_FORMAT = `
### TASK-001: Set up project structure

**Type**: infrastructure
**Complexity**: low
**Dependencies**: None
**Can Run In Parallel With**: TASK-002

**Description**: Initialize the project.

### TASK-002

**Title**: Implement core feature
**Type**: implementation
**Complexity**: high
**Dependencies**: TASK-001
**Can Run In Parallel With**: None
**Files Affected**: src/index.ts

**Description**: Build the main feature.
`;

describe('parseTaskBreakdown', () => {
  it('parses inline format (### TASK-001: Title)', () => {
    const tasks = parseTaskBreakdown(INLINE_FORMAT);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe('TASK-001');
    expect(tasks[0].title).toBe('Set up project structure');
  });

  it('parses split format (### TASK-001 + **Title**: ...)', () => {
    const tasks = parseTaskBreakdown(SPLIT_FORMAT);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe('TASK-001');
    expect(tasks[0].title).toBe('Set up project structure');
  });

  it('parses mixed document with both formats', () => {
    const tasks = parseTaskBreakdown(MIXED_FORMAT);
    expect(tasks).toHaveLength(2);
    expect(tasks[0].id).toBe('TASK-001');
    expect(tasks[0].title).toBe('Set up project structure');
    expect(tasks[1].id).toBe('TASK-002');
    expect(tasks[1].title).toBe('Implement core feature');
  });

  it('extracts type, complexity, dependencies, and files', () => {
    const tasks = parseTaskBreakdown(INLINE_FORMAT);
    const task = tasks[0];
    expect(task.type).toBe('infrastructure');
    expect(task.complexity).toBe('low');
    expect(task.filesAffected).toContain('package.json');
    expect(task.filesAffected).toContain('tsconfig.json');
  });

  it('extracts acceptance criteria', () => {
    const tasks = parseTaskBreakdown(INLINE_FORMAT);
    expect(tasks[0].acceptanceCriteria).toHaveLength(2);
    expect(tasks[0].acceptanceCriteria[0]).toContain('Project builds');
  });

  it('filters dependencies to TASK-* format', () => {
    const tasks = parseTaskBreakdown(MIXED_FORMAT);
    expect(tasks[0].dependencies).toHaveLength(0); // "None" filtered out
    expect(tasks[1].dependencies).toEqual(['TASK-001']);
  });

  it('extracts parallel tasks', () => {
    const tasks = parseTaskBreakdown(MIXED_FORMAT);
    expect(tasks[0].canRunInParallelWith).toEqual(['TASK-002']);
    expect(tasks[1].canRunInParallelWith).toHaveLength(0);
  });

  it('returns empty array for empty input', () => {
    expect(parseTaskBreakdown('')).toEqual([]);
    expect(parseTaskBreakdown('# No tasks here\nJust some text.')).toEqual([]);
  });

  it('assigns correct agent based on type', () => {
    const tasks = parseTaskBreakdown(INLINE_FORMAT);
    expect(tasks[0].assignedAgent).toBe('infrastructure-engineer');
  });

  it('falls back to task ID as title when no title is found', () => {
    const noTitle = `### TASK-001\n\n**Type**: implementation\n**Complexity**: medium\n`;
    const tasks = parseTaskBreakdown(noTitle);
    expect(tasks[0].title).toBe('TASK-001');
  });
});
