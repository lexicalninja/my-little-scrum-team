# /convert-to-extension

Convert a Claude Code plugin into a fully functional VS Code Chat Extension using the scrum team workflow.

## Usage

```
/my-little-scrum-team:convert-to-extension [plugin-path]
```

## Arguments

- `plugin-path` (optional): Relative path to the plugin folder to convert. If not provided, assumes the current workspace root is the plugin.

## Behavior

This command orchestrates the full scrum team workflow to convert a plugin into a VS Code Chat Extension. You (the main conversation) are the orchestrator — you spawn specialist agents directly using the Agent tool.

### What happens when you run this command:

**Phase 0 — Idea Refinement (collaborative):**
- Use the **convert-to-extension** skill to understand the conversion scope
- Ask clarifying questions about publisher ID, preferred extension name, which skills should become slash commands, etc.
- Propose an approach and get user agreement before proceeding

**Phase 1 — Specification:**
- Spawn **specification-writer** to analyze the plugin folder (agents, skills, templates, metadata)
- It creates a detailed conversion specification: what maps to what, extension structure, command routing

**Phase 2 — Task Breakdown:**
- Spawn **scrum-master** to break the specification into atomic tasks:
  - Scaffold extension directory
  - Create package.json with chat participant config
  - Implement extension.ts, participant.ts, resourceLoader.ts, workspaceFiles.ts, lmAgent.ts
  - Implement one command handler per skill
  - Create copy-resources build script
  - Set up launch.json / tasks.json
  - Create CI/CD workflow
  - Write README with install instructions
- Tasks are ordered by dependency

**Phase 3 — Execution:**
- Spawn **infrastructure-engineer** for scaffold, build pipeline, CI/CD, and VS Code config
- Spawn **implementation-engineer** for TypeScript source files
- Spawn **test-runner** to validate the build compiles with zero errors
- Spawn **code-reviewer-feedback** to review the implementation

**Phase 4 — Completion:**
- Verify the validation checklist
- Provide a summary of what was built and how to test it

### Key context to provide agents:

Feed the **convert-to-extension** skill content as domain knowledge to all agents. This ensures:
- Specification-writer knows the VS Code Chat Participant API patterns
- Scrum-master creates the right task breakdown for extension development
- Implementation-engineer follows correct patterns (vscode.workspace.fs, not Node fs; streaming responses; resource caching)
- Infrastructure-engineer sets up the right build pipeline (prebuild resource copy, TypeScript compilation)

## Example

```
User: /convert-to-extension plugins/my-little-scrum-team
```

The orchestrator begins Phase 0 by analyzing the plugin and asking:
- What should the VS Code extension display name be?
- What publisher ID should be used?
- Which skills should become slash commands (all, or a subset)?
- Are there any skills that should be grouped or renamed for the extension?

After agreement, the team proceeds autonomously through specification → tasks → implementation → review → completion.

## Prerequisites

- Current workspace should be the monorepo containing the plugin
- The plugin folder must exist with a valid structure (agents/, skills/, .claude-plugin/plugin.json)
- Node.js 20+, VS Code 1.93+, TypeScript 5.3+ (for build verification)

## Output

The extension is created at `plugins/<plugin-name>-extension/` alongside the original plugin, containing:
- Full TypeScript source implementing the VS Code Chat Participant API
- Build pipeline that copies resources from the source plugin
- Launch configuration for F5 debugging
- GitHub Actions workflow for tagged releases
- README with installation instructions
