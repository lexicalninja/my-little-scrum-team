import * as vscode from 'vscode';
import { ResourceLoader } from '../resourceLoader';
import { WorkspaceFiles } from '../workspaceFiles';
import { selectModel, sendPromptStreaming } from '../lmAgent';

export async function handleConvertToExtension(
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
    resources: ResourceLoader
): Promise<void> {
    const ws = new WorkspaceFiles();
    const model = await selectModel();

    stream.markdown('## Convert Plugin to VS Code Extension\n\n');

    stream.progress('Loading resources...');
    const [teamLeadAgent, convertSkill, convertCommand] = await Promise.all([
        resources.getAgent('team-lead'),
        resources.getSkill('convert-to-extension'),
        resources.getCommand('convert-to-extension'),
    ]);

    const pluginPath = request.prompt.trim() || 'plugins/my-little-scrum-team';

    // Read plugin structure from workspace if it exists
    stream.progress(`Analyzing plugin at ${pluginPath}...`);
    const pluginFiles = await ws.readDirRecursive(pluginPath);
    const pluginInventory = Object.keys(pluginFiles)
        .filter((p) => !p.includes('node_modules') && !p.includes('.git'))
        .join('\n');

    const prompt = `${teamLeadAgent}

---

## Convert-to-Extension Skill

${convertSkill}

---

## Convert-to-Extension Command Reference

${convertCommand}

---

## Plugin to Convert

Path: \`${pluginPath}\`

### Plugin File Inventory

${pluginInventory || '(plugin path not found in workspace — provide the path as an argument)'}

---

## Instructions

You are the team-lead agent orchestrating a plugin-to-extension conversion.

Follow the convert-to-extension skill instructions to analyze the plugin and guide the conversion.

**Phase 0 — Analyze the plugin:**
1. Review the file inventory above
2. Identify the plugin metadata (name, description, version, author)
3. Inventory agents, skills, templates, and commands
4. Ask any clarifying questions needed (publisher ID, display name, which skills become commands, etc.)

**Phase 1 — Propose the conversion plan:**
- Map each skill/command to a VS Code slash command
- Describe the extension structure that will be created
- Identify which agents map to which workflows

Present the analysis and ask for the user's go-ahead before proceeding with the full scrum team workflow.

Plugin path provided: \`${pluginPath}\``;

    stream.progress('Analyzing plugin and planning conversion...');
    await sendPromptStreaming(model, prompt, stream, token);

    stream.markdown(`\n\n---\n\n**Once you approve the plan, the team will proceed through:**\n- specification-writer → detailed conversion spec\n- scrum-master → atomic task breakdown\n- infrastructure-engineer → scaffold + build pipeline\n- implementation-engineer → TypeScript source files\n- test-runner + code-reviewer-feedback → validation\n`);
}
