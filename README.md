# My Little Scrum Team

A Claude Code plugin providing a collection of AI agents and skills that work together as a coordinated scrum team.

## Installation

### From Plugin Marketplace

```
/plugin install mlst
```

### From GitHub

```
/plugin install https://github.com/lexicalninja/my-little-scrum-team
```

### Local Development

```bash
claude --plugin-dir ./path-to-this-repo
```

## Overview

This plugin provides a complete development team of AI agents to help build things together. The team is designed for autonomous execution with quality gates - agents will stop and ask for clarification when requirements are unclear.

## Repository Layout

The Claude Code plugin lives at the repo root. The same agents and skills also
back a standalone CLI:

```
.claude-plugin/      Plugin manifest and marketplace entry
agents/              Agent definitions (7)
skills/              Skill definitions (40) — shared, single source of truth
commands/            Slash commands (/build, /convert-to-extension)
templates/           Specification, task breakdown, decision record, scaffold
packages/mlst-app/    Standalone CLI + MCP server (see its README)
packages/mlst-pi/     pi.dev harness extension (see its README)
packages/mlst-vscode/ VS Code Copilot Chat participant (see its README)
```

`skills/` and `templates/` are deliberately not duplicated inside the packages —
both resolve them from the repo root at runtime. See `CLAUDE.md` for why the
agent prompts intentionally differ between surfaces.

## Architecture

The `/build` command runs in the main conversation context and acts as the orchestrator, spawning specialist agents directly:

```
                    [User/Epic]
                         │
                         ▼
                ┌─────────────────┐
                │  /build command │  ← Orchestrator (main context)
                │  (classifies    │
                │   input, runs   │
                │   quality gates)│
                └────────┬────────┘
                         │
                         ▼
                   ┌───────────┐
                   │   Idea    │  ← Collaborative refinement
                   │  Refiner  │    (Questions → Approaches → Agreement)
                   └─────┬─────┘
                         │
                         ▼ (Decision Record Saved)
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
┌─────────────────┐ ┌─────────────┐ ┌─────────────┐
│ Specification   │ │   Scrum     │ │  Execution  │
│ Writer          │→│   Master    │→│   Agents    │
└─────────────────┘ └─────────────┘ └─────────────┘
                                           │
                    ┌──────────────────────┼──────────────────────┐
                    ▼                      ▼                      ▼
             ┌─────────────┐        ┌─────────────┐        ┌─────────────┐
             │  UI/UX      │        │   Infra     │        │   Impl      │
             │  Designer   │        │  Engineer   │        │  Engineer   │
             └─────────────┘        └─────────────┘        └──────┬──────┘
                                                                  │
                                                                  ▼
                                                           ┌─────────────┐
                                                           │ Test-Runner │
                                                           └──────┬──────┘
                                                                  │
                                                                  ▼
                                                           ┌─────────────┐
                                                           │Code-Reviewer│
                                                           └─────────────┘
```

- **/build command** → Orchestrator running in the main conversation. Classifies input, runs quality gates, spawns agents directly (1 hop)
- **Specification Writer** → Creates detailed specifications, asks clarifying questions when requirements are unclear
- **Scrum Master** → Breaks specifications into atomic tasks with dependencies
- **UI/UX Designer** → Picks up Design tasks and adds design specifications
- **Infrastructure Engineer** → Handles Infrastructure and Deployment tasks
- **Implementation Engineer** → Implements tasks from specifications
- **Test-Runner** → Writes and runs tests, validates implementations before review
- **Code Reviewer Feedback** → Reviews code and provides structured feedback

## Available Agents

All agents are located in `agents/` and can be invoked explicitly or used automatically by Claude.

### 📋 Specification Writer
**File:** `agents/specification-writer.md`

Transforms ideas into detailed specifications and implementation directions. Asks clarifying questions when requirements are ambiguous - does not proceed with unclear requirements.

**Skills Used:** requirement-analyzer, technical-spec-writer

**Usage:**
```
/my-little-scrum-team:specification-writer turn this idea into a detailed spec: "build a user dashboard"
```

### 📊 Scrum Master
**File:** `agents/scrum-master.md`

Reviews specification documents and breaks them down into atomic, modular tasks. Creates task lists with dependencies, parallel execution opportunities, and build-safe implementation strategies.

**Skills Used:** implementation-planner

