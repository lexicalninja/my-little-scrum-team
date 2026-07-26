---
name: resource-allocation-optimizer
description: Comprehensive resource management that prioritizes tasks, allocates agents, and optimizes the allocation in a single pass. Use when you need to plan work execution, assign agents to tasks, or optimize resource usage. Combines task prioritization, agent allocation, and optimization into one unified workflow.
---

# Resource Allocation Optimizer Skill

## Overview

This skill combines three concerns into one unified workflow:
1. **Prioritize** tasks by dependencies, value, and urgency
2. **Allocate** agents to prioritized tasks based on capabilities
3. **Optimize** the allocation for efficiency and balance

## Instructions

1. Review all tasks and their characteristics
2. Prioritize tasks by dependencies, value, urgency, and risk
3. Inventory available agents and their capabilities
4. Allocate agents to prioritized tasks
5. Optimize the allocation for workload balance and efficiency
6. Create unified resource allocation plan

## Unified Workflow

### Phase 1: Task Prioritization

1. **Identify Dependencies**
   - Map task dependencies
   - Identify critical path
   - Note blocking tasks
   - Find parallel opportunities

2. **Assess Priority Factors**
   - Business value (High/Medium/Low)
   - Urgency (Critical/High/Medium/Low)
   - Risk (High/Medium/Low)
   - Dependency status (Blocking/Dependent/Independent)

3. **Assign Priority Levels**
   - **P0 - Critical**: Blocks other work, critical path, high value + high urgency
   - **P1 - High**: Important features, high value, should be done soon
   - **P2 - Medium**: Standard features, normal priority
   - **P3 - Low**: Nice-to-have, can be deferred

### Phase 2: Agent Allocation

1. **Inventory Agents**
   - List available agents
   - Note capabilities and specializations
   - Assess current workload

2. **Match Tasks to Agents**
   - Assign tasks to agents with matching capabilities
   - Prefer specialized agents for specialized tasks
   - Consider current workload

3. **Plan Execution Phases**
   - Group tasks by dependencies
   - Enable parallel execution where possible
   - Plan sequential phases as needed

### Phase 3: Optimization

1. **Balance Workload**
   - Distribute tasks evenly across agents
   - Avoid overloading single agents
   - Consider task complexity, not just count

2. **Reduce Inefficiencies**
   - Group related tasks for same agent
   - Minimize context switching
   - Identify bottlenecks

3. **Recommend Improvements**
   - Suggest new agents if needed
   - Recommend reallocation if priorities misaligned
   - Identify quick wins

## Output Format

```markdown
## Resource Allocation Plan

### Summary
- Total Tasks: X
- Agents Assigned: X
- Execution Phases: X
- Estimated Parallel Efficiency: X%

### Prioritized Tasks

#### P0 - Critical
- TASK-001: [description] - [rationale]

#### P1 - High
- TASK-002: [description] - [rationale]

#### P2 - Medium
- TASK-003: [description] - [rationale]

#### P3 - Low
- TASK-004: [description] - [rationale]

### Agent Assignments

#### [Agent Name]
- TASK-001: [description] (P0)
- TASK-002: [description] (P1)
- **Workload**: X tasks, [complexity level]

#### [Agent Name]
- TASK-003: [description] (P2)
- **Workload**: X tasks, [complexity level]

### Execution Phases

#### Phase 1: [Description]
**Tasks**: TASK-001, TASK-002
**Agents**: agent-1, agent-2
**Mode**: Parallel / Sequential
**Dependencies**: None / [list]

#### Phase 2: [Description]
**Tasks**: TASK-003
**Agents**: agent-3
**Mode**: Sequential
**Dependencies**: Phase 1

### Critical Path
[Sequential tasks that determine minimum completion time]

### Parallel Opportunities
[Tasks that can run simultaneously]

### Workload Distribution
| Agent | Tasks | Complexity | % of Total |
|-------|-------|------------|------------|
| agent-1 | 2 | Medium | 40% |
| agent-2 | 2 | High | 40% |
| agent-3 | 1 | Low | 20% |

### Optimization Notes

#### Issues Identified
- [Issue 1]: [Description and impact]

#### Recommendations
- [Recommendation 1]: [Action and benefit]

#### Bottlenecks
- [Bottleneck]: [Mitigation]
```

## Example

**Input**: Allocate 8 tasks across available agents

