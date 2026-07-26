# My Little Scrum Team (MLST) — Pi Extension

A multi-agent orchestration system that turns a single sentence into a fully implemented, tested, and reviewed feature. Built as an extension for [pi.dev](https://pi.dev).

## What is Pi?

[Pi](https://pi.dev) is an AI coding agent that runs in your terminal. It reads your codebase, writes code, runs commands, and iterates on feedback — similar to Claude Code or Cursor. Pi supports **extensions** — TypeScript modules that add custom commands, event handlers, and workflows to the base agent.

## What is a Pi Extension?

A Pi extension is a TypeScript file (or directory) that pi discovers and loads at startup. Extensions can:

- Register custom slash commands (e.g., `/build`, `/mlst-status`)
- Listen to events (session start, tool calls, context compaction)
- Spawn sub-agents with specific prompts and tool restrictions
- Make direct LLM calls without spawning a full agent session
- Persist state across sessions

Pi looks for extensions in two places:

| Location | Scope |
|----------|-------|
| `~/.pi/agent/extensions/` | Global — available in every project |
| `.pi/extensions/` | Project-local — only in that repo |

Each extension exports a function from its `index.ts` that receives Pi's extension API.

## What This Extension Does

MLST adds three commands to pi:

- **`/build <description>`** — Takes a natural language description and runs a full software development lifecycle: specification, task breakdown, implementation, testing, code review, and iteration.
- **`/prd <idea>`** — Runs an interactive planning session that produces a PRD, ready to hand to `/build`.
- **`/mlst-status`** — Shows the current sprint status from the local database.

One command kicks off the entire workflow. You describe what you want, and MLST coordinates 7 specialist agents through 5 phases to deliver it.

## How It Works

### The Blueprint Engine

Every step in the workflow is classified as one of three node types:

| Node Type | What It Does | When To Use |
|-----------|-------------|-------------|
| **[CODE]** | Deterministic TypeScript. Runs tests, validates structure, routes workflows. | When the answer can be computed — no LLM needed |
| **[LLM]** | Direct model call via subprocess. Fast, cheap, no tool access. | Classification, gate evaluation, parsing — sub-second decisions |
| **[AGENT]** | Full agent subprocess with isolated context and tools. | Writing specs, implementing code, reviewing — work that needs reasoning and tool use |

The orchestrator always picks the cheapest node type that can do the job. It never spawns a full agent when a direct LLM call would suffice, and never calls an LLM when deterministic code can decide.

### The Phases

```
/build "add user authentication"

  Phase 0: Idea Refinement
  [LLM]   Classify input → feature, bug, epic, etc.
  [LLM]   Evaluate if requirements are clear enough to proceed

  Phase 1: Specification
  [AGENT]  mlst-spec-writer → detailed specification
  [LLM]   Gate 1: evaluate spec completeness

  Phase 2: Task Breakdown
  [AGENT]  mlst-scrum-master → atomic task list (TASK-001, TASK-002, ...)
  [LLM]   Parse tasks into structured JSON
  [CODE]   Gate 2: validate task IDs, types, acceptance criteria exist

  Scaffolding (greenfield projects only)
  [AGENT]  mlst-impl-engineer → init project, install deps, wire DB,
           health check, integration test proving the stack works
  [CODE]   Skipped if source files already exist

  Group 1: Design + Infrastructure + Documentation (parallel)
  [AGENT]  mlst-designer + mlst-infra-engineer + mlst-impl-engineer (docs)
           No TDD loop — produce artifacts and mark complete

  Group 2: Implementation (per task, up to 5 iterations)
  [AGENT]  mlst-test-runner → write failing tests (RED)
  [AGENT]  mlst-impl-engineer → make tests pass (GREEN)
  [CODE]   Run tests deterministically (exit code 0 = pass)
  [CODE]   Run linter deterministically
  [AGENT]  mlst-code-reviewer → structured review
  [LLM]   Evaluate review verdict
  [CODE]   Check for repeated issues across iterations

  Phase 4: Completion
  [LLM]   Generate sprint summary
  [CODE]   Update database, mark sprint complete
```

### Quality Gates

The workflow has two formal gates that emit events to the dashboard and run log:

1. **spec-completeness** (LLM) — Does the spec have all required sections? Checked after Phase 1.
2. **task-breakdown** (CODE) — Do all tasks have valid IDs, types, and acceptance criteria? Checked after Phase 2.

Additional checks happen inline but are not emitted as gate events:
- Phase 0 evaluates whether requirements are clear enough (LLM, advisory only)
- Phase 3 checks test exit codes deterministically (exit code 0 = pass)
- Phase 3 evaluates review verdicts (LLM) to decide whether to iterate

### Project Orientation

Before Phase 3, the orchestrator runs a deterministic `find` to list source files in the project (excluding `node_modules`, `.git`, `dist`, etc.), capped at 100 files. This file tree is injected into spec-writer and fast-path prompts as a `## Project Structure` section, giving agents a map of the codebase without any LLM calls.

On empty repos, the file tree is empty and scaffolding runs instead. After scaffolding creates the project skeleton, the orientation cache is invalidated so subsequent agents see the new files.

Implementation agents (test-runner, impl-engineer) explore the codebase themselves using their grep, find, read, and ls tools — the same approach used by Claude Code, OpenHands, SWE-agent, and most other coding agents.

### Scaffolding

On greenfield projects (no source files detected), the orchestrator spawns `mlst-impl-engineer` before any tasks to wire the tech stack end-to-end: initialize the project, install dependencies, connect the real database driver, create a health check endpoint, and run an integration test proving it all works. This prevents a common failure mode where per-task TDD creates in-memory fakes instead of using real dependencies.

### Tool Filtering

During orchestration, `edit` and `write` tools are blocked via a `tool_call` event hook. The orchestrator cannot write code — this is enforced at the code level, not via prompt instructions. Only the specialist agents (impl-engineer, test-runner, etc.) can modify files.

## Agents

Seven specialist agents, each with a focused role and restricted tool access:

| Agent | Role | Tools |
|-------|------|-------|
| `mlst-spec-writer` | Transforms ideas into detailed specifications | read, grep, find, ls |
| `mlst-scrum-master` | Breaks specs into atomic, dependency-ordered tasks | read, grep, find, ls |
| `mlst-impl-engineer` | Implements code to make failing tests pass | read, edit, write, bash, grep, find, ls |
| `mlst-test-runner` | Writes failing tests from acceptance criteria (TDD red phase) | read, write, bash, grep, find, ls |
| `mlst-code-reviewer` | Reviews code against acceptance criteria — rejects only for bugs, security issues, or spec violations | read, grep, find, ls, bash |
| `mlst-designer` | Creates UI/UX design specifications (layout, components, accessibility) | read, write, grep, find, ls |
| `mlst-infra-engineer` | Sets up CI/CD, Docker, deployment configs | read, edit, write, bash, grep, find, ls |

Agent prompts live in `agents/*.md` as markdown files with YAML frontmatter. Each agent's system prompt defines its role, constraints, and output format.

### Model Routing

MLST supports role-based model routing via `.mlst/config.json` at two levels:

| Location | Scope |
|----------|-------|
| `~/.mlst/config.json` | Global — applies to every project |
| `<project>/.mlst/config.json` | Project-local — overrides global for that repo |

Project settings are deep-merged on top of global settings. Nested objects (`models`, `models.agents`, `providers`, `executionProfile`) are merged key-by-key; scalars are replaced outright.

If you do nothing, MLST inherits the model from the parent pi session for all agents and direct LLM calls.

Resolution order for agent subprocesses:

1. Config exact agent override: `models.agents["mlst-..."]`
2. Config role default: `coding`, `planning`, `scrumMaster`, `review`, `tests`
3. Agent frontmatter `model:` in `agents/*.md`
4. Parent pi session model (`/model`, `--model`, `/login`)

"Config" here means the merged result of global + project configs. Project values win when both define the same key.

Direct LLM calls inside the orchestrator and `/prd` use `models.build`, `models.prd`, or `models.planning` before falling back to the parent session model.

This lets you set stable defaults once in `~/.mlst/config.json` and override per-project only when needed.

### Thinking Effort

Thinking is disabled for all sub-agents (`--thinking off`). The orchestrator relies on clear prompts and structured output rather than extended reasoning, keeping agent calls fast and token-efficient.

### Rate Throttling

The agent spawner automatically adjusts concurrency and pacing based on the model provider:

| Provider | Concurrency | Pacing | Examples |
|----------|-------------|--------|----------|
| Subscription | 4 agents | None | copilot, github-copilot |
| Paid API | 4 agents | None | anthropic, openai, cerebras |
| Local | 2 agents | None | ollama, lmstudio |
| Free-tier API | 1 agent | 3-5s between spawns | google, gemini, groq |
| Routed / aggregator | 1-2 agents | 2-5s between spawns | openrouter, minimax, qwen, xiaomi, kimi |

For `openrouter`, the extension also checks the sub-provider from the model ID (e.g., `google/gemini-3-flash-preview` uses the `google` profile).

On top of the provider profile, adaptive backoff detects 429 errors and exponentially increases delay. It recovers toward the profile baseline after successful calls.

#### Overriding provider profiles

Create `~/.mlst/config.json` for global defaults that apply everywhere, and/or `<project>/.mlst/config.json` for per-project overrides:

**Global** (`~/.mlst/config.json`) — your baseline for all projects:

```json
{
  "models": {
    "default": "anthropic/claude-sonnet-4-20250514",
    "coding": "anthropic/claude-sonnet-4-20250514",
    "planning": "openai/o3-pro",
    "review": "google/gemini-3.1-pro",
    "tests": "openai/o3-mini"
  },
  "providers": {
    "google": { "concurrency": 4, "spawnDelayMs": 0 }
  }
}
```

**Project** (`<project>/.mlst/config.json`) — overrides only what differs:

```json
{
  "models": {
    "coding": "openai/o3",
    "agents": {
      "mlst-designer": "openai/gpt-4o-mini"
    }
  }
}
```

The merged result keeps `default`, `planning`, `review`, `tests`, and `providers` from global, while `coding` and `agents.mlst-designer` come from the project config.

This is useful when you want MLST-specific model defaults or when the built-in provider profile doesn't match your setup (e.g., you have a paid Google API key, not free-tier).

## Skills

Skills are reusable prompt instructions loaded from the **repo root's shared
`skills/` directory** — this package carries no copies of its own. The loader
checks the installed extension first, then the package, then the repo root
(`resolveResourceDir` in `index.ts`), and the installer bakes the shared
skills into the installed extension so it stays self-contained. Each agent
receives only the skills mapped to it, appended to its system prompt at spawn
time.

| Skill | Injected Into | Mechanism | Purpose |
|-------|---------------|-----------|---------|
| `design-system` | mlst-designer | `AGENT_SKILLS` in `types.ts` | Reference guide for layout, components, color, typography, spacing, accessibility |
| `idea-refiner` | orchestrator | `getOrchestratorSkill()` in `skills.ts` | Pre-spec refinement — clarifying questions and approach proposals |

Agent skills are mapped in `AGENT_SKILLS` and appended to agent system prompts at spawn time. The orchestrator accesses its own skills directly via `getOrchestratorSkill()`.

## Data Storage

Sprint state is persisted to a SQLite database at `<project-root>/.mlst/mlst.db`. Each project gets its own database. The schema tracks:

| Table | Purpose |
|-------|---------|
| `projects` | One row per repository (keyed by `repo_path`) |
| `sprints` | One row per `/build` invocation — status, classification, specification |
| `issues` | Tasks and sub-tasks with status, assigned agent, acceptance criteria, output, review feedback |
| `labels` | Custom labels for issues |
| `issue_labels` | Junction table |

State persists across context compaction, session switches, and restarts. The extension also injects sprint context into Pi's compaction prompt so task IDs and statuses survive summarization.

Add `.mlst/` to your project's `.gitignore` — it contains local runtime state, not source.

## Dashboard

A real-time web dashboard is available at `http://localhost:4242` during a sprint. It uses Server-Sent Events (SSE) to stream orchestrator events to an Alpine.js frontend.

**Three-panel layout:**

- **Left:** Orchestrator state, task list with status and active agents
- **Top right:** Event log — phase transitions, agent spawns, LLM calls, gate results, cost tracking
- **Bottom right:** Test results tree — per-file pass/fail counts, individual test cases with errors

The dashboard parses test output from Vitest, Cargo, Pytest, RSpec, JUnit, and Go test.

### Run logs

Every `/build` invocation writes a JSONL log to `.mlst/runs/<timestamp>.jsonl`. Each line is a JSON object with a `type` field matching the `MlstEvent` union in `types.ts`:

```
{"type":"sprint_start","input":"...","classification":"feature","timestamp":1774471423101}
{"type":"phase","phase":"phase1","timestamp":1774471423101}
{"type":"agent_start","agent":"mlst-spec-writer","taskLabel":"","timestamp":1774471423200}
{"type":"llm_start","purpose":"...","timestamp":1774471425000}
{"type":"llm_end","purpose":"...","response":"...","timestamp":1774471426000}
{"type":"gate","name":"spec-completeness","passed":true,"timestamp":1774471427000}
{"type":"agent_end","agent":"mlst-spec-writer","usage":{...},"timestamp":1774471430000}
{"type":"sprint_end","summary":"...","timestamp":1774471500000}
```

Browse with standard tools:

```bash
# List all runs
ls .mlst/runs/

# Watch events from the latest run
tail -f .mlst/runs/*.jsonl | jq .

# Show all gate results
cat .mlst/runs/*.jsonl | jq 'select(.type == "gate")'

# Show agent costs
cat .mlst/runs/*.jsonl | jq 'select(.type == "agent_end") | {agent, cost: .usage.cost, model}'
```

## Architecture

The extension is split across two layers: **TypeScript source** (the runtime) and **markdown content** (agent prompts, skills, templates). Understanding which file owns what makes it easier to find and change things.

### File map

```
packages/mlst-pi/
├── .pi/extensions/mlst/                  # Extension source (TypeScript)
│   ├── index.ts                         # Command registration (/build, /prd, /mlst-status),
│   │                                    # input parsing (@file refs, GitHub issue refs),
│   │                                    # resource resolution (resolveResourceDir),
│   │                                    # tool blocking, context compaction hook
│   ├── orchestrator/                    # 5-phase workflow engine: phase0()–phase4(),
│   │                                    # task-to-agent routing, review loop,
│   │                                    # test/lint execution, gate evaluation
│   ├── agents.ts                        # Agent subprocess spawning (spawnAgent),
│   │                                    # parallel execution, provider profiles
│   │                                    # (DEFAULT_PROVIDER_PROFILES), RateThrottle,
│   │                                    # per-project config loading (loadProviderProfile)
│   ├── prd.ts                           # /prd interactive planning session
│   ├── quality-gates.ts                 # Deterministic validation: taskBreakdownValid(),
│   │                                    # testsPass()
│   ├── context.ts                       # Prompt assembly per phase: buildSpecPrompt(),
│   │                                    # buildImplPrompt(), buildTestFromCriteriaPrompt()
│   ├── types.ts                         # Shared types (Phase, TaskState, Classification),
│   │                                    # MlstEvent union, AGENT_SKILLS mapping
│   ├── state.ts                         # StateManager — sprint state + UI sync
│   ├── db.ts                            # SQLite schema (SCHEMA constant), MlstDatabase class
│   ├── llm.ts                           # Direct LLM calls via pi subprocess
│   ├── skills.ts                        # Skill loader — reads SKILL.md files,
│   │                                    # injects into agent prompts via AGENT_SKILLS
│   ├── dashboard.ts                     # SSE server on :4242, JSONL run logging
│   └── dashboard-ui/                    # Alpine.js frontend: UI, test output parsers
├── agents/                              # Agent system prompts (7 markdown files with
│                                        # YAML frontmatter: name, tools, model)
├── scripts/
│   └── install.js                       # Installer — copies or symlinks to ~/.pi,
│                                        # bakes in shared skills/templates from repo root
├── package.json                         # Dependencies (better-sqlite3, TypeScript)
└── tsconfig.json                        # ES2022 target, strict mode

(skills/ and templates/ live at the REPO ROOT, shared with every surface —
this package deliberately carries no copies.)
```

### How the pieces connect

```
index.ts
  ├── registers /build command
  ├── resolves input (string, file path, or @file refs)
  ├── loads provider profile → applies to RateThrottle
  ├── creates Orchestrator with all dependencies
  │
  └── Orchestrator (orchestrator.ts)
        ├── phase0: LlmClient → classify + evaluate clarity
        ├── phase1: spawnAgent(spec-writer) → QualityGates.specComplete
        ├── phase2: spawnAgent(scrum-master) → LlmClient.parse → QualityGates.taskBreakdownValid
        ├── scaffold: spawnAgent(impl-engineer) → wire tech stack [greenfield only]
        ├── group1: spawnAgentsParallel(designer, infra, docs) [if needed]
        ├── group2: for each implementation task:
        │     ├── spawnAgent(test-runner) → RED
        │     ├── spawnAgent(impl-engineer) → GREEN
        │     ├── exec(test command) → deterministic pass/fail
        │     ├── exec(lint command) → deterministic pass/fail
        │     └── spawnAgent(code-reviewer) → LlmClient.evaluateVerdict
        │           └── loop up to maxReviewIterations
        └── phase4: LlmClient → summary → StateManager.complete
```

Each `spawnAgent()` call:
1. Waits for `RateThrottle` pacing
2. Loads the agent prompt from `agents/*.md`
3. Appends the shared skills mapped to it in `AGENT_SKILLS` (resolved from the repo root `skills/`)
4. Spawns a `pi` subprocess with `--no-extensions`
5. Streams events back to the dashboard via `MlstEvent` emissions

## Installation

### 1. Install dependencies

```bash
cd packages/mlst-pi
npm install
```

Pi loads TypeScript extensions directly via `jiti` — no build step is required.

### 2. Install the extension

Choose one method:

**Global install** (available in all projects):

```bash
npm run install-ext
```

This copies the extension to `~/.pi/agent/extensions/mlst/` and installs runtime dependencies there.

**Global symlink** (for development — changes are reflected immediately):

```bash
npm run dev
```

This symlinks instead of copying, so edits to the source are picked up without reinstalling.

**Manual symlink** (global):

```bash
ln -s /absolute/path/to/my-little-scrum-team/packages/mlst-pi/.pi/extensions/mlst ~/.pi/agent/extensions/mlst
```

**Project-local** (only available in one repo):

```bash
cd /your/project
mkdir -p .pi/extensions
ln -s /absolute/path/to/my-little-scrum-team/packages/mlst-pi/.pi/extensions/mlst .pi/extensions/mlst
```

### 3. Verify

Start pi in any project. You should see `/build`, `/prd`, and `/mlst-status` available as commands.

### Uninstall

```bash
npm run uninstall-ext
```

## Provider Configuration

MLST works with whatever model provider you configure in pi. Pi supports subscription-based authentication, API keys, and cloud provider credentials.

### Subscription-based (no API key needed)

Use `/login` in pi's interactive mode, then select a provider:

| Provider | Subscription | Notes |
|----------|-------------|-------|
| **Anthropic** | Claude Pro / Max | OAuth login via `/login`. **Warning:** Anthropic's ToS may prohibit third-party API access via subscription — using Claude Pro/Max through pi risks account suspension. Use an API key instead |
| **OpenAI** | ChatGPT Plus / Pro | OAuth login via `/login`. Personal use only — use Platform API for production |
| **GitHub Copilot** | Copilot Individual / Business | OAuth login via `/login` |
| **Google** | Free with any Google account | Subject to rate limits. Set `GOOGLE_CLOUD_PROJECT` for paid Cloud Code Assist |
| **Gemini CLI** | Free with any Google account | Same as Google — rate-limited on free tier |

### API key

Set keys in `~/.pi/agent/auth.json` or via environment variables:

```json
{
  "anthropic": { "apiKey": "sk-ant-..." },
  "openai": { "apiKey": "sk-..." },
  "google": { "apiKey": "AIza..." }
}
```

Or use environment variables: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`.

Additional API key providers: Mistral, Groq, Cerebras, xAI.

### Aggregators and routed providers

| Provider | Platform | Notes |
|----------|----------|-------|
| **OpenRouter** | [openrouter.ai](https://openrouter.ai) | Routes to 100+ models from many providers. Free and paid tiers. MLST detects the sub-provider from the model ID (e.g., `google/gemini-3-flash-preview` applies Google rate profiles) |
| **MiniMax** | [platform.minimax.io](https://platform.minimax.io) | Direct API with own SDK (Python, Node.js, Go). Also available via OpenRouter |
| **Xiaomi MiMo** | [platform.xiaomimimo.com](https://platform.xiaomimimo.com) | Direct API (OpenAI-compatible). MiMo-V2-Pro, Omni, and Flash models. Also available via OpenRouter |
| **Qwen** | Direct API or OpenRouter | Alibaba's model family |
| **Kimi** | Direct API or OpenRouter | Moonshot AI's long-context models |

For aggregators, configure in `auth.json` with the provider name as the key, or add as a custom provider in `~/.pi/agent/models.json` if the endpoint is OpenAI-compatible.

### Cloud providers

| Provider | Auth Method |
|----------|------------|
| **Azure OpenAI** | API key + base URL or resource name |
| **Amazon Bedrock** | AWS profile, IAM keys, or bearer token |
| **Google Vertex AI** | Application Default Credentials |

### Credential resolution order

CLI flag → `auth.json` → environment variable → custom provider keys from `models.json`.

### Custom models

Add models from any OpenAI-, Anthropic-, or Google-compatible API via `~/.pi/agent/models.json`. This covers Ollama, LM Studio, vLLM, and other local or self-hosted providers.

### How providers affect MLST

The extension automatically adjusts agent concurrency and pacing based on your provider (see [Rate Throttling](#rate-throttling)). Subscription and paid API providers get full parallelism (4 concurrent agents). Free-tier and routed providers are throttled to avoid rate limits. Override this globally in `~/.mlst/config.json` or per-project in `<project>/.mlst/config.json`:

```json
{
  "models": {
    "coding": "anthropic/claude-sonnet-4-20250514",
    "planning": "openai/o3-pro",
    "scrumMaster": "openai/gpt-4o",
    "review": "google/gemini-3.1-pro",
    "tests": "openai/o3-mini"
  },
  "providers": {
    "google": { "concurrency": 4, "spawnDelayMs": 0 }
  }
}
```

See [Model Routing](#model-routing) for details on how global and project configs are merged.

## Usage

`/build` accepts four input forms:

**String description** — a natural language sentence:

```
/build add a password reset flow
/build the login button returns 500 when email is empty
```

**File path** — a markdown file containing a task description or full PRD:

```
/build PRD.md
/build docs/auth-spec.md
```

The file contents become the input. Use this for detailed specs or multi-page PRDs that are too long to type inline.

**Inline file reference** — mix a description with `@file` references:

```
/build implement the auth flow described in @PRD.md
/build fix the issues listed in @bugs/login-500.md
```

The `@file` is replaced with the file contents before processing.

**GitHub Issue References** — fetch a GitHub issue and use its title and body as the build input:

```
/build #25
/build owner/repo#25
```

The bare `#N` form infers the repo from `git remote get-url origin` in the current working directory. The `owner/repo#N` form fetches from an explicit repo without touching `git`. Both forms require the `gh` CLI to be installed and authenticated (`gh auth login`).

The issue is formatted as:
```
GitHub Issue #25: <title>

<body>
```

> **Note:** Only whole-input issue references are supported. References embedded in longer strings (e.g. `/build fix the bug in #25`) are not expanded and are passed through as plain text.

**Status:**

```
/mlst-status
```

The orchestrator classifies the input (feature, bug, epic, etc.) and routes through the appropriate workflow. Rate limiting is handled automatically based on your model provider.

## Developing the Extension

### Source files

All extension source lives in `.pi/extensions/mlst/`. Edit these files directly — if you installed via `npm run dev` (symlink), changes take effect on the next pi session.

### TypeScript compilation

The extension doesn't need to be compiled for pi (it uses `jiti`), but you can compile for type checking:

```bash
npm run build          # One-time compile
npm run watch          # Watch mode
```

Output goes to `out/`.

### Adding an agent

1. Create `agents/your-agent-name.md` with YAML frontmatter:
   ```yaml
   ---
   name: mlst-your-agent
   description: What this agent does
   tools: read, grep, find, ls
   ---
   ```
2. Write the system prompt in the markdown body
3. Reference the agent name in `orchestrator/` where it should be spawned

### Adding a skill

1. Create `skills/your-skill-name/SKILL.md` **at the repo root** — skills are
   shared, so the new skill is also visible to the Claude Code plugin, the CLI,
   and the VS Code extension
2. Map it to an agent in `AGENT_SKILLS` in `types.ts`
3. It will be automatically loaded and injected at spawn time

### Database

During development, the SQLite database is created at `<cwd>/.mlst/mlst.db`. You can inspect it directly:

```bash
sqlite3 .mlst/mlst.db ".tables"
sqlite3 .mlst/mlst.db "SELECT * FROM sprints ORDER BY created_at DESC LIMIT 5;"
```
