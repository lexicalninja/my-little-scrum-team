import * as vscode from 'vscode';
import { ResourceLoader } from '../resourceLoader';
import { WorkspaceFiles } from '../workspaceFiles';
import { selectModel, sendPromptStreaming } from '../lmAgent';
import { handleRefine } from './refine';
import { handleSpec } from './spec';
import { handleTasks } from './tasks';
import { handleImplement } from './implement';

export async function handleRun(
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
    resources: ResourceLoader
): Promise<void> {
    const ws = new WorkspaceFiles();

    // Detect current phase by checking what workspace files exist
    stream.progress('Detecting current phase...');

    const [hasDecisions, hasSpecs, hasTasks] = await Promise.all([
        wsHasFiles(ws, 'decisions'),
        wsHasFiles(ws, 'specs'),
        wsHasFiles(ws, 'tasks'),
    ]);

    const userInput = request.prompt.trim();

    if (!hasDecisions && !hasSpecs && !hasTasks) {
        // Phase 0: No work started — start with idea refinement
        stream.markdown('## Starting: New Feature\n\n**Phase 0 — Idea Refinement**\n\nNo existing work found. Let\'s start by refining your idea.\n\n---\n\n');
        if (!userInput) {
            stream.markdown('Describe the feature or epic you want to build. Example:\n\n```\n@mlst /run I want to add user authentication with email and password\n```\n');
            return;
        }
        return handleRefine(request, stream, token, resources);
    }

    if (hasDecisions && !hasSpecs) {
        // Phase 1: Decisions exist but no spec — write specification
        stream.markdown('## Progress: Feature\n\n**Phase 1 — Specification**\n\nDecision records found. Writing specification next.\n\n---\n\n');
        return handleSpec(request, stream, token, resources);
    }

    if (hasSpecs && !hasTasks) {
        // Phase 2: Spec exists but no tasks — break into tasks
        stream.markdown('## Progress: Feature\n\n**Phase 2 — Task Breakdown**\n\nSpecification found. Breaking into tasks next.\n\n---\n\n');
        return handleTasks(request, stream, token, resources);
    }

    if (hasTasks) {
        // Phase 3: Tasks exist — show status and let team-lead orchestrate
        stream.markdown('## Progress: Feature\n\n**Phase 3 — Execution**\n\nTask breakdown found. Let me assess current status and guide next steps.\n\n---\n\n');
        return handleRunOrchestration(request, stream, token, resources, ws);
    }

    // Fallback: general team-lead response
    return handleRunOrchestration(request, stream, token, resources, ws);
}

async function wsHasFiles(ws: WorkspaceFiles, dir: string): Promise<boolean> {
    const files = await ws.listFiles(dir);
    return files.length > 0;
}

async function handleRunOrchestration(
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
    resources: ResourceLoader,
    ws: WorkspaceFiles
): Promise<void> {
    const model = await selectModel();

    stream.progress('Loading team-lead context...');
    const teamLeadAgent = await resources.getAgent('team-lead');

    // Gather workspace state
    const [decisions, specs, tasks] = await Promise.all([
        ws.readDir('decisions'),
        ws.readDir('specs'),
        ws.readDir('tasks'),
    ]);

    const workspaceState = buildWorkspaceState(decisions, specs, tasks);

    const prompt = `${teamLeadAgent}

---

## Current Workspace State

${workspaceState}

---

## User Request

${request.prompt.trim() || 'What should I do next to move this feature forward?'}

---

## Instructions

You are the team-lead agent. Review the current workspace state and provide:

1. A **progress assessment** — what phase are we in, what's been completed, what's pending
2. **Next recommended action** — the single most important thing to do next
3. **Specific command** — which \`@mlst /command\` the user should run next and with what input

Keep your response concise and actionable. Lead with status, then recommendation.`;

    await sendPromptStreaming(model, prompt, stream, token);
}

function buildWorkspaceState(
    decisions: Record<string, string>,
    specs: Record<string, string>,
    tasks: Record<string, string>
): string {
    const parts: string[] = [];

    if (Object.keys(decisions).length > 0) {
        parts.push(`### Decision Records (${Object.keys(decisions).length} files)\n${Object.keys(decisions).join('\n')}`);
    } else {
        parts.push('### Decision Records\nNone found.');
    }

    if (Object.keys(specs).length > 0) {
        parts.push(`### Specifications (${Object.keys(specs).length} files)\n${Object.keys(specs).join('\n')}`);
    } else {
        parts.push('### Specifications\nNone found.');
    }

    if (Object.keys(tasks).length > 0) {
        // Include task content to detect pending/in-progress/done status
        const taskSummary = Object.entries(tasks)
            .map(([name, content]) => {
                const pendingCount = (content.match(/Status.*Pending/gi) ?? []).length;
                const doneCount = (content.match(/Status.*Done/gi) ?? []).length;
                return `- ${name} (${pendingCount} pending, ${doneCount} done)`;
            })
            .join('\n');
        parts.push(`### Task Breakdowns (${Object.keys(tasks).length} files)\n${taskSummary}`);
    } else {
        parts.push('### Task Breakdowns\nNone found.');
    }

    return parts.join('\n\n');
}
