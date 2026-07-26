# Specialist Agents

MLST ships 7 specialized agents. Each is defined by a markdown file in `packages/mlst-pi/agents/`. The orchestrator selects the right agent(s) for each phase of a sprint.

| Agent | Role |
|---|---|
| `mlst-spec-writer` | Transforms ideas into detailed specifications |
| `mlst-scrum-master` | Breaks specs into atomic tasks with acceptance criteria |
| `mlst-test-runner` | Writes failing tests from acceptance criteria (TDD RED phase) |
| `mlst-impl-engineer` | Writes code to make failing tests pass (TDD GREEN phase) |
| `mlst-code-reviewer` | Reviews code and approves or rejects |
| `mlst-designer` | Creates UI/UX design specifications for design tasks |
| `mlst-infra-engineer` | Sets up infrastructure, CI/CD, and deployment config |

---

## `mlst-spec-writer`

**Role:** Transforms a high-level idea into a structured specification that downstream agents can act on.

**When it runs:**
- Phase 1 of every sprint — before task breakdown
- When the initial prompt is ambiguous and clarification is needed

**What it does:**
1. Reads the idea or feature description
2. Asks clarifying questions when technology stack, scale, or business rules are unclear (outputs `CLARIFICATION_NEEDED:` markers for the orchestrator to relay)
3. Produces a specification with: Overview, Requirements, Technical Specifications, Implementation Steps, Dependencies, Testing Strategy, Edge Cases, Success Criteria, and Assumptions Made
4. Writes acceptance criteria as testable assertions (downstream agents use TDD)

**Tools available:** `read`, `grep`, `find`, `ls`

---

## `mlst-scrum-master`

**Role:** Breaks a specification into atomic, independently-mergeable tasks.

**When it runs:**
- Phase 2 of every sprint — after `mlst-spec-writer` produces the spec

**What it does:**
1. Reads the specification thoroughly
2. Decomposes the work into tasks: one endpoint, one function, or one logical unit per task
3. Assigns each task an ID (e.g., `TASK-001`), title, type, description, acceptance criteria, complexity, dependencies, and parallel-execution hints
4. Produces a markdown task list with an overview, task summary, parallel execution groups, and critical path

**Task types:** `Implementation`, `Testing`, `Documentation`, `Infrastructure`, `Deployment`, `Design`

**Tools available:** `read`, `grep`, `find`, `ls`

---

## `mlst-test-runner`

**Role:** Writes failing tests from acceptance criteria — the RED phase of TDD.

**When it runs:**
- Before `mlst-impl-engineer` for each implementation task
- After `mlst-impl-engineer` to validate GREEN (all tests pass)
- After review fixes to check for regressions

**What it does:**
1. Reads the acceptance criteria for the task
2. Reads existing code to understand project structure and test framework
3. Writes one test per acceptance criterion; test names read as sentences
4. Runs the tests and confirms they **fail** (no implementation yet)
5. Returns test file paths and failure summary for the implementation engineer

**Test levels:** unit tests for domain logic, integration tests for component boundaries, E2E only when the acceptance criteria explicitly require it.

**Tools available:** `read`, `write`, `bash`, `grep`, `find`, `ls`

---

## `mlst-impl-engineer`

**Role:** Makes failing tests pass — the GREEN phase of TDD.

**When it runs:**
- After `mlst-test-runner` has written failing tests for a task
- After `mlst-code-reviewer` rejects and lists required fixes

**What it does:**
1. Reads the failing tests to understand the expected behavior
2. Writes the minimum code to make the tests pass
3. Runs the tests and verifies GREEN; refactors if needed without changing behavior
4. Reads `AGENTS.md` (project root) for project-specific conventions and coding guidelines
5. Lists files created or modified — the orchestrator handles commits

**Constraints:** Does not implement behavior that no test verifies. Does not run `rm -rf`, `git reset --hard`, or wildcard deletes.

**Tools available:** `read`, `edit`, `write`, `bash`, `grep`, `find`, `ls`

---

## `mlst-code-reviewer`

**Role:** Reviews implemented code against acceptance criteria and approves or rejects.

**When it runs:**
- After `mlst-test-runner` confirms GREEN for a task

**What it does:**
1. Checks that the code satisfies the acceptance criteria
2. Verifies tests exist and pass
3. Looks for bugs and security vulnerabilities (hardcoded secrets, injection, XSS)
4. Outputs `APPROVED` or `REJECTED` with a brief reason

**Approves if:** the code works, tests pass, no bugs or security issues — regardless of style preferences or alternative approaches.

**Rejects only for:** bugs causing incorrect behavior, security vulnerabilities, missing or failing tests, spec violations.

**Tools available:** `read`, `grep`, `find`, `ls`, `bash`

---

## `mlst-designer`

**Role:** Creates UI/UX design specifications in markdown for implementation agents.

**When it runs:**
- For tasks with `Type: Design` or `Needs Design: Yes` in the task breakdown

**What it does:**
1. Analyzes the design requirements for the task
2. Checks for an existing design system (tokens, style guides, component libraries)
3. Produces a design specification covering: layout, components, colors (hex values), typography, spacing, interactions, responsive breakpoints, and accessibility requirements
4. Ensures WCAG AA compliance (4.5:1 contrast for normal text), keyboard navigation, and touch targets ≥ 44×44 px

**Tools available:** `read`, `write`, `grep`, `find`, `ls`

---

## `mlst-infra-engineer`

**Role:** Sets up infrastructure, CI/CD pipelines, deployment configurations, and development environments.

**When it runs:**
- For tasks with `Type: Infrastructure` or `Type: Deployment` in the task breakdown

**What it does:**
1. Reads and understands the infrastructure requirements (platform, dependencies, environments)
2. Creates infrastructure-as-code: Dockerfiles, docker-compose, CI/CD configs (e.g., GitHub Actions), env management
3. Sets up build, test automation, and deployment pipelines
4. Documents all infrastructure decisions
5. Lists files created or modified — the orchestrator handles commits

**Security defaults:** no hardcoded secrets, least privilege, documented secret rotation.

**Tools available:** `read`, `edit`, `write`, `bash`, `grep`, `find`, `ls`

---

## Agent Coordination

Agents run in a defined order each sprint:

1. **Phase 1 — Specification** → `mlst-spec-writer` produces the spec
2. **Phase 2 — Task Breakdown** → `mlst-scrum-master` produces the task list
3. **Phase 3 — Implementation** (per task, in TDD loop):
   - `mlst-designer` runs first for design tasks
   - `mlst-infra-engineer` runs first for infrastructure tasks
   - `mlst-test-runner` writes failing tests (RED)
   - `mlst-impl-engineer` makes tests pass (GREEN)
   - `mlst-code-reviewer` approves or rejects; loop repeats up to `executionProfile.maxReviewIterations` times

Each agent's output feeds directly into the next, creating a traceable chain from idea → spec → tasks → tests → code → review.

## Next Steps

- Learn about [Orchestration](./orchestration.md) to understand how agents coordinate
- [Customize agents](./customization.md) for your team's needs
- See [Debugging](./debugging.md) for troubleshooting failed builds