**Usage:**
```
/my-little-scrum-team:scrum-master break down this specification into tasks: [specification document]
```

### 🎨 UI/UX Designer
**File:** `agents/ui-ux-designer.md`

Accepts design-focused tasks and adds comprehensive design specifications. Creates markdown design specs, considers accessibility and responsive design.

**Skills Used:** layout-designer, component-designer, color-system-designer, typography-designer, spacing-system-designer, interaction-designer, responsive-design-planner, accessibility-design-checker

**Usage:**
```
/my-little-scrum-team:ui-ux-designer add design specs to this task: [task document]
```

### 🏗️ Infrastructure Engineer
**File:** `agents/infrastructure-engineer.md`

Sets up infrastructure, CI/CD pipelines, deployment configurations, and development environments. Handles infrastructure-as-code, automation, and deployment readiness.

**Skills Used:** config-setup, security-scanner, git-commit-helper

**Usage:**
```
/my-little-scrum-team:infrastructure-engineer set up CI/CD pipeline for this project
```

### 👷 Implementation Engineer
**File:** `agents/implementation-engineer.md`

Implements tasks from scrum-master, submits to test-runner for validation, then to code-reviewer-feedback for review. Iterates on feedback until approved, then commits changes.

**Skills Used:** api-implementer, database-implementer, component-implementer, utility-implementer, config-setup, git-commit-helper, changelog-generator, code-documentation, import-formatter

**Usage:**
```
/my-little-scrum-team:implementation-engineer implement TASK-010 from tasks-dog-webpage.md
```

### 🧪 Test-Runner
**File:** `agents/test-runner.md`

Writes and runs tests for implementations. Tests must pass before code proceeds to review. Can be invoked automatically after implementation or on-demand for regression testing.

**Skills Used:** test-writer

**Usage:**
```
/my-little-scrum-team:test-runner validate implementation for TASK-010
/my-little-scrum-team:test-runner run full test suite
```

### 🔍 Code Reviewer Feedback
**File:** `agents/code-reviewer-feedback.md`

Reviews code and provides structured feedback documents. Pre-categorizes issues as Must-Fix, Should-Fix, Nice-to-Have, Out-of-Scope, or Needs-Discussion. Creates actionable feedback with file paths, line numbers, and code examples.

**Skills Used:** bug-detector, security-scanner, specification-checker, code-style-analyzer, performance-analyzer, accessibility-checker, architecture-reviewer, best-practices-checker

**Usage:**
```
/my-little-scrum-team:code-reviewer-feedback review the latest changes
```

## How to Use

### Automatic Orchestration (Recommended)

Use `/mlst:build` to kick off the full workflow from idea to implementation:

```
/my-little-scrum-team:build build a user login page with email and password
/my-little-scrum-team:build the checkout button returns a 500 when cart is empty
/my-little-scrum-team:build here is my Q2 roadmap: [paste roadmap]
```

The `/build` command (running in the main conversation) classifies your request and orchestrates the appropriate path:

**For features and epics — full pipeline:**

**Phase 0: Collaborative Refinement (with you)**
1. Ask clarifying questions about your idea
2. Propose 2-4 approaches with tradeoffs
3. Get your input and reach agreement
4. Save a decision record to `decisions/`

**Phases 1-5: Autonomous Orchestration (hands-off)**
5. Create specification (specification-writer)
6. Break into tasks (scrum-master)
7. Hire new agents if capabilities are missing
8. Add design specs (ui-ux-designer)
9. Set up infrastructure (infrastructure-engineer)
10. Implement code (implementation-engineer)
11. Validate with tests (test-runner)
12. Review and iterate (code-reviewer-feedback)
13. Commit changes

**For bug fixes — fast path:**
Routes directly to implementation-engineer → test-runner → code-reviewer-feedback, skipping specification and task breakdown.

**Quality Gates:** The orchestrator checks quality at each phase boundary. Phase 0 ensures you and the team agree on direction before autonomous work begins.

### Explicit Invocation

Use the `/my-little-scrum-team:agent-name` syntax to invoke a specific agent:

```
/my-little-scrum-team:implementation-engineer implement the login form
/my-little-scrum-team:test-runner run tests for the authentication module
/my-little-scrum-team:code-reviewer-feedback review the authentication code
```

### Natural Language

You can also invoke agents naturally:

```
Have the test-runner agent validate the latest changes

Run the infrastructure engineer agent on the deployment setup
```

