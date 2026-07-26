# Orchestration

The **Orchestrator** manages the specialist team. It decides:
- Which agents to use
- What order to run them
- How to handle failures
- When to complete

## Agent Reference

The following agents are used during a build. These names appear in logs and configuration:

| Agent | Role |
|---|---|
| `mlst-spec-writer` | Transforms ideas into detailed specifications |
| `mlst-scrum-master` | Breaks specs into atomic tasks with acceptance criteria |
| `mlst-impl-engineer` | Writes code to make failing tests pass (TDD GREEN phase) |
| `mlst-test-runner` | Writes failing tests from acceptance criteria (TDD RED phase) |
| `mlst-code-reviewer` | Reviews code and approves or rejects |
| `mlst-designer` | Creates UI/UX design specifications for design tasks |
| `mlst-infra-engineer` | Sets up infrastructure, CI/CD, and deployment config |

## Decision Tree

```
START
  ↓
mlst-spec-writer analyzes & writes specification
  ↓
mlst-scrum-master breaks spec into tasks
  ↓
For each task (by type):
  Design task   → mlst-designer writes design spec
  Infra task    → mlst-infra-engineer creates config
  Other tasks   → mlst-test-runner writes failing tests (RED)
                    ↓
                  mlst-impl-engineer makes tests pass (GREEN)
                    ↓
                  Tests pass? → No → mlst-impl-engineer retries (up to maxTestRetries)
                    ↓
                  mlst-code-reviewer reviews code
                    ↓
                  Approved? → No → mlst-impl-engineer fixes (up to maxReviewIterations)
                    ↓
                  Yes
  ↓
Orchestrator writes sprint summary → COMPLETE ✅
```

## Phase Breakdown

### Phase 0: Idea Refinement (Optional)
- **When:** Input is vague (e.g., "add auth") and `enablePhase0` is true
- **Who:** Orchestrator LLM (idea-refiner skill)
- **Output:** Clarified requirements or a list of questions
- **Duration:** 1-3 minutes
- **Cost:** 1-2 API calls

### Phase 1: Specification
- **When:** Always (unless input comes from `/prd`)
- **Who:** `mlst-spec-writer`
- **Output:** Detailed project specification
- **Duration:** 5-15 minutes
- **Cost:** 3-6 API calls

### Phase 2: Task Breakdown
- **When:** Always
- **Who:** `mlst-scrum-master`
- **Output:** Atomic tasks with ids, titles, types, and acceptance criteria
- **Duration:** 2-5 minutes
- **Cost:** 2-4 API calls

### Phase 3: Implementation
- **When:** Always (unless `pipelineMode: "review-only"`)
- **Who:** `mlst-test-runner`, `mlst-impl-engineer`, `mlst-code-reviewer`, `mlst-designer`, `mlst-infra-engineer`
- **Output:** Working code with tests
- **Duration:** 10-60 minutes
- **Cost:** 5-20 API calls

### Phase 4: Completion
- **When:** Always
- **Who:** Orchestrator
- **Output:** Sprint summary persisted to SQLite
- **Duration:** < 1 minute
- **Cost:** Included in Phase 3

## Optimization Strategies

### 1. Parallel Execution

When multiple tasks are independent, the orchestrator runs agents in parallel:

```
Requirement:
  Build user and post modules

Agents run in parallel:
  - mlst-test-runner:    User module tests (RED)
  - mlst-test-runner:    Post module tests (RED)
  - mlst-impl-engineer:  User module (GREEN)
  - mlst-impl-engineer:  Post module (GREEN)

Time saved: ~40%
Cost multiplier: 2x (parallel calls)
```

### 2. Caching

Reuse analysis when requirements change slightly:

```
First build:
  mlst-spec-writer writes spec (2 calls)
  mlst-scrum-master breaks down tasks (3 calls)
  Total: 5 calls

Second build (small change):
  Use /build --resume to continue from existing sprint state
  Total: 0 calls for completed tasks (only re-runs incomplete tasks)

Cost saved: varies by how many tasks are already complete
```

### 3. Incremental Testing

Test as code is written, not after:

```
Traditional:
  Write all code (50k tokens)
  Test all code (30k tokens)
  Total: 80k tokens

Incremental:
  Write component A (10k) → Test (8k)
  Write component B (10k) → Test (8k)
  Write component C (10k) → Test (8k)
  Integration test (10k)
  Total: 64k tokens (20% savings)
```

## Human Gates

Pause the pipeline for human approval:

```json
{
  "humanGates": ["post-spec", "post-tasks", "post-review"]
}
```

### Gate Points

- **post-spec** — Approve design before coding starts
- **post-tasks** — Approve task breakdown
- **post-design** — Approve architecture diagram
- **on-escalation** — Task hit max retries (automatic escalation)
- **post-review** — Final approval before merge

## Pipeline Modes

### Full Pipeline (Default)
Runs all phases: Planning → Design → Code → Test → Docs → Review

```json
{
  "pipelineMode": "full"
}
```

**Cost:** Highest | **Time:** Longest | **Quality:** Highest

### Gated Pipeline
Runs all phases but pauses at human gates:

```json
{
  "pipelineMode": "gated",
  "humanGates": ["post-spec", "post-tasks"]
}
```

**Cost:** Highest | **Time:** Longest (with pauses) | **Quality:** Highest (with oversight)

### Review-Only Pipeline
Stops after planning, no implementation:

```json
{
  "pipelineMode": "review-only"
}
```

**Cost:** Lowest | **Time:** Shortest | **Quality:** Planning only

## Performance Tips

✅ Use `group1Concurrency: 4` and `group2Concurrency: 4` for balance
✅ Use `/build --resume` to continue interrupted sprints without re-running completed tasks
✅ Use incremental testing for large features
✅ Set human gates for critical decisions
✅ Monitor costs with `/mlst-status`

❌ Don't use too high concurrency (API rate limits)
❌ Don't disable reviews (quality matters)
❌ Don't skip testing (bugs cost more later)
❌ Don't ignore escalations (they need attention)

## Next Steps

- [Customize agents](./customization.md) for your team
- [Debug failures](./debugging.md) when things go wrong
- [Track costs](./cost-tracking.md) to manage budgets
