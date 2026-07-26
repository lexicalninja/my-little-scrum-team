import * as vscode from 'vscode';
import { ResourceLoader } from '../resourceLoader';
import { WorkspaceFiles } from '../workspaceFiles';
import { selectModel, sendPromptStreaming, slugify, todayISO } from '../lmAgent';

export async function handleTasks(
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
    resources: ResourceLoader
): Promise<void> {
    const ws = new WorkspaceFiles();
    const model = await selectModel();

    stream.markdown('## Breaking Down Tasks\n\n');

    stream.progress('Loading resources...');
    const [scrumMasterAgent, implPlannerSkill, taskTemplate] = await Promise.all([
        resources.getAgent('scrum-master'),
        resources.getSkill('implementation-planner'),
        resources.getTemplate('task-breakdown'),
    ]);

    // Load specifications
    stream.progress('Reading specifications...');
    const specs = await ws.readDir('specs');
    const specContext = Object.entries(specs)
        .map(([name, content]) => `### ${name}\n\n${content}`)
        .join('\n\n---\n\n');

    if (!specContext && !request.prompt.trim()) {
        stream.markdown('No specifications found in `specs/` and no input provided.\n\nRun `@mls /spec` first to create a specification, or provide your specification directly in this message.\n');
        return;
    }

    const userInput = request.prompt.trim();

    const prompt = `${scrumMasterAgent}

---

## Available Skills

### Implementation Planner
${implPlannerSkill}

---

## Task Breakdown Template

Use this template structure for your output:

${taskTemplate}

---

${specContext ? `## Specifications\n\n${specContext}\n\n---\n\n` : ''}${userInput ? `## Additional Input\n\n${userInput}\n\n---\n\n` : ''}## Instructions

You are the scrum-master agent. Break down the specification(s) above into atomic, actionable tasks following the template.

Identify:
- Infrastructure tasks (database, CI/CD, environment)
- Design tasks (UI/UX work) — mark with **Type: Design** or **Needs Design: Yes**
- Implementation tasks (code)
- Testing tasks
- Documentation tasks

Order by dependencies. Identify tasks that can run in parallel.

Output the complete task breakdown wrapped in markers:

<!-- BEGIN TASK_BREAKDOWN -->
[complete task breakdown markdown]
<!-- END TASK_BREAKDOWN -->`;

    stream.progress('Breaking down tasks...');
    const fullOutput = await sendPromptStreaming(model, prompt, stream, token);

    const tasksContent = extractSection(fullOutput, 'TASK_BREAKDOWN');
    const slug = slugify(userInput.split('\n')[0].slice(0, 60) || 'tasks');
    const filename = `tasks/TASKS-${todayISO()}-${slug}.md`;

    const contentToSave = tasksContent ?? fullOutput;
    try {
        await ws.writeFile(filename, contentToSave);
        stream.markdown(`\n\n---\n\n**Task breakdown saved to \`${filename}\`.**\nNext: run \`@mls /implement\` to start implementing tasks, or \`@mls /design\` for design tasks.\n`);
    } catch {
        stream.markdown(`\n\n---\n\nNext: run \`@mls /implement\` to start implementing tasks.\n`);
    }
}

function extractSection(text: string, sectionName: string): string | null {
    const begin = `<!-- BEGIN ${sectionName} -->`;
    const end = `<!-- END ${sectionName} -->`;
    const startIdx = text.indexOf(begin);
    const endIdx = text.indexOf(end);
    if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return null;
    return text.substring(startIdx + begin.length, endIdx).trim();
}
