---
name: convert-to-extension
description: Converts a Claude Code plugin into a fully functional VS Code Chat Extension. Use when a plugin folder (with agents, skills, commands, templates, hooks, and markdown files) needs to be packaged as a VS Code extension using the Chat Participant API. Handles the full lifecycle from analysis through scaffolding, implementation, build pipeline, CI/CD, and distribution.
---

# Convert Plugin to VS Code Chat Extension

## Instructions

1. Analyze the plugin folder structure and inventory all components
2. Scaffold the extension directory alongside the plugin
3. Implement all extension source files
4. Set up the build pipeline with resource copying
5. Configure testing (launch.json / tasks.json)
6. Create CI/CD workflow for tagged releases
7. Write distribution README with install instructions
8. Validate the build compiles with zero errors

## Prerequisites

- The plugin folder exists (e.g., `plugins/<plugin-name>/`)
- The extension will be created alongside it (e.g., `plugins/<plugin-name>-extension/`)
- Node.js 20+, npm, VS Code 1.93+, TypeScript 5.3+

## Conversion Process

### Phase 1: Analyze the Plugin

Read every file in the plugin folder and inventory its structure across these categories.

#### 1A — Plugin Metadata

Look for a manifest file (e.g., `.claude-plugin/plugin.json`, `package.json`, or similar). Extract:

- **name** — becomes the extension `name` and chat participant name
- **description** — becomes the extension `description` and participant description
- **version** — starting version
- **author / publisher**

#### 1B — Agents

Read every `.md` file in `agents/`. For each agent, record:

- **Role definition** — what the agent does, its perspective
- **Constraints** — e.g., "no fabrication" rules
- **Focus areas** — specific evaluation or generation criteria
- **Output format** — how the agent structures its work

Build a full list of agent names (filenames without `.md`). Classify each as "core" (used in most workflows) vs. "specialized" (used conditionally). Note inter-agent relationships (debates, parallel runs, sequential handoffs).

#### 1C — Skills

Read every `SKILL.md` in `skills/*/`. For each skill, record:

- **Trigger** — the slash command name (from folder name or `#` heading)
- **Inputs** — what files/directories it reads from the workspace
- **Outputs** — what files it writes to the workspace
- **Phases** — step-by-step execution flow
- **Agent usage** — which agents are invoked and how (parallel, debate, sequential)
- **Templates used** — which templates from `templates/` it references

Create a mapping table:

| Skill Folder | Slash Command | Agents Used | Templates Used | Inputs | Outputs |
| ------------ | ------------- | ----------- | -------------- | ------ | ------- |

#### 1D — Templates

Read every `.md` file in `templates/`. Record all template names.

#### 1E — Commands

Read every `.md` file in `commands/` if the directory exists. For each command, record:

- **Command name** — the slash command it exposes (from filename or `## Usage` heading)
- **Description** — what it does
- **Arguments** — any parameters it accepts
- **Behavior** — which agents/skills it delegates to and how

Commands are higher-level entry points than skills — they describe complete user-facing workflows. Each command in `commands/` should become a slash command in the extension, in addition to any skills promoted to commands.

#### 1F — Hooks

Check for a `hooks/` directory or hook definitions in `.claude/settings.json`. If hooks exist, record:

- **Event** — which lifecycle event triggers the hook (e.g., `PreToolUse`, `PostToolUse`, `Stop`)
- **Command** — the shell command that runs
- **Purpose** — what the hook enforces or automates

Hooks are not directly converted to extension commands, but document them in the extension README so users know what behaviors the original plugin relied on and how to replicate them (e.g., as VS Code tasks or extension-side validation).

#### 1G — Other Resources

Note additional files: writing standards, style guides, settings, permissions, capability declarations.

### Phase 2: Scaffold the Extension

Create the extension directory at `plugins/<plugin-name>-extension/` with this structure:

