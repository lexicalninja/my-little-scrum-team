# Development Guide

This repo ships the same scrum team through three surfaces that share one set
of skills. Most of the confusing parts of this codebase follow from that, so
read this before changing agent prompts.

## Layout

```
agents/              Agent definitions for the Claude Code plugin (markdown)
skills/              Skill definitions (40) — SHARED, single source of truth
commands/            Slash commands (/build, /convert-to-extension)
templates/           SHARED: specification, task breakdown, decision record, scaffold
.claude-plugin/      Plugin manifest and marketplace entry
packages/mls-app/    Standalone CLI + MCP server (TypeScript)
packages/mls-pi/     pi.dev agent-harness extension (TypeScript)
packages/mls-vscode/ VS Code Copilot Chat participant (@mls)
```

`skills/` and `templates/` exist exactly once. `mls-app` and `mls-pi` resolve
them from the repo root at runtime — neither carries copies. See
`packages/mls-app/src/skills/loader.ts` and `resolveResourceDir` in
`packages/mls-pi/.pi/extensions/mls/index.ts`.

`mls-vscode` is the exception, and not by choice: a VS Code extension can only
read files inside its own directory, so `scripts/copy-resources.js` stages the
shared directories into a generated, gitignored `resources/` at build time. The
root is still the source of truth — nothing is edited in `resources/`.

Package-local agents are deliberately NOT shared. `mls-pi/agents/` uses `mls-*`
names and a `tools:` frontmatter field Claude Code doesn't have;
`mls-vscode/agents/team-lead.md` orchestrates via that extension's slash
commands, which exist nowhere else. Both are overlaid on the shared set.

## The three surfaces

| | Plugin (`agents/*.md`) | App (`mls-app`) | Pi (`mls-pi`) | VS Code (`mls-vscode`) |
|---|---|---|---|---|
| Runs in | Claude Code | Node CLI / MCP server | [pi.dev](https://pi.dev) harness | Copilot Chat |
| Orchestration | The agent, guided by its prompt | `src/orchestrator/phases.ts` | `.pi/extensions/mls/orchestrator/` | `team-lead` agent + `/run` phase detection |
| Skill delivery | Model-invoked by description | Always concatenated into the prompt | Always concatenated, via `AGENT_SKILLS` | Hand-picked per command |
| State | None | `src/state/` (JSON) | SQLite (`better-sqlite3`) | Workspace files (`decisions/`, `specs/`, `tasks/`) |

## Why the prompts differ (read before "fixing" them)

The markdown agents are much longer than their TypeScript counterparts —
`implementation-engineer` is 424 lines of markdown against ~45 lines of prompt
in TypeScript. **This is intentional. Do not unify them.**

Two independent reasons:

**1. Orchestration moved into code.** The plugin has no orchestrator, so its
prompts must tell the agent how to run the review loop, when to escalate, and
how to avoid repeating itself — see the "Code Review Cycle" and "Loop
Prevention" sections in `agents/implementation-engineer.md`. The app does all
of that deterministically in `src/orchestrator/phases.ts`, where the review
loop is a bounded `for` loop over `config.maxReviewIterations` that escalates
on exhaustion. Copying those instructions into the TS prompts would give two
authorities over one behavior, and the LLM's copy is the unreliable one.

**2. Skill delivery differs.** The app *always* appends every skill in
`AGENT_SKILLS` to the system prompt (`src/agents/base-agent.ts`), so anything a
skill covers is guaranteed to arrive and must not be restated in the prompt.
Claude Code invokes skills by description when the model judges them relevant,
which is not guaranteed — so the markdown agents legitimately restate guidance
the skills also cover.

### Where content belongs

| Kind of content | Home |
|---|---|
| Review cycle, escalation, loop prevention, handoffs | Plugin markdown only — the app does this in code |
| Craft guidance (contrast ratios, breakpoints, commit format) | `skills/` — never in a TS prompt |
| Role identity, core principles | Both, kept short |
| Output formats the code parses | The TS prompt (see below) |

When adding guidance to a TS prompt, first check whether a skill in that
agent's `AGENT_SKILLS` list already covers it. If so, the prompt would be
sending it twice in the same request.

## Machine-parsed contracts — change with care

Some prompt text is a contract with the parser, not advice:

- **`### TASK-001: Title`** headings and the field names `Title`, `Type`,
  `Complexity`, `Dependencies`, `Can Run In Parallel With`, `Files Affected`,
  `Acceptance Criteria`, `Description` are parsed by `parseTaskBreakdown` in
  `src/orchestrator/phases.ts`. The regex is `/###\s+(TASK-\d+)(?::\s*(.+))?/g`.
  Renaming any of these in the scrum-master prompt silently produces empty task
  lists.
- **`Type` values** map to agents via `agentMap` in the same function
  (`implementation`, `testing`, `documentation`, `infrastructure`,
  `deployment`, `design`).
- **Must-Fix / Should-Fix / Nice-to-Have / Out-of-Scope / Needs-Discussion**
  category names are referenced by the gate prompt in
  `src/orchestrator/quality-gates.ts`.

## Working on the packages

```bash
cd packages/mls-app   # or packages/mls-pi
npm install
npm run build
npm test              # mls-app: 146 tests · mls-pi: 794 tests
```

Neither suite meaningfully covers resource resolution — `mls-app` mocks
`loadAllSkills` outright. If you change how skills or templates resolve, verify
against the built output directly rather than trusting a green suite.

`packages/mls-pi` depends on `better-sqlite3` and (via vitest 4) on native
rolldown bindings. If `npm test` dies with `Cannot find module
'./rolldown-binding.*.node'`, npm skipped a platform-specific optional
dependency — delete `node_modules` *and* `package-lock.json`, then reinstall.

## When making changes

- Adding or renaming an agent — update `.claude-plugin/plugin.json` (the
  `agents` array lists every file explicitly) and the README.
- Adding a skill — create `skills/<name>/SKILL.md` with `name` and
  `description` frontmatter. To expose it to the app, add it to the relevant
  agent in `packages/mls-app/src/skills/registry.ts`; the plugin picks it up
  automatically.
- Changing a skill — remember it feeds both surfaces.
