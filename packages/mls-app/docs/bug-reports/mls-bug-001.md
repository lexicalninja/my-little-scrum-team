# MLS Bug Report: Phase 3 Execution Produces 0 Tasks

## Summary

`mls_build` completes Phases 0–2 (idea refinement, specification, task breakdown) successfully but executes 0 tasks in Phase 3. The build finishes with `Tasks Completed: 0/0`.

## Root Cause

**File:** `dist/src/orchestrator/phases.js` — `parseTaskBreakdown()`

The parser uses this regex to extract tasks from the scrum-master's markdown output:

```js
const taskRegex = /###\s+(TASK-\d+):\s*(.+)/g;
```

This expects task headers in the format:
```
### TASK-001: Create HTML Structure
```

But the scrum-master LLM consistently outputs:
```
### TASK-001
- **Title**: Create HTML Structure
- **Type**: Implementation
```

The regex matches 0 tasks. `parsedTasks` is an empty array. `ctx.state.tasks` remains `{}`. Phase 3 calls `executeParallel([], ...)` which is a no-op and exits immediately.

## Evidence

- `.mls/runs/<id>/state.json` — `tasks` field is `{}` after Phase 2 completes
- `.mls/runs/<id>/task-breakdown.md` — scrum-master output uses the `### TASK-001\n- **Title**: ...` format
- `agents/scrum-master.md` example block shows the correct `### TASK-001: Title` format, but the LLM drifts from it

## Suggested Fix

### Option A — Fix the parser (recommended, more robust)

Update `parseTaskBreakdown()` to handle both header formats:

```js
// Current — only matches "### TASK-001: Title"
const taskRegex = /###\s+(TASK-\d+):\s*(.+)/g;

// Proposed — also matches "### TASK-001" (title extracted separately)
const taskRegex = /###\s+(TASK-\d+)(?::\s*(.+))?/g;
```

Then in the loop, fall back to extracting the title from the `**Title**:` field when it's absent from the header:

```js
const title = match[2]?.trim() ?? extractField(section, 'Title') ?? id;
```

### Option B — Fix the scrum-master prompt

In `agents/scrum-master.md`, strengthen the format requirement in the example block and add an explicit instruction:

```markdown
> IMPORTANT: Task headers MUST use the format `### TASK-001: Title` (ID and title on the same line, separated by a colon). Do not use `### TASK-001` alone with a separate `**Title**:` field — the parser requires the inline format.
```

Note: Option B alone is fragile — LLMs drift from formatting instructions. Option A or both together is safer.

## Affected Files

- `src/orchestrator/phases.js` (or `.ts` source) — `parseTaskBreakdown()`
- `agents/scrum-master.md` — example task format

## Reproduction

From any empty git repo with MLS configured:

```
mls_build: make a static website with a kitty cat on it.
```

Check `.mls/runs/<id>/state.json` — `tasks` will be `{}` and the build summary will show `Tasks Completed: 0/0`.