```
<plugin-name>-extension/
├── package.json
├── tsconfig.json
├── .gitignore
├── .vscodeignore
├── README.md
├── scripts/
│   └── copy-resources.js
└── src/
    ├── extension.ts
    ├── participant.ts
    ├── resourceLoader.ts
    ├── workspaceFiles.ts
    ├── lmAgent.ts
    └── commands/
        └── (one .ts file per skill/command)
```

#### 2A — package.json

```json
{
  "name": "<plugin-name>",
  "displayName": "<Display Name>",
  "description": "<description from plugin metadata>",
  "version": "0.0.1",
  "publisher": "<publisher-id>",
  "engines": {
    "vscode": "^1.93.0"
  },
  "categories": ["Chat"],
  "activationEvents": [],
  "main": "./out/extension.js",
  "contributes": {
    "chatParticipants": [
      {
        "id": "<plugin-name>.participant",
        "fullName": "<Display Name>",
        "name": "<plugin-name>",
        "description": "<participant description>",
        "isSticky": true,
        "commands": [
          {
            "name": "<command-name>",
            "description": "<command description>"
          }
        ]
      }
    ]
  },
  "scripts": {
    "vscode:prepublish": "npm run compile",
    "prebuild": "node scripts/copy-resources.js",
    "compile": "npm run prebuild && tsc -p ./",
    "watch": "npm run prebuild && tsc -watch -p ./",
    "lint": "eslint src --ext ts"
  },
  "devDependencies": {
    "@types/vscode": "^1.93.0",
    "@types/node": "^20.0.0",
    "typescript": "^5.3.0"
  }
}
```

Key decisions:

- `name` in `commands[]` comes from skill folder names — prefer short, memorable names
- `isSticky: true` keeps the participant selected across messages

#### 2B — tsconfig.json

```jsonc
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2022",
    "outDir": "out",
    "rootDir": "src",
    "lib": ["ES2022"],
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "out"]
}
```

#### 2C — .gitignore

```
out/
node_modules/
*.vsix
.vscode-test/
resources/
```

`resources/` is gitignored because it's populated at build time from the source plugin.

#### 2D — .vscodeignore

```
.vscode/**
.vscode-test/**
src/**
scripts/**
.gitignore
tsconfig.json
**/*.map
node_modules/**
```

### Phase 3: Implement the Extension

#### 3A — extension.ts (Entry Point)

Minimal — instantiate and register the participant:

```typescript
import * as vscode from 'vscode';
import { <ParticipantClass> } from './participant';

let participant: <ParticipantClass>;

export function activate(context: vscode.ExtensionContext) {
    participant = new <ParticipantClass>(context);
    context.subscriptions.push(participant.register());
}

export function deactivate() {}
```

#### 3B — participant.ts (Chat Participant & Router)

Creates a `vscode.ChatParticipant`, routes slash commands to handlers, handles general questions with a system prompt describing the agent team:

```typescript
import * as vscode from 'vscode';
import { ResourceLoader } from './resourceLoader';
import { selectModel, sendPromptStreaming } from './lmAgent';

const PARTICIPANT_ID = '<plugin-name>.participant';

export class <ParticipantClass> {
    private resources: ResourceLoader;

    constructor(private context: vscode.ExtensionContext) {
        this.resources = new ResourceLoader(context.extensionUri);
    }

    register(): vscode.Disposable {
        const participant = vscode.chat.createChatParticipant(
            PARTICIPANT_ID,
            this.handleRequest.bind(this)
        );
        participant.iconPath = new vscode.ThemeIcon('organization');
        return participant;
    }

    private async handleRequest(
        request: vscode.ChatRequest,
        context: vscode.ChatContext,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<void> {
        try {
            switch (request.command) {
                case '<command>':
                    await handle<Command>(request, stream, token, this.resources);
                    break;
                default:
                    await this.handleGeneralQuestion(request, stream, token);
                    break;
            }
        } catch (error) {
            if (error instanceof Error) {
                stream.markdown(`\n\n### ⚠ Error\n\n${error.message}\n`);
                if (error.message.includes('No workspace folder')) {
                    stream.markdown('\nOpen a workspace folder first, then try again.\n');
                }
                if (error.message.includes('No language models')) {
                    stream.markdown('\nMake sure you have GitHub Copilot or another LM provider active.\n');
                }
            } else {
                stream.markdown('\n\n### ⚠ Unexpected Error\n\nSomething went wrong. Please try again.\n');
            }
        }
    }

    private async handleGeneralQuestion(
        request: vscode.ChatRequest,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<void> {
        const model = await selectModel();
        // Build system prompt describing agent team, available commands, domain context
        // Stream response to user
    }
}
```

General question handler design:

- Describe the full agent team and their roles
- List all available commands with descriptions
- Include persistent context (writing standards, domain rules)
- Suggest the appropriate command when the question maps to a specific workflow

#### 3C — resourceLoader.ts (Bundled Resource Access)

Loads markdown files from the extension's `resources/` directory with caching:

```typescript
import * as vscode from 'vscode';

