import * as vscode from 'vscode';
import { ResourceLoader } from '../resourceLoader';
import { WorkspaceFiles } from '../workspaceFiles';
import { selectModel, sendPromptStreaming } from '../lmAgent';

export async function handleImplement(
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
    resources: ResourceLoader
): Promise<void> {
    const ws = new WorkspaceFiles();
    const model = await selectModel();

    stream.markdown('## Implementation Engineer\n\n');

    stream.progress('Loading resources...');
    const [implEngineerAgent, apiSkill, utilitySkill, componentSkill, gitCommitSkill] = await Promise.all([
        resources.getAgent('implementation-engineer'),
        resources.getSkill('api-implementer'),
        resources.getSkill('utility-implementer'),
        resources.getSkill('component-implementer'),
        resources.getSkill('git-commit-helper'),
    ]);

    // Load task documents
    stream.progress('Reading tasks...');
    const tasks = await ws.readDir('tasks');
    const taskContext = Object.entries(tasks)
        .map(([name, content]) => `### ${name}\n\n${content}`)
        .join('\n\n---\n\n');

    const userInput = request.prompt.trim();

    if (!taskContext && !userInput) {
        stream.markdown('No task documents found in `tasks/` and no task provided.\n\nRun `@mls /tasks` first to create a task breakdown, or describe the task directly in this message.\n');
        return;
    }

    const prompt = `${implEngineerAgent}

---

## Available Implementation Skills

### API Implementer
${apiSkill}

### Utility Implementer
${utilitySkill}

### Component Implementer
${componentSkill}

### Git Commit Helper
${gitCommitSkill}

---

${taskContext ? `## Task Documents\n\n${taskContext}\n\n---\n\n` : ''}## User Request

${userInput || 'Implement the next pending task from the task documents above.'}

---

## Instructions

You are the implementation-engineer agent. Review the task(s) and provide a detailed implementation plan and code.

For the requested task:
1. Identify the acceptance criteria
2. Plan the implementation steps
3. Write the implementation code with comments
4. Specify what tests need to be written
5. Suggest a commit message following conventional commits format

If the task includes design specifications, implement according to those designs exactly.

After implementation guidance, provide a suggested git commit message:

<!-- BEGIN COMMIT_MESSAGE -->
[conventional commit message]
<!-- END COMMIT_MESSAGE -->`;

    stream.progress('Planning implementation...');
    await sendPromptStreaming(model, prompt, stream, token);

    stream.markdown(`\n\n---\n\n**Next steps:**\n- Run \`@mls /test\` to validate with tests\n- Run \`@mls /review\` to get code review feedback\n`);
}
