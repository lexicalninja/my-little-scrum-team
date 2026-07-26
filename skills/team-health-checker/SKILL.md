---
name: team-health-checker
description: Audits the scrum team structure by analyzing all agents and skills. Identifies coverage gaps, overlapping responsibilities, workflow issues, and skill utilization problems. Use when you need to review and improve team efficiency, validate team structure, or diagnose operational issues.
---

# Team Health Checker Skill

## Overview

This skill performs a comprehensive audit of the scrum team by analyzing:
- Agent definitions and responsibilities
- Skill definitions and usage
- Workflow handoffs between agents
- Coverage gaps and redundancies

## Instructions

1. Read all agent files from the agents/ directory
2. Read all skill files from the skills/ directory
3. Map agent-to-skill relationships
4. Analyze workflow handoffs between agents
5. Identify coverage gaps
6. Find overlapping responsibilities
7. Check for orphaned or underutilized skills
8. Produce structured health report with recommendations

## Analysis Areas

### 1. Agent Coverage Analysis
- What task types can each agent handle?
- Are there task types with no agent coverage?
- Are there task types with multiple agents (potential conflict)?

### 2. Skill Utilization Analysis
- Which skills are referenced by agents?
- Which skills are never referenced (orphaned)?
- Which skills are overloaded (used by many agents)?