export class ResourceLoader {
    private cache = new Map<string, string>();

    constructor(private extensionUri: vscode.Uri) {}

    private resourceUri(...segments: string[]): vscode.Uri {
        return vscode.Uri.joinPath(this.extensionUri, 'resources', ...segments);
    }

    private async readResource(...segments: string[]): Promise<string> {
        const key = segments.join('/');
        if (this.cache.has(key)) return this.cache.get(key)!;
        const uri = this.resourceUri(...segments);
        const content = Buffer.from(
            await vscode.workspace.fs.readFile(uri)
        ).toString('utf-8');
        this.cache.set(key, content);
        return content;
    }

    async getAgentDefinition(agentName: string): Promise<string> {
        return this.readResource('agents', `${agentName}.md`);
    }

    async getAllAgentDefinitions(): Promise<Record<string, string>> {
        const agents = [/* list all agent filenames without .md */];
        const entries = await Promise.all(
            agents.map(async (name) => [name, await this.getAgentDefinition(name)] as const)
        );
        return Object.fromEntries(entries);
    }

    async getTemplate(templateName: string): Promise<string> {
        return this.readResource('templates', `${templateName}.md`);
    }
}
```

Design principles:

- One method per resource type (agents, templates, writing standards, etc.)
- In-memory cache keyed by path segments
- Hard-code the list of resource names rather than dynamically scanning
- Distinguish "core" vs "all" agent sets if the plugin has specialized agents

#### 3D — workspaceFiles.ts (Workspace I/O)

Read/write access to the user's workspace using `vscode.workspace.fs`:

```typescript
import * as vscode from 'vscode';

export class WorkspaceFiles {
    private workspaceRoot: vscode.Uri;

    constructor() {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
            throw new Error('No workspace folder is open. Open a folder first.');
        }
        this.workspaceRoot = folders[0].uri;
    }

    uri(...segments: string[]): vscode.Uri {
        return vscode.Uri.joinPath(this.workspaceRoot, ...segments);
    }

    async exists(relativePath: string): Promise<boolean> { /* stat check */ }
    async readFile(relativePath: string): Promise<string> { /* readFile + decode */ }
    async readDir(relativePath: string): Promise<Record<string, string>> { /* non-recursive */ }
    async readDirRecursive(relativePath: string): Promise<Record<string, string>> { /* recursive */ }
    async writeFile(relativePath: string, content: string): Promise<void> { /* encode + writeFile */ }
    async createDirectory(relativePath: string): Promise<void> { /* createDirectory */ }
    async listFiles(relativePath: string): Promise<string[]> { /* file names in dir */ }
    async listDirs(relativePath: string): Promise<string[]> { /* subdirectory names */ }
}
```

Key patterns:

- Always use `vscode.workspace.fs` — never Node.js `fs` — for workspace files (supports remote workspaces)
- All methods accept relative paths from workspace root
- Fail gracefully: `exists()` catches errors and returns false

#### 3E — lmAgent.ts (Language Model Utilities)

Wraps the VS Code Language Model API:

```typescript
import * as vscode from 'vscode';

export interface AgentRequest { name: string; prompt: string; }
export interface AgentResponse { name: string; text: string; }

