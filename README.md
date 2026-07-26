# My Little Scrum Team

A coordinated team of AI agents — specification writer, scrum master, implementation engineer, test runner, code reviewer, and more — that takes work from idea through specification, implementation, testing, and review.

The team ships as **four surfaces** that share one set of skills and templates:

| Surface | Runs in | Entry point | Docs |
|---|---|---|---|
| **Claude Code plugin** | Claude Code | `/mlst:build` | this README |
| **CLI + MCP server** | terminal, any MCP client | `mlst build` | [packages/mlst-app](packages/mlst-app/README.md) |
| **pi.dev extension** | [pi](https://pi.dev) | `/build` | [packages/mlst-pi](packages/mlst-pi/README.md) · [user guide](https://lexicalninja.github.io/my-little-scrum-team/mlst-pi/) |
| **VS Code extension** | Copilot Chat | `@mlst` | [packages/mlst-vscode](packages/mlst-vscode/README.md) |

The plugin lives at the repo root; the other surfaces live under `packages/`. `skills/` and `templates/` exist exactly once and feed every surface — see [CLAUDE.md](CLAUDE.md) for the architecture rules behind that, including why the agent prompts intentionally differ between surfaces.

## Installation (Claude Code plugin)

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

```
.claude-plugin/       Plugin manifest and marketplace entry
agents/               Agent definitions (7)
skills/               Skill definitions (40) — shared, single source of truth
commands/             Slash commands (/build, /convert-to-extension)
templates/            Specification, task breakdown, decision record, scaffold
packages/mlst-app/    Standalone CLI + MCP server (see its README)
packages/mlst-pi/     pi.dev harness extension (see its README)
packages/mlst-vscode/ VS Code Copilot Chat participant (see its README)
```

`skills/` and `templates/` are deliberately not duplicated inside the packages —
they resolve from the repo root at runtime (the VS Code extension stages a copy
at build time, since extensions can only read their own directory).

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

## The Agents

All seven live in `agents/`, defined as markdown with YAML frontmatter. Each
agent's file lists the skills it uses, so the files are the source of truth —
this table is just the map.

| Agent | File | Role |
|---|---|---|
| Specification Writer | `agents/specification-writer.md` | Turns ideas into detailed specs; asks clarifying questions rather than guessing |
| Scrum Master | `agents/scrum-master.md` | Breaks specs into atomic tasks with dependencies and parallel-execution hints |
| UI/UX Designer | `agents/ui-ux-designer.md` | Adds design specifications to design-flagged tasks |
| Infrastructure Engineer | `agents/infrastructure-engineer.md` | CI/CD, deployment configuration, development environments |
| Implementation Engineer | `agents/implementation-engineer.md` | Implements tasks, iterates on review feedback, commits when approved |
| Test-Runner | `agents/test-runner.md` | Writes and runs tests; code doesn't reach review until they pass |
| Code Reviewer Feedback | `agents/code-reviewer-feedback.md` | Structured review with Must-Fix/Should-Fix/Nice-to-Have categorization |

## How to Use

### Automatic Orchestration (Recommended)

Use `/mlst:build` to kick off the full workflow from idea to implementation:

```
/mlst:build build a user login page with email and password
/mlst:build the checkout button returns a 500 when cart is empty
/mlst:build here is my Q2 roadmap: [paste roadmap]
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

### Working with individual agents

The agents aren't slash commands — Claude Code delegates to them automatically
based on their descriptions, or you can ask for one by name:

```
Have the test-runner agent validate the latest changes

Run the infrastructure engineer agent on the deployment setup
```

## Skills

The team's craft knowledge lives in `skills/` — 40 single-purpose skills, one
directory each, self-describing via `SKILL.md` frontmatter. They cover
specification and planning, code review, design, implementation, workflow, and
team coordination, and they're **shared by all four surfaces**: edit a skill
once and the plugin, CLI, pi extension, and VS Code extension all pick it up.

Browse them with `ls skills/`, or read any `skills/<name>/SKILL.md` — the
`description` field says when it applies.

## Available Commands

Commands are slash commands that delegate to the scrum team workflow. Located in `commands/`.

| Command | Description |
|---------|-------------|
| /build | **Primary entry point.** Start the scrum team workflow for any plan, epic, feature, or bug fix. |
| /convert-to-extension | Converts a Claude Code plugin into a VS Code Chat Extension using the full scrum team workflow. |

**Usage:**
```
/mlst:build add a password reset flow
/mlst:build the login button returns 500 when email is empty
/mlst:convert-to-extension .
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

> Skills are shared across every surface. A new skill is immediately available
> to the plugin; to expose it to the CLI or pi agents, also map it in their
> registries (`packages/mlst-app/src/skills/registry.ts`, `AGENT_SKILLS` in
> `packages/mlst-pi/.pi/extensions/mlst/types.ts`).

## Requirements

- Claude Code version 1.0.33 or later

To check your version:
```bash
claude --version
```