### Automatic Delegation

Claude Code will automatically use these agents when appropriate based on their descriptions.

## Available Skills

Skills are reusable, single-purpose capabilities. All skills are located in `skills/`.

### Specification & Planning Skills

| Skill | Description |
|-------|-------------|
| idea-refiner | Collaboratively refine ideas with user before autonomous execution. Asks questions, proposes approaches, reaches agreement. |
| requirement-analyzer | Extracts functional and non-functional requirements from ideas |
| technical-spec-writer | Creates detailed technical specifications |
| implementation-planner | Creates step-by-step implementation plans |

### Code Review Skills

| Skill | Description |
|-------|-------------|
| bug-detector | Detects bugs, logic errors, edge case issues |
| security-scanner | Scans for security vulnerabilities |
| specification-checker | Compares code against specifications |
| code-style-analyzer | Analyzes code style and formatting |
| performance-analyzer | Identifies performance issues |
| accessibility-checker | Checks for accessibility issues |
| architecture-reviewer | Reviews code architecture and design |
| best-practices-checker | Checks for best practice violations |

### Design Skills

| Skill | Description |
|-------|-------------|
| layout-designer | Designs page layouts and grid systems |
| component-designer | Designs reusable UI components |
| color-system-designer | Creates color palettes and systems |
| typography-designer | Designs typography systems |
| spacing-system-designer | Creates spacing and sizing systems |
| interaction-designer | Designs interactions and animations |
| responsive-design-planner | Plans responsive breakpoints |
| accessibility-design-checker | Ensures designs meet accessibility requirements |

### Implementation Skills

| Skill | Description |
|-------|-------------|
| api-implementer | Implements API endpoints and controllers |
| database-implementer | Creates database schemas and migrations |
| component-implementer | Implements UI components from design specs |
| utility-implementer | Implements utility functions and helpers |
| config-setup | Sets up configuration and environment |
| test-writer | Writes comprehensive test cases |

### Workflow Skills

| Skill | Description |
|-------|-------------|
| git-commit-helper | Generates well-structured commit messages |
| changelog-generator | Generates changelog entries |
| code-documentation | Generates code documentation |
| import-formatter | Formats and organizes imports |
| convert-to-extension | Converts a Claude Code plugin into a VS Code Chat Extension |

### Team Coordination Skills

| Skill | Description |
|-------|-------------|
| resource-allocation-optimizer | Prioritizes tasks, allocates agents, optimizes resources |
| agent-capability-assessor | Evaluates if agents can handle tasks |
| task-to-agent-matcher | Matches tasks to appropriate agents |
| agent-creator | Creates new agent files |
| escalation-handler | Determines escalation paths |
| conflict-resolver | Resolves conflicts between agents |
| quality-gate-manager | Manages quality checkpoints |
| team-health-checker | Audits team structure and identifies issues |

## Available Commands

Commands are slash commands that delegate to the scrum team workflow. Located in `commands/`.

| Command | Description |
|---------|-------------|
| /build | **Primary entry point.** Start the scrum team workflow for any plan, epic, feature, or bug fix. |
| /convert-to-extension | Converts a Claude Code plugin into a VS Code Chat Extension using the full scrum team workflow. |

**Usage:**
```
/my-little-scrum-team:build add a password reset flow
/my-little-scrum-team:build the login button returns 500 when email is empty
/my-little-scrum-team:convert-to-extension plugins/my-little-scrum-team
```

## Creating Custom Agents

To create a new agent, add a markdown file to `agents/` with YAML frontmatter:

```markdown
---
name: my-agent
description: When to use this agent. Be specific!
model: inherit
---

Your agent instructions here...
```

### Configuration Fields

- `name`: Unique identifier (lowercase with hyphens)
- `description`: When to use this agent (Claude reads this for delegation)
- `model`: `fast`, `inherit`, or specific model ID (defaults to `inherit`)

## Creating Custom Skills

To create a new skill, create a folder in `skills/` with a `SKILL.md` file:

```markdown
---
name: my-skill
description: What this skill does and when to use it.
---

# My Skill

## Instructions

1. Step-by-step instructions
2. What the skill should do

## Examples

**Input:** "Example request"
**Output:** "Example result"
```

## Requirements

- Claude Code version 1.0.33 or later

To check your version:
```bash
claude --version
```