export async function selectModel(): Promise<vscode.LanguageModelChat> {
    const models = await vscode.lm.selectChatModels();
    if (models.length === 0) throw new Error('No language models available.');
    models.sort((a, b) => (b.maxInputTokens ?? 0) - (a.maxInputTokens ?? 0));
    return models[0];
}

export async function sendPrompt(
    model: vscode.LanguageModelChat, prompt: string, token: vscode.CancellationToken
): Promise<string> { /* collect full response */ }

export async function sendPromptStreaming(
    model: vscode.LanguageModelChat, prompt: string,
    stream: vscode.ChatResponseStream, token: vscode.CancellationToken
): Promise<string> { /* stream chunks to chat UI */ }

export async function runAgentsParallel(
    model: vscode.LanguageModelChat, agents: AgentRequest[],
    stream: vscode.ChatResponseStream, token: vscode.CancellationToken
): Promise<AgentResponse[]> { /* run multiple prompts in parallel */ }

export async function runDebate(
    model: vscode.LanguageModelChat, rounds: number,
    buildPrompts: (round: number, prev?: AgentResponse[]) => AgentRequest[],
    convergenceTest: (outputs: AgentResponse[]) => boolean,
    stream: vscode.ChatResponseStream, token: vscode.CancellationToken
): Promise<{ rounds: AgentResponse[][]; converged: boolean }> { /* multi-round debate */ }

export function formatAgentOutputs(outputs: AgentResponse[]): string {
    return outputs.map((o) => `## ${o.name}\n\n${o.text}`).join('\n\n---\n\n');
}
```

When to use each function:

- `sendPromptStreaming` — user should see output as it generates (primary user-facing work)
- `sendPrompt` — collecting output for use in a later prompt (intermediate agent work)
- `runAgentsParallel` — multiple agents can generate independently, then be combined
- `runDebate` — agents need to iterate toward consensus (review/alignment phases)

#### 3F — Command Handlers (one per skill)

Each skill becomes a file in `src/commands/<command>.ts`.

**Mapping SKILL.md Phases to TypeScript:**

For each phase in the skill's SKILL.md:

1. **Read phase description** — understand inputs, processing, outputs
2. **Map file I/O** — `Read file` → `ws.readFile()`, `Write file` → `ws.writeFile()`, `Glob` → `ws.readDirRecursive()`
3. **Map agent invocations:**

   - Single agent → `sendPrompt()` or `sendPromptStreaming()`
   - Multiple agents in parallel → `runAgentsParallel()`
   - Debate/consensus → `runDebate()`
4. **Map template usage** — `resources.getTemplate('template-name')`
5. **Map user-facing output** — `stream.markdown()` for content, `stream.progress()` for status

**Command handler skeleton:**

```typescript
import * as vscode from 'vscode';
import { ResourceLoader } from '../resourceLoader';
import { WorkspaceFiles } from '../workspaceFiles';
import { selectModel, sendPromptStreaming, sendPrompt, runAgentsParallel } from '../lmAgent';

export async function handle<Command>(
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
    resources: ResourceLoader
): Promise<void> {
    const ws = new WorkspaceFiles();
    const model = await selectModel();

    stream.markdown('## <Command Title>\n\n');

    // ── Phase 1 ─────────────────────────────────────────
    stream.progress('Phase 1 — <description>...');
    // Read inputs, validate they exist

    // ── Phase 2 ─────────────────────────────────────────
    stream.progress('Phase 2 — <description>...');
    // Build prompts, invoke agents

    // ── Phase N — Output ────────────────────────────────
    stream.progress('Writing output files...');
    // Write results, show summary with next-step guidance
}
```

**Prompt construction:**

For each agent invocation in a SKILL.md phase:

1. Start with the agent's role definition (from `agents/<name>.md`)
2. Include the skill's phase instructions as the task description
3. Inject context — solicitation content, previous phase outputs, templates
4. Include writing standards if the phase produces prose
5. Specify output format — use `<!-- BEGIN/END -->` markers for extractable sections
6. Include the NO FABRICATION rule if the plugin enforces it

**Extracting structured output:**

```typescript
function extractSection(text: string, sectionName: string): string | null {
    const beginMarker = `<!-- BEGIN ${sectionName} -->`;
    const endMarker = `<!-- END ${sectionName} -->`;
    const startIdx = text.indexOf(beginMarker);
    const endIdx = text.indexOf(endMarker);
    if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return null;
    return text.substring(startIdx + beginMarker.length, endIdx).trim();
}
```

Always write a fallback: if markers aren't found, write the full output to a single file.

**Orchestrator command (/run pattern):**

If the plugin has a "run everything" skill, implement as a state-detecting orchestrator:

```typescript
// Check existing output files to detect current phase
const hasAnalysis = await ws.exists('output/analysis.md');
const hasOutline = await ws.exists('output/outline.md');

