# Quality Gates

MLS has automatic quality checkpoints that validate the build before proceeding.

## Overview

Two formal gates emit events to the dashboard and logs:

| Gate | Phase | Type | Checks |
|------|-------|------|--------|
| **spec-completeness** | Phase 1 | LLM | Does spec have all required sections? |
| **task-breakdown** | Phase 2 | CODE | Are all tasks valid with IDs and acceptance criteria? |

Additional checks happen inline but don't emit gate events (tests passing, linter passing, code review verdict).

---

## Gate 1: Spec-Completeness

**When:** After Phase 1 (specification writing)

**What it checks (LLM):**
- Overview
- Requirements
- Technical approach
- Acceptance criteria

Additional detail such as user flows, API endpoints, schema notes, mockups, error handling, security considerations, and edge cases may still improve a spec, but they are not the enforced pass/fail criteria for this gate.
**If it fails:**
- Build stops
- Re-run Phase 1 with a more detailed input
- Or edit the spec in `.mls/mls.db` and retry

**Example event:**

```json
{
  "type": "gate",
  "name": "spec-completeness",
  "passed": true,
  "timestamp": 1774471427000
}
```

---

## Gate 2: Task-Breakdown Validation

**When:** After Phase 2 (task breakdown)

**What it checks (deterministic CODE):**
- All tasks have valid IDs (TASK-001, TASK-002, ...)
- All tasks have a type (database, backend, frontend, test, infra)
- All tasks have acceptance criteria
- No circular dependencies between tasks

**If it fails:**
- Build stops
- Error message explains what's invalid
- Re-run Phase 2 or edit tasks in database

**Example event:**

```json
{
  "type": "gate",
  "name": "task-breakdown",
  "passed": false,
  "issues": ["Task TASK-003 missing acceptance criteria"],
  "timestamp": 1774471440000
}
```

---

## Inline Checks (No Gate Event)

### Test Exit Code

After impl-engineer implements a task, tests are run deterministically:

```bash
npm test  # or pytest, cargo test, etc.
```

If exit code ≠ 0, implementation failed. Loop back to refine.

### Linter Exit Code

After tests pass:

```bash
npm run lint  # or equivalent
```

If linter fails, fix before code review.

### Code Review Verdict

**mls-code-reviewer** evaluates:
- Does code match acceptance criteria?
- Are there bugs?
- Security issues?
- Spec violations?

If reviewer rejects, loop back to implementation (max 5 iterations).

---

## Reading Gate Results

### On Dashboard

Gates appear in the event log (top right). Look for:

```
[✓ GATE] spec-completeness PASSED
[✗ GATE] task-breakdown FAILED: Task TASK-002 missing type
```

### In JSONL Logs

```bash
cat .mls/sessions/*.jsonl | jq 'select(.type == "gate")'
```

---

## What Happens If a Gate Fails

1. **Orchestrator pauses** — No Phase 3 if Phase 2 fails
2. **Event emitted** — Dashboard shows failure
3. **Build logged** — Failure recorded in JSONL
4. **Options:**
   - Edit the spec/tasks in database and retry Phase 1/2
   - Or start a new `/build` with refined input

---

## Best Practices

1. **Be specific in descriptions** — Vague specs fail completeness gate
2. **Include context** — Reference design docs, existing APIs, constraints
3. **State acceptance criteria upfront** — Reduces iteration

Example of good input:

```
/build implement email verification for password reset using SendGrid.
Spec: see @docs/auth-design.md
Tests: empty email error, invalid token, expired token, success.
Database: add reset_token, reset_expires_at, reset_email_sent_at to users.
```

---

## Next Steps

- **[Quick Start](./quick-start.md)** — Run your first build
- **[Advanced: Debugging](../advanced/debugging.md)** — Troubleshooting failed gates