### 3. Workflow Analysis
- How do agents hand off work to each other?
- Are there broken handoffs (Agent A expects Agent B, but B doesn't exist)?
- Are there circular dependencies?
- Are handoff points clearly defined?

### 4. Responsibility Analysis
- Do agents have clear, non-overlapping responsibilities?
- Are there gaps where no agent owns a responsibility?
- Are there conflicts where multiple agents claim same responsibility?

### 5. Skill-Agent Alignment
- Do agents reference skills that exist?
- Do skills match agent capabilities?
- Are there capability gaps?

## Health Check Process

### Step 1: Inventory
```
1. List all agents from agents/ directory
2. List all skills from skills/ directory
3. Create agent → skills mapping
4. Create skill → agents mapping (reverse)
```

### Step 2: Coverage Analysis
```
For each agent:
  - Extract task types it handles
  - Extract skills it uses
  - Note workflow inputs/outputs

For each skill:
  - Note which agents reference it
  - Flag if unreferenced (orphaned)
```

### Step 3: Workflow Analysis
```
For each agent:
  - Identify upstream agents (who sends work to this agent)
  - Identify downstream agents (who receives work from this agent)
  - Check if handoff points are clear
  - Flag broken handoffs
```

### Step 4: Gap Analysis
```
Identify:
  - Task types with no agent coverage
  - Skills with no agent usage
  - Workflow dead ends
  - Missing handoff definitions
```

### Step 5: Redundancy Analysis
```
Identify:
  - Overlapping agent responsibilities
  - Duplicate skill functionality
  - Conflicting workflow paths
```

## Output Format

```markdown
# Team Health Report

## Summary
- **Agents**: X total
- **Skills**: X total
- **Health Score**: X/100
- **Critical Issues**: X
- **Warnings**: X
- **Suggestions**: X

## Agent Inventory

| Agent | Primary Role | Skills Used | Upstream | Downstream |
|-------|--------------|-------------|----------|------------|
| agent-1 | Role | 5 skills | agent-0 | agent-2 |

## Skill Inventory

| Skill | Used By | Status |
|-------|---------|--------|
| skill-1 | agent-1, agent-2 | Active |
| skill-2 | (none) | Orphaned |

## Coverage Analysis

### Well-Covered Areas
- [Area]: Handled by [agents]

### Coverage Gaps
- [Gap]: No agent handles [task type]

### Over-Coverage (Potential Conflicts)
- [Area]: Multiple agents ([list]) claim this responsibility

## Workflow Analysis

### Workflow Diagram
```
[Agent A] → [Agent B] → [Agent C]
              ↓
          [Agent D]
```

### Healthy Handoffs
- [Agent A] → [Agent B]: Clear handoff via [mechanism]

### Broken Handoffs
- [Agent X] expects [Agent Y] but handoff undefined

### Dead Ends
- [Agent Z] has no downstream - work may get stuck

## Skill Utilization

### Well-Utilized Skills
- [skill]: Used by X agents appropriately

### Orphaned Skills (Never Used)
- [skill]: Not referenced by any agent

### Overloaded Skills (Used Too Broadly)
- [skill]: Used by X agents - may need specialization

## Issues

### Critical (Must Fix)
1. **[Issue]**: [Description]
   - **Impact**: [What breaks]
   - **Fix**: [Recommendation]

### Warnings (Should Fix)
1. **[Issue]**: [Description]
   - **Impact**: [What's affected]
   - **Fix**: [Recommendation]

### Suggestions (Nice to Have)
1. **[Suggestion]**: [Description]
   - **Benefit**: [Improvement]

## Recommendations

### Immediate Actions
1. [Action]: [Why and how]

### Short-Term Improvements
1. [Improvement]: [Why and how]

### Long-Term Considerations
1. [Consideration]: [Why and how]
```

## Health Score Calculation

The health score (0-100) is calculated based on:

| Factor | Weight | Scoring |
|--------|--------|---------|
| Agent coverage | 25% | -10 per gap, -5 per conflict |
| Skill utilization | 20% | -5 per orphaned skill |
| Workflow integrity | 25% | -15 per broken handoff, -10 per dead end |
| Responsibility clarity | 15% | -10 per overlap, -10 per gap |
| Documentation quality | 15% | -5 per unclear agent/skill |

### Score Interpretation
- **90-100**: Excellent - Team is well-structured
- **75-89**: Good - Minor issues to address
- **60-74**: Fair - Several issues need attention
- **40-59**: Poor - Significant structural problems
- **0-39**: Critical - Team needs major restructuring

## Common Issues and Fixes

### Issue: Orphaned Skills
**Symptom**: Skills that no agent references
**Cause**: Skills created but never integrated, or agents updated without updating skill references
**Fix**: Either integrate skill into appropriate agent or delete if truly unused

### Issue: Broken Handoffs
**Symptom**: Agent A sends work to Agent B, but B doesn't know to receive it
**Cause**: Asymmetric workflow definitions
**Fix**: Update receiving agent to acknowledge upstream handoff

### Issue: Responsibility Overlap
**Symptom**: Multiple agents claim same task type
**Cause**: Unclear boundaries, organic growth without coordination
**Fix**: Clarify boundaries, designate primary owner, or merge agents

### Issue: Coverage Gaps
**Symptom**: Task types with no agent owner
**Cause**: Missing agent, incomplete agent definition
**Fix**: Extend existing agent or create new specialized agent

### Issue: Workflow Dead Ends
**Symptom**: Agent produces output but no downstream consumer
**Cause**: Incomplete workflow, missing integration
**Fix**: Add downstream agent or connect to existing workflow

## Example Report

```markdown
# Team Health Report

## Summary
- **Agents**: 8 total
- **Skills**: 36 total
- **Health Score**: 72/100
- **Critical Issues**: 1
- **Warnings**: 3
- **Suggestions**: 2

## Issues

### Critical (Must Fix)
1. **Broken handoff: scrum-master → implementation-engineer**
   - **Impact**: Tasks created by scrum-master may not reach implementation-engineer
   - **Fix**: Add explicit task pickup mechanism to implementation-engineer

### Warnings (Should Fix)
1. **Orphaned skill: changelog-generator**
   - **Impact**: Skill exists but no agent uses it
   - **Fix**: Add to implementation-engineer post-commit workflow or delete

2. **Responsibility overlap: infrastructure-engineer and implementation-engineer**
   - **Impact**: Both claim database work, unclear who handles it
   - **Fix**: Clarify boundaries - infrastructure-engineer owns schema, implementation-engineer owns queries

3. **No agent handles documentation tasks**
   - **Impact**: Documentation tasks have no owner
   - **Fix**: Add documentation responsibility to existing agent or create documentation-writer

### Suggestions (Nice to Have)
1. **Consider adding test-runner agent**
   - **Benefit**: Separates test execution from implementation

2. **Consolidate design skills under ui-ux-designer**
   - **Benefit**: Clearer ownership of design-related skills
```

## Best Practices

- **Run Regularly**: Check team health after adding/modifying agents
- **Fix Critical First**: Address critical issues before warnings
- **Document Changes**: Update agents/skills after fixes
- **Validate Fixes**: Re-run health check after fixes
- **Track Trends**: Compare health scores over time
