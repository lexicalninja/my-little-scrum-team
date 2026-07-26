# Schemas

Reference for config, event log, and database schemas.

---

# Configuration Schema

Complete reference for `.mls/config.json` structure.

Two config files are loaded and merged: `~/.mls/config.json` (global) and `<project>/.mls/config.json` (project). Project values override global values.

## Full Schema

```json
{
  "models": {
    "default": "provider/model-id",
    "build": "provider/model-id",
    "prd": "provider/model-id",
    "coding": "provider/model-id",
    "planning": "provider/model-id",
    "scrumMaster": "provider/model-id",
    "review": "provider/model-id",
    "tests": "provider/model-id",
    "agents": {
      "<agent-name>": "provider/model-id"
    }
  },
  "executionProfile": {
    "group1Concurrency": 3,
    "group2Concurrency": 3,
    "maxReviewIterations": 3,
    "maxTestRetries": 2,
    "enablePhase0": true,
    "enableSpecGate": true,
    "enableReviewGate": true,
    "sequentialGroup1": false,
    "skipAgentsMdExtraction": false,
    "humanGates": ["post-spec", "post-tasks"],
    "pipelineMode": "full"
  },
  "providers": {
    "<provider-name>": {
      "concurrency": 5,
      "spawnDelayMs": 2000
    }
  },
  "humanGates": ["post-spec"],
  "pipelineMode": "full"
}
```

## `models`

Routes each agent role to a specific model. Uses `provider/model-id` format (e.g. `anthropic/claude-sonnet-4-5`, `openai/gpt-4o`).

| Field | Description |
|-------|-------------|
| `default` | Fallback for all roles not explicitly set |
| `build` | LLM calls during build orchestration |
| `prd` | LLM calls for PRD/spec generation |
| `coding` | `mls-impl-engineer`, `mls-infra-engineer`, `mls-designer` |
| `planning` | `mls-spec-writer` |
| `scrumMaster` | `mls-scrum-master` |
| `review` | `mls-code-reviewer` |
| `tests` | `mls-test-runner` |
| `agents` | Per-agent overrides by exact agent name |

### Example: Mixed providers

```json
{
  "models": {
    "default": "anthropic/claude-sonnet-4-5",
    "coding": "openai/gpt-4o",
    "tests": "openai/gpt-4o-mini"
  }
}
```

## `executionProfile`

Controls how the pipeline runs.

| Field | Type | Description |
|-------|------|-------------|
| `group1Concurrency` | number | Max parallel agents in Group 1 (design/infra/docs) |
| `group2Concurrency` | number | Max parallel impl tasks per batch in Group 2 |
| `maxReviewIterations` | number | Max review-loop passes before escalation |
| `maxTestRetries` | number | Max test-fix attempts before escalation |
| `enablePhase0` | boolean | Run Phase 0 (idea refinement) |
| `enableSpecGate` | boolean | Run spec-completeness LLM gate after Phase 1 |
| `enableReviewGate` | boolean | Require reviewer approval (false = auto-approve) |
| `sequentialGroup1` | boolean | Run Group 1 tasks sequentially instead of parallel |
| `skipAgentsMdExtraction` | boolean | Skip tech-stack context extraction to save tokens |
| `humanGates` | string[] | Gate points requiring human approval |
| `pipelineMode` | string | `"full"`, `"gated"`, or `"review-only"` |

### `pipelineMode` values

- `"full"` — All phases run end-to-end (default)
- `"gated"` — Pauses at every enabled human gate
- `"review-only"` — Phases 0–2 only; produces spec + tasks without running implementation

### `humanGates` values

- `"post-spec"` — After Phase 1 (specification) completes
- `"post-tasks"` — After Phase 2 (task breakdown) completes
- `"post-design"` — After Group 1 design tasks, before Group 2 impl
- `"on-escalation"` — When a task is escalated
- `"post-review"` — After the review loop in fast paths

### Example: Review-only with human gates

```json
{
  "executionProfile": {
    "pipelineMode": "review-only",
    "humanGates": ["post-spec", "post-tasks"]
  }
}
```

### Example: Reduce concurrency

```json
{
  "executionProfile": {
    "group1Concurrency": 1,
    "group2Concurrency": 1
  }
}
```

## `providers`

Per-provider concurrency and pacing overrides.

```json
{
  "providers": {
    "anthropic": {
      "concurrency": 5,
      "spawnDelayMs": 2000
    }
  }
}
```

## `humanGates` and `pipelineMode` (top-level shortcuts)

These merge into the execution profile. Equivalent to setting them inside `executionProfile`:

```json
{
  "humanGates": ["post-spec"],
  "pipelineMode": "gated"
}
```

---

# Event Log Schema

MLS logs every event to a per-session JSONL file at `.mls/sessions/<sessionId>.jsonl`. One JSON object per line.

Each `/build` creates a new session with a unique ID. Old sessions are kept indefinitely.

## Common Fields

Every event has:

```json
{
  "type": "event_type",
  "timestamp": 1712577600000,
  "sessionId": "abc123"
}
```

`timestamp` is Unix milliseconds.

## Event Types

### `sprint_start`
```json
{ "type": "sprint_start", "timestamp": 1712577600000, "input": "add login form", "classification": "feature" }
```

### `phase`
```json
{ "type": "phase", "timestamp": 1712577600000, "phase": "phase1" }
```

Phase values: `phase0`, `phase1`, `phase2`, `scaffold`, `phase3`, `phase4`, `complete`, `fast-path`, `impl-fast-path`.

### `agent_start`
```json
{ "type": "agent_start", "timestamp": 1712577600000, "agent": "mls-spec-writer", "prompt": "...", "taskLabel": "TASK-001" }
```

