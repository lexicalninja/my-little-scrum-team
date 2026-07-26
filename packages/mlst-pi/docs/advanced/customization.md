# Customizing Agents

MLST agents are defined as markdown files in the extension's `agents/` directory. There is no per-project `.mlst/agents/` override — all agents are loaded from the extension installation.

## Agent File Location

When MLST is installed via this plugin, the agent files live at:

```
packages/mlst-pi/
└── agents/
    ├── mlst-spec-writer.md
    ├── mlst-scrum-master.md
    ├── mlst-impl-engineer.md
    ├── mlst-test-runner.md
    ├── mlst-code-reviewer.md
    ├── mlst-designer.md
    └── mlst-infra-engineer.md
```

Each file is a markdown document with a YAML frontmatter header:

```markdown
---
name: mlst-impl-engineer
description: Makes failing tests pass. Receives pre-written test specs (RED) and writes the minimum code to turn them GREEN.
tools: read, edit, write, bash, grep, find, ls
---

You are an implementation engineer...
```

## How to Modify an Agent

Edit the corresponding `.md` file directly in the extension's `agents/` directory.

**Example:** Make the code reviewer stricter about test coverage:

```markdown
---
name: mlst-code-reviewer
description: Reviews code against acceptance criteria. Approves working code. Only rejects for bugs, security issues, or failing tests.
tools: read, grep, find, ls, bash
---

You are a code reviewer. Your job is to approve or reject.

## When to APPROVE
...

## Additional requirement
Reject if test coverage for new code is below 80%.
```

Restart your pi session after editing an agent file for the change to take effect.

## Influencing Agent Behavior via AGENTS.md

Every agent subprocess reads your project's `AGENTS.md` file (if it exists) for project-specific conventions. This is the safest way to guide agent behavior without editing extension files.

**Create `AGENTS.md` in your project root:**

```markdown
# Project Conventions

## Language & Framework
TypeScript, Node.js, ESM modules

## Code Style
- Use strict TypeScript
- Prefer `async/await` over raw Promises
- All public functions must have JSDoc comments

## Testing
- Use Vitest
- Co-locate test files as `*.test.ts`
- Aim for 80%+ coverage on new code

## Naming
- Files: kebab-case
- Classes: PascalCase
- Functions: camelCase
```

The `mlst-impl-engineer` agent explicitly reads this file before writing code.

## Contributing Changes Upstream

If your customization would benefit all users of this plugin, consider opening a pull request to the [my-little-scrum-team repository](https://github.com/lexicalninja/my-little-scrum-team) to update the agent files directly.

## Next Steps

- [Debug failures](./debugging.md) if agents are not behaving as expected
- [View orchestration](./orchestration.md) to understand agent coordination
- [Track costs](./cost-tracking.md) to optimize agent usage
