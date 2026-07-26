# My Little Scrum Team — VS Code Extension

A coordinated team of AI agents in your editor. Spec, plan, implement, review, and ship features with `@mlst` in Copilot Chat.

## Commands

| Command | Description |
|---------|-------------|
| `@mlst /run` | Start or continue the full workflow (auto-detects phase) |
| `@mlst /refine [idea]` | Collaboratively refine an idea before autonomous execution |
| `@mlst /spec [request]` | Write a detailed technical specification |
| `@mlst /tasks [input]` | Break a spec into atomic, actionable tasks |
| `@mlst /implement [task]` | Get implementation guidance for a task |
| `@mlst /design [task]` | Create UI/UX design specifications |
| `@mlst /review [code]` | Get structured, prioritized code review feedback |
| `@mlst /test [code]` | Generate comprehensive tests |

## Workflow

```
/refine → /spec → /tasks → /implement → /test → /review → commit
```

Or use `/run` to let the team lead auto-detect where you are and route accordingly.

## Installation

### Prerequisites

- VS Code 1.93.0+
- GitHub Copilot (or another VS Code Language Model provider)

### Install from source

There are no packaged releases yet — build the `.vsix` yourself:

```bash
cd packages/mlst-vscode
npm install
npm run compile                  # stages resources/ from the repo root, then tsc
npx @vscode/vsce package         # produces my-little-scrum-team-<version>.vsix
```

Then install it:
- **VS Code UI:** Extensions view (`⇧⌘X`) → `···` menu → Install from VSIX…
- **Command Palette:** `⇧⌘P` → "Extensions: Install from VSIX…"
- **CLI:** `code --install-extension my-little-scrum-team-<version>.vsix`

Reload VS Code, open Copilot Chat, and type `@mlst`.

## Development

```bash
cd packages/mlst-vscode
npm install
npm run compile
npm test          # vitest — resource integrity, loaders, command wiring
```

Press `F5` to launch the Extension Development Host.

Note: the agents, skills, templates, and commands the extension uses at runtime
are **staged, not authored, here** — `scripts/copy-resources.js` copies them
from the repo root into the gitignored `resources/` directory on every compile.
Edit the shared files at the repo root (or the package-local
`agents/team-lead.md`), never the staged copies.
