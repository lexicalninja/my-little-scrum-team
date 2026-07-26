# Dashboard

The real-time web dashboard at `http://localhost:4242` gives you live visibility into your build.

## Three-Panel Layout

### Left Panel: Orchestrator State

Shows current status:
- Current phase (0, 1, 2, 3, or 4)
- Task list with status badges (pending, in-progress, passed, failed, reviewed)
- Active agents working right now
- Estimated time remaining

### Top Right: Event Log

Chronological stream of events:
- Phase transitions
- Agent spawns and completions
- LLM calls (classification, parsing, evaluation)
- Quality gate results (spec-completeness, task-breakdown)
- Cost tracking per agent

### Bottom Right: Test Results

Test output parsed by framework:
- **Vitest** — passes, failures, error messages
- **Cargo** — Rust test output
- **Pytest** — Python test output
- **RSpec** — Ruby test output
- **JUnit** — XML-based test output
- **Go test** — Go test output

Each line shows a test file/case with pass/fail status.

## Real-Time Updates

Updates come via Server-Sent Events (SSE). If you see stale data, refresh the page.

Dashboard is only available **during an active sprint**. After `/build` completes, it shuts down. Browse JSONL logs to inspect completed builds.

## Interpreting Events

### `sprint_start`
Sprint begins. Shows input classification (feature, bug, epic, etc.)

### `phase`
Phase transition. Expect:
- phase0: classification & clarity check
- phase1: specification writing
- phase2: task breakdown
- phase3: implementation & review
- phase4: completion

### `agent_start` / `agent_end`
Agent subprocess spawned or completed. Shows agent name, model, and token usage.

### `llm_start` / `llm_end`
Direct LLM call (not an agent). Shows prompt and response. Cheap operations (evaluation, parsing).

### `gate`
Quality gate result. Shows gate name and pass/fail:
- `spec-completeness` — Does spec have all required sections?
- `task-breakdown` — Are all tasks valid with IDs and acceptance criteria?

If a gate fails, the build stops.

### `sprint_end`
Build complete. Shows summary, total cost, and timestamp.

## Understanding Cost

Token usage and cost appear in `agent_end` events. Example:

```json
{
  "type": "agent_end",
  "agent": "mlst-impl-engineer",
  "usage": {
    "input": 8250,
    "output": 3100,
    "cacheRead": 0,
    "cacheWrite": 0,
    "cost": 0.034,
    "contextTokens": 11350,
    "turns": 3
  }
}
```

Cost is calculated per agent/model. See **[Cost Tracking](../advanced/cost-tracking.md)** for optimization tips.

## Next Steps

- **[Build Phases](./phases.md)** — What each phase does
- **[Quality Gates](./gates.md)** — How automatic validation works
- **[Advanced: Debugging](../advanced/debugging.md)** — Troubleshooting failed builds