**Output**:
```markdown
## Resource Allocation Plan

### Summary
- Total Tasks: 8
- Agents Assigned: 4
- Execution Phases: 4
- Estimated Parallel Efficiency: 65%

### Prioritized Tasks

#### P0 - Critical
- TASK-001: Create specification - Blocks all other work
- TASK-002: Set up database schema - Blocks implementation

#### P1 - High
- TASK-003: Design user interface - Blocks frontend implementation
- TASK-004: Design API structure - Blocks backend implementation

#### P2 - Medium
- TASK-005: Implement backend API - Core functionality
- TASK-006: Implement frontend - User-facing

#### P3 - Low
- TASK-007: Add documentation - Can be done after implementation
- TASK-008: Performance optimization - Polish

### Agent Assignments

#### specification-writer
- TASK-001: Create specification (P0)
- **Workload**: 1 task, High complexity

#### ui-ux-designer
- TASK-003: Design user interface (P1)
- **Workload**: 1 task, Medium complexity

#### infrastructure-engineer
- TASK-002: Set up database schema (P0)
- TASK-004: Design API structure (P1)
- **Workload**: 2 tasks, Medium complexity

#### implementation-engineer
- TASK-005: Implement backend API (P2)
- TASK-006: Implement frontend (P2)
- TASK-007: Add documentation (P3)
- TASK-008: Performance optimization (P3)
- **Workload**: 4 tasks, High complexity

### Execution Phases

#### Phase 1: Foundation
**Tasks**: TASK-001
**Agents**: specification-writer
**Mode**: Sequential
**Dependencies**: None

#### Phase 2: Setup & Design
**Tasks**: TASK-002, TASK-003, TASK-004
**Agents**: infrastructure-engineer, ui-ux-designer
**Mode**: Parallel
**Dependencies**: TASK-001

#### Phase 3: Implementation
**Tasks**: TASK-005, TASK-006
**Agents**: implementation-engineer
**Mode**: Sequential (can parallelize with more agents)
**Dependencies**: TASK-002, TASK-003, TASK-004

#### Phase 4: Polish
**Tasks**: TASK-007, TASK-008
**Agents**: implementation-engineer
**Mode**: Parallel
**Dependencies**: TASK-005, TASK-006

### Critical Path
TASK-001 → TASK-002 → TASK-005 → TASK-007

### Parallel Opportunities
- Phase 2: TASK-002, TASK-003, TASK-004 can run in parallel
- Phase 4: TASK-007, TASK-008 can run in parallel

### Workload Distribution
| Agent | Tasks | Complexity | % of Total |
|-------|-------|------------|------------|
| specification-writer | 1 | High | 12.5% |
| ui-ux-designer | 1 | Medium | 12.5% |
| infrastructure-engineer | 2 | Medium | 25% |
| implementation-engineer | 4 | High | 50% |

### Optimization Notes

#### Issues Identified
- **Workload Imbalance**: implementation-engineer has 50% of tasks
- **Sequential Bottleneck**: Phase 3 implementation is sequential

#### Recommendations
- Consider hiring frontend-engineer to parallelize Phase 3
- Split implementation-engineer's P3 tasks to another agent if available
- Documentation (TASK-007) could be assigned to specification-writer

#### Bottlenecks
- implementation-engineer is on critical path with high workload
- Mitigation: Monitor closely, consider splitting work
```

## Priority Decision Matrix

| Dependencies | Value | Urgency | Priority |
|--------------|-------|---------|----------|
| Blocking | High | Critical | P0 |
| Blocking | High | High | P0 |
| Blocking | Medium | Any | P1 |
| None | High | Critical | P0 |
| None | High | High | P1 |
| None | Medium | Medium | P2 |
| None | Low | Low | P3 |
| Dependent | Any | Any | After dependency |

## Allocation Principles

1. **Capability Match**: Assign tasks to agents with matching skills
2. **Workload Balance**: Distribute work evenly (by complexity, not just count)
3. **Dependency Respect**: Never assign dependent tasks before dependencies
4. **Parallel Enable**: Assign independent tasks to different agents
5. **Context Minimize**: Group related tasks for same agent

## Optimization Strategies

1. **Workload Balancing**: Redistribute if one agent is overloaded
2. **Specialization**: Add specialized agents for specialized tasks
3. **Parallelization**: Split work to enable parallel execution
4. **Bottleneck Relief**: Add resources to critical path

## Best Practices

- **Single Pass**: Run all three phases together for consistency
- **Prioritize First**: Always prioritize before allocating
- **Balance Complexity**: Consider complexity, not just task count
- **Enable Parallelism**: Maximize parallel execution opportunities
- **Document Rationale**: Explain priority and allocation decisions
- **Monitor Bottlenecks**: Identify and address bottlenecks early
- **Stay Flexible**: Adjust as project evolves