### `agent_end`
```json
{
  "type": "agent_end",
  "timestamp": 1712577600000,
  "agent": "mls-impl-engineer",
  "taskLabel": "TASK-001",
  "model": "claude-sonnet-4-5",
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

### `agent_progress`
```json
{ "type": "agent_progress", "timestamp": 1712577600000, "agent": "mls-impl-engineer", "taskLabel": "TASK-001", "text": "Writing auth module...", "toolCount": 5 }
```

### `gate`
```json
{ "type": "gate", "timestamp": 1712577600000, "name": "spec-completeness", "passed": true, "issues": [] }
```

### `task`
```json
{ "type": "task", "timestamp": 1712577600000, "id": "uuid", "status": "in_progress", "title": "TASK-001: Add login form" }
```

### `review`
```json
{ "type": "review", "timestamp": 1712577600000, "taskId": "uuid", "label": "TASK-001", "title": "Add login form", "iteration": 1, "max": 3, "approved": true, "escalated": false, "reason": "approved" }
```

### `human_gate`
```json
{ "type": "human_gate", "timestamp": 1712577600000, "gate": "post-spec", "status": "approved", "feedbackRounds": 1, "autonomous": false }
```

### `llm_start` / `llm_end`
```json
{ "type": "llm_start", "timestamp": 1712577600000, "purpose": "build", "system": "...", "user": "...", "tier": "cloud" }
{ "type": "llm_end", "timestamp": 1712577600000, "purpose": "build", "response": "..." }
```

### `exec_start` / `exec_end`
```json
{ "type": "exec_start", "timestamp": 1712577600000, "command": "npm", "args": ["test"] }
{ "type": "exec_end", "timestamp": 1712577600000, "command": "npm", "code": 0, "stdout": "..." }
```

### `sprint_end`
```json
{ "type": "sprint_end", "timestamp": 1712577600000, "summary": "Completed 5 tasks...", "aborted": false }
```

### Other types

- `rate_limit` — Provider throttle active (`delayMs`, `concurrency`)
- `deletion_check` — Destructive diff detected (`tier`, `filesDeleted`, `linesRemoved`, `linesAdded`)
- `checkpoint` — Git stash checkpoint created (`taskId`, `ref`)
- `clarification` — Agent raised a clarifying question (`agent`, `questions`, `answer`, `autonomous`)

## Reading Logs

### View all events from the latest session
```bash
ls -t .mls/sessions/*.jsonl | head -1 | xargs cat | jq .
```

### Filter by event type
```bash
cat .mls/sessions/*.jsonl | jq 'select(.type=="agent_end")'
```

### Calculate total cost
```bash
cat .mls/sessions/*.jsonl | jq 'select(.type=="agent_end") | .usage.cost' | paste -sd+ | bc
```

### View timeline
```bash
cat .mls/sessions/*.jsonl | jq '"\(.timestamp): \(.type)"'
```

---

# Database Schema

MLS stores sprint history and task tracking in `.mls/mls.db` (SQLite).

## Tables

### projects

One row per git repository.

```sql
CREATE TABLE projects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  description TEXT,
  repo_path   TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### sprints

One row per `/build` run.

```sql
CREATE TABLE sprints (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id      INTEGER NOT NULL REFERENCES projects(id),
  name            TEXT NOT NULL,
  goal            TEXT,
  status          TEXT NOT NULL DEFAULT 'active',  -- active|completed|cancelled|aborted
  classification  TEXT,
  specification   TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at    TEXT
);
```

### issues

One row per task. Epics are issues with a non-null `parent_id`.

```sql
CREATE TABLE issues (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id          INTEGER NOT NULL REFERENCES projects(id),
  sprint_id           INTEGER NOT NULL REFERENCES sprints(id),
  parent_id           INTEGER REFERENCES issues(id),
  number              INTEGER NOT NULL,
  title               TEXT NOT NULL,
  body                TEXT,
  type                TEXT NOT NULL DEFAULT 'Implementation',
  status              TEXT NOT NULL DEFAULT 'open',  -- open|in_progress|testing|reviewing|closed|escalated
  assigned_agent      TEXT,
  dependencies        TEXT NOT NULL DEFAULT '[]',   -- JSON array of task labels
  acceptance_criteria TEXT NOT NULL DEFAULT '[]',
  files_affected      TEXT NOT NULL DEFAULT '[]',
  output              TEXT,
  review_output       TEXT,
  design_output       TEXT,
  iteration_count     INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at           TEXT
);
```

### labels and issue_labels

```sql
CREATE TABLE labels (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id),
  name        TEXT NOT NULL,
  color       TEXT,
  description TEXT,
  UNIQUE(project_id, name)
);

CREATE TABLE issue_labels (
  issue_id  INTEGER NOT NULL REFERENCES issues(id),
  label_id  INTEGER NOT NULL REFERENCES labels(id),
  PRIMARY KEY (issue_id, label_id)
);
```

## Useful Queries

### Recent sprints
```sql
SELECT id, name, status, created_at FROM sprints ORDER BY created_at DESC LIMIT 10;
```

### Tasks for a sprint
```sql
SELECT number, title, type, status, assigned_agent, iteration_count
FROM issues
WHERE sprint_id = 1
ORDER BY number;
```

### Escalated tasks
```sql
SELECT s.name AS sprint, i.title, i.iteration_count
FROM issues i JOIN sprints s ON i.sprint_id = s.id
WHERE i.status = 'escalated'
ORDER BY i.created_at DESC;
```

---

## Next Steps

See the [FAQ](./faq.md) for common questions, or the [Commands](./commands.md) reference for `/build` and `/mls-status` syntax.