// Route to the next incomplete phase
if (!hasAnalysis) {
    await handleAnalyze(request, stream, token, resources);
    return;
}
if (!hasOutline) {
    await handleOutline(request, stream, token, resources);
    return;
}
```

VS Code Chat is single-turn — user re-invokes the command to advance through phases. Each invocation detects where they left off.

### Phase 4: Build Pipeline

#### 4A — Resource Copy Script

Create `scripts/copy-resources.js` to copy resources from the source plugin at build time. The plugin folder is the **single source of truth** — resources are never duplicated in version control.

```javascript
const fs = require('fs');
const path = require('path');

const PLUGIN_ROOT = path.resolve(__dirname, '..', '..', '<plugin-name>');
const RESOURCES_ROOT = path.resolve(__dirname, '..', 'resources');

const COPIES = [
    { src: 'agents', dest: 'agents' },
    { src: 'templates', dest: 'templates' },
    { src: 'skills', dest: 'skills' },
    { src: 'commands', dest: 'commands' },
    // { src: 'hooks', dest: 'hooks' },  // uncomment if the plugin has a hooks/ directory
// One entry per resource directory or file

];

function copyRecursive(src, dest) {
    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
        fs.mkdirSync(dest, { recursive: true });
        for (const child of fs.readdirSync(src)) {
            copyRecursive(path.join(src, child), path.join(dest, child));
        }
    } else {
        fs.copyFileSync(src, dest);
    }
}

if (fs.existsSync(RESOURCES_ROOT)) {
    fs.rmSync(RESOURCES_ROOT, { recursive: true });
}
fs.mkdirSync(RESOURCES_ROOT, { recursive: true });

