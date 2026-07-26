# Input Formats

`/build` accepts four ways to describe your feature.

## 1. String Description

Simple, natural language:

```
/build add a password reset flow
/build the login button should show an error when email is empty
/build implement dark mode toggle in settings
```

Use this for quick, straightforward features.

## 2. File Path

Point to a markdown file:

```
/build PRD.md
/build docs/spec.md
/build bugs/login-issue.md
```

File contents become the input. Useful for detailed specs, multi-page PRDs, or bug reports too long to type.

## 3. Inline @file References

Mix description with file references:

```
/build implement the auth flow described in @PRD.md
/build fix the issues listed in @bugs/critical.md and apply @design/color-system.md
```

The `@file` is replaced with file contents before processing.

## 4. GitHub Issues

Fetch an issue from GitHub:

```
/build #25
/build owner/repo#42
```

**Bare form** (`#25`) — Infers repo from `git remote get-url origin` in current directory. Requires `gh` CLI installed and authenticated.

**Explicit form** (`owner/repo#42`) — Fetches from that repo without touching git.

The issue is formatted as:
```
GitHub Issue #25: Add user authentication

This is the body of the issue...
```

Only **whole-input** references work. Embedded forms like `/build fix the bug in #25` don't expand.

## Choosing the Right Format

| Format | Best For |
|--------|----------|
| String | Quick features, one-liners |
| File Path | Detailed specs, long PRDs, multi-page docs |
| @file | Mixing description with external specs |
| GitHub Issue | Tracking features as issues, linking to original context |

## Best Practices

1. **Be specific** — Vague descriptions (e.g., "make it faster") lead to mediocre specs
2. **Include context** — Mention existing code, dependencies, design patterns
3. **State acceptance criteria** — What counts as done? (tests passing? UI matches design?)
4. **Reference related docs** — Use `@file` to include design specs, API docs, etc.

Example of good description:

```
/build add a password reset flow with email verification. 
Use the existing email service in lib/email.ts. 
Follow the design in @docs/auth-ui.md. 
Tests should cover: empty email error, invalid token, expired token, successful reset.
Database: add reset_token and reset_expires_at to users table.
```

## Next Steps

- **[Quick Start](./quick-start.md)** — Run your first build
- **[Build Phases](./phases.md)** — Understand what happens next
