# My Little Scrum Team — VS Code Extension

A coordinated team of AI agents in your editor. Spec, plan, implement, review, and ship features with `@mls` in Copilot Chat.

## Commands

| Command | Description |
|---------|-------------|
| `@mls /run` | Start or continue the full workflow (auto-detects phase) |
| `@mls /refine [idea]` | Collaboratively refine an idea before autonomous execution |
| `@mls /spec [request]` | Write a detailed technical specification |
| `@mls /tasks [input]` | Break a spec into atomic, actionable tasks |
| `@mls /implement [task]` | Get implementation guidance for a task |
| `@mls /design [task]` | Create UI/UX design specifications |
| `@mls /review [code]` | Get structured, prioritized code review feedback |
| `@mls /test [code]` | Generate comprehensive tests |

## Workflow

```
/refine → /spec → /tasks → /implement → /test → /review → commit
```

Or use `/run` to let the team lead auto-detect where you are and route accordingly.

## Installation

### Prerequisites

- VS Code 1.93.0+
- GitHub Copilot (or another VS Code Language Model provider)

### Install from GitHub Releases

1. Go to the [latest release](https://github.com/lexicalninja/my-little-scrum-team/releases).
2. Under **Assets**, download the `.vsix` file.
3. Install in VS Code:
   - **VS Code UI:** Extensions view (`⇧⌘X`) → `···` menu → Install from VSIX…
   - **Command Palette:** `⇧⌘P` → "Extensions: Install from VSIX…"
   - **CLI:** `code --install-extension my-little-scrum-team-0.0.1.vsix`
4. Reload VS Code.
5. Open Copilot Chat and type `@mls`.

## Development

```bash
cd plugins/my-little-scrum-team-extension
npm install
npm run compile
```

Press `F5` from the repo root to launch the Extension Development Host.

## Releasing

Tag a commit with `my-little-scrum-team-extension/v<version>` to trigger the GitHub Actions release workflow:

```bash
git tag my-little-scrum-team-extension/v0.0.1
git push origin my-little-scrum-team-extension/v0.0.1
```