for (const { src, dest } of COPIES) {
    const srcPath = path.join(PLUGIN_ROOT, src);
    const destPath = path.join(RESOURCES_ROOT, dest);
    if (!fs.existsSync(srcPath)) {
        console.warn(`⚠ Source not found: ${srcPath}`);
        continue;
    }
    copyRecursive(srcPath, destPath);
    console.log(`✓ ${src} → resources/${dest}`);
}
```

This runs via the `prebuild` npm script before every compile. Node.js `fs` is fine here — runs at build time on the developer's machine.

#### 4B — Build & Verify

```bash
cd plugins/<plugin-name>-extension
npm install
npm run compile
```

Expected: `prebuild` copies resources, `tsc` compiles to `out/`, zero errors.

#### 4C — Git Hygiene

Ensure these are never tracked:

- `out/` — compiled output
- `node_modules/` — dependencies
- `resources/` — copied from plugin at build time
- `*.vsix` — build artifact

If already committed, remove:

```bash
git rm -r --cached plugins/<plugin-name>-extension/out/
git rm -r --cached plugins/<plugin-name>-extension/node_modules/
git rm -r --cached plugins/<plugin-name>-extension/resources/
```

### Phase 5: Testing Setup

Create workspace-level VS Code config so the extension launches with F5.

#### 5A — .vscode/launch.json

```jsonc
{
    "version": "0.2.0",
    "configurations": [
        {
            "name": "Run <Display Name> Extension",
            "type": "extensionHost",
            "request": "launch",
            "args": [
                "--extensionDevelopmentPath=${workspaceFolder}/plugins/<plugin-name>-extension"
            ],
            "outFiles": [
                "${workspaceFolder}/plugins/<plugin-name>-extension/out/**/*.js"
            ],
            "preLaunchTask": "npm: watch - <plugin-name>-extension"
        }
    ]
}
```

If `launch.json` already exists, **append** to the `configurations` array.

#### 5B — .vscode/tasks.json

```jsonc
{
    "version": "2.0.0",
    "tasks": [
        {
            "type": "npm",
            "script": "watch",
            "path": "plugins/<plugin-name>-extension",
            "label": "npm: watch - <plugin-name>-extension",
            "problemMatcher": "$tsc-watch",
            "isBackground": true,
            "presentation": { "reveal": "never" },
            "group": { "kind": "build", "isDefault": true }
        },
        {
            "type": "npm",
            "script": "compile",
            "path": "plugins/<plugin-name>-extension",
            "label": "npm: compile - <plugin-name>-extension",
            "problemMatcher": "$tsc"
        }
    ]
}
```

If `tasks.json` already exists, **append** to the `tasks` array.

### Phase 6: CI/CD (GitHub Actions)

Create `.github/workflows/release-<plugin-name>-extension.yml`.

#### Tagging Strategy

Use prefixed tags in a monorepo: `<plugin-name>-extension/v0.0.1`

#### Workflow

```yaml
name: Release <Display Name> Extension

on:
  push:
    tags:
      - '<plugin-name>-extension/v*'

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: write

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install dependencies
        working-directory: plugins/<plugin-name>-extension
        run: npm ci

      - name: Package extension
        working-directory: plugins/<plugin-name>-extension
        run: npx @vscode/vsce package

      - name: Upload .vsix to GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          files: plugins/<plugin-name>-extension/*.vsix
```

### Phase 7: Distribution README

Add installation instructions to the extension's README.md:

```markdown
## Installation

### Prerequisites
- VS Code 1.93.0+
- GitHub Copilot (or another VS Code Language Model provider)

### Install from GitHub Releases
1. Go to the latest release.
2. Under **Assets**, download the `.vsix` file.
3. Install in VS Code:
   - **VS Code UI:** Extensions view (⇧⌘X) → ··· menu → Install from VSIX…
   - **Command Palette:** ⇧⌘P → "Extensions: Install from VSIX…"
   - **CLI:** `code --install-extension <plugin-name>-0.0.1.vsix`
4. Reload VS Code.
5. Type `@<plugin-name>` in Copilot Chat.
```

## Validation Checklist

Before considering the conversion complete, verify:

- [ ] `npm run compile` succeeds with zero errors
- [ ] F5 launches the Extension Development Host
- [ ] `@<name>` appears in Copilot Chat
- [ ] Each slash command is listed in autocomplete
- [ ] At least one command executes end-to-end without errors
- [ ] `.gitignore` excludes `out/`, `node_modules/`, `resources/`, `*.vsix`
- [ ] `git status` shows no tracked build artifacts
- [ ] GitHub Actions workflow exists for tagged releases
- [ ] README has installation instructions

## Common Patterns

- **Phase progress**: Always call `stream.progress('Phase N — description...')` before each phase
- **Input validation**: Check for required files at start and show helpful message if missing
- **Fallback output**: If `extractSection()` returns null, write raw output to a single file
- **Next-step guidance**: End every command with "Next: run `@name /next-command`"

## Common Pitfalls

- **Never use Node.js `fs` for workspace files** — use `vscode.workspace.fs` (supports remote workspaces)
- **Node.js `fs` is fine for the copy-resources script** — runs at build time
- **`vscode.lm.selectChatModels()` can return empty** — always check and throw descriptive error
- **Chat API is single-turn** — can't ask user for input mid-command; use state detection instead
- **Prompts can exceed model context** — for very large inputs, consider chunking or summarizing
- **`stream.markdown()` accumulates** — don't re-render full output, just append