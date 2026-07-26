# Commands

MLST adds two commands to pi.

## /build

Run a full MLST sprint.

### Syntax

```
/build <input>
```

### Input Formats

**String description:**
```
/build add user authentication
```

**File path:**
```
/build PRD.md
```

**Inline @file:**
```
/build implement @PRD.md and fix @bugs.md
```

**GitHub issue:**
```
/build #25
/build owner/repo#42
```

### Options

(None currently. Behavior controlled via `.mlst/config.json`)

### Example

```
/build add a health check endpoint that returns {"status": "ok"}
```

---

## /prd

Run an interactive planning session that produces a PRD (product requirements
document), ready to hand to `/build`.

### Syntax

```
/prd <idea>
```

### Example

```
/prd a CLI tool that syncs bookmarks between browsers
```

The session asks clarifying questions and iterates on scope with you, then
writes out a PRD. Feed the result to `/build` (directly, or via a file path /
`@file` reference).

---

## /mlst-status

Show current sprint status.

### Syntax

```
/mlst-status
```

### Example Output

```
Sprint #1: feature
Phase: 3 (Implementation)
Tasks: 3 total (1 in-progress, 2 complete)
Tests: 8/9 passing
Cost: $0.24 so far
```

### Options

(None)

---

## Global Flags

All commands inherit pi's global flags. Common ones:

```
pi --help                        Show all commands
pi /login                        Authenticate with a model provider
pi /model <name>                 Switch models mid-session
pi --mode json                   Output JSON (for automation)
```

---

## Next Steps

- **[Quick Start](../guide/quick-start.md)** — Run your first build
- **[Input Formats](../guide/input-formats.md)** — Detail on `/build` inputs
