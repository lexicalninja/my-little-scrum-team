# Build Phases

`/build` runs through five phases, each with specific goals and agents.

## Phase 0: Idea Refinement (1–3 min)

**Goal:** Is the requirement clear enough to proceed?

**What happens:**
- Classify input: feature, bug, epic, refactor, etc.
- Quick evaluation: Are requirements specific enough?
- If too vague, ask clarifying questions

**Agents:** None (orchestrator uses direct LLM calls)

**Output:** Classification and clarity score

---

## Phase 1: Specification (15–30 sec)

**Goal:** Write a detailed, unambiguous specification.

**What happens:**
- **mlst-spec-writer** reads codebase (find + grep)
- Writes specification with:
  - User flows / API endpoints
  - Database schema changes
  - UI/UX requirements
  - Edge cases and error handling
  - Security considerations
- Quality gate: **spec-completeness** — Heuristic, prompt-driven check for core sections: overview, requirements, technical approach, and acceptance criteria.

**Tools available:** read, grep, find, ls (read-only)

**Output:** Specification document

---

## Phase 2: Task Breakdown (10–20 sec)

**Goal:** Convert spec into atomic, ordered tasks.

**What happens:**
- **mlst-scrum-master** reads specification
- Breaks into tasks with:
  - Task ID (TASK-001, TASK-002, ...)
  - Task type (database, backend, frontend, test, infra, etc.)
  - Description
  - Acceptance criteria
  - Dependencies on other tasks
- Quality gate: **task-breakdown** — Are IDs valid? Do tasks have criteria?

**Tools available:** read, grep, find, ls (read-only)

**Output:** Structured task list (JSON)

---

## Phase 2.5: Scaffolding (optional, 30–60 sec)

**Goal:** On greenfield projects, initialize the full tech stack end-to-end.

**What happens (greenfield only):**
- Detect: are there any source files? If not, scaffold.
- **mlst-impl-engineer** runs:
  - Initialize project structure
  - Install dependencies
  - Create health check endpoint
  - Wire up real database driver
  - Run integration test proving it all works
- Cache invalidated: subsequent agents see new files

**Skipped if:** Source files already exist

**Tools available:** read, edit, write, bash, grep, find, ls

**Output:** Working project skeleton with passing health check

---

## Phase 3: Implementation (1–10 min per task)

**Goal:** Implement tasks in TDD cycle with code review.

**What happens (per task):**

1. **RED** (test-runner)
   - Write failing test from acceptance criteria
   - Run tests → RED (intentional failure)

2. **GREEN** (impl-engineer)
   - Implement code to make tests pass
   - Run tests → GREEN (all pass)
   - Run linter → no errors

3. **REVIEW** (code-reviewer)
   - Review code against acceptance criteria
   - Check for bugs, security issues, spec violations
   - Approve or request changes

4. **Iterate?** (orchestrator)
   - If tests fail: retry impl-engineer, up to `executionProfile.maxTestRetries` times (cloud default: 3, local default: 2)
   - If review rejected: retry impl-engineer, up to `executionProfile.maxReviewIterations` times (cloud default: 3, local default: 1)
   - If approved: move to next task
   - Exceeding either limit escalates the task for human review

**Tools available:**
- test-runner: read, write, bash, grep, find, ls
- impl-engineer: read, edit, write, bash, grep, find, ls
- code-reviewer: read, grep, find, ls, bash

**Output:** Implemented, tested, and reviewed code

---

## Phase 4: Completion (5–10 sec)

**Goal:** Summarize the build and update the database.

**What happens:**
- Generate sprint summary (LLM)
- Update SQLite database (sprint complete, costs, run time)
- Log completion timestamp
- Dashboard shuts down

**Output:** Final summary, JSONL run log

---

## Phase Timing

Typical build for a medium feature:

| Phase | Time | Notes |
|-------|------|-------|
| Phase 0 | 1–3 min | Classification, clarity check |
| Phase 1 | 15–30 sec | Specification writing |
| Phase 2 | 10–20 sec | Task breakdown |
| Scaffolding | 30–60 sec | Only greenfield projects |
| Phase 3 | 1–10 min | Per-task implementation (TDD loop) |
| Phase 4 | 5–10 sec | Summary and completion |
| **Total** | **2–15 min** | Depends on feature complexity |

---

## Parallel Execution

Some phases run in parallel:

- **Phase 3:** If Phase 2 breaks tasks into independent subtasks, multiple impl-engineer agents can work simultaneously (up to concurrency limit)
- **Group 1** (between Phase 2 and 3): If needed, designer + infra-engineer + docs run in parallel

Concurrency depends on your model provider:
- Subscription/paid: 4 agents max
- Free-tier: 1 agent (throttled)
- Local: 2 agents max

---

## Next Steps

- **[Quality Gates](./gates.md)** — How validation checkpoints work
- **[Dashboard](./dashboard.md)** — Watch phase progress in real-time
- **[Advanced: Orchestration](../advanced/orchestration.md)** — Deep dive into orchestration logic
