import * as vscode from 'vscode';
import { ResourceLoader } from './resourceLoader';
import { selectModel, sendPromptStreaming } from './lmAgent';
import { handleRun } from './commands/run';
import { handleRefine } from './commands/refine';
import { handleSpec } from './commands/spec';
import { handleTasks } from './commands/tasks';
import { handleImplement } from './commands/implement';
import { handleDesign } from './commands/design';
import { handleReview } from './commands/review';
import { handleTest } from './commands/test';
import { handleConvertToExtension } from './commands/convertToExtension';

const PARTICIPANT_ID = 'my-little-scrum-team.participant';

export class ScrumTeamParticipant {
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
                case 'run':
                    await handleRun(request, stream, token, this.resources);
                    break;
                case 'refine':
                    await handleRefine(request, stream, token, this.resources);
                    break;
                case 'spec':
                    await handleSpec(request, stream, token, this.resources);
                    break;
                case 'tasks':
                    await handleTasks(request, stream, token, this.resources);
                    break;
                case 'implement':
                    await handleImplement(request, stream, token, this.resources);
                    break;
                case 'design':
                    await handleDesign(request, stream, token, this.resources);
                    break;
                case 'review':
                    await handleReview(request, stream, token, this.resources);
                    break;
                case 'convert-to-extension':
                    await handleConvertToExtension(request, stream, token, this.resources);
                    break;
                case 'test':
                    await handleTest(request, stream, token, this.resources);
                    break;
                default:
                    await this.handleGeneralQuestion(request, context, stream, token);
                    break;
            }
        } catch (error) {
            if (error instanceof Error) {
                stream.markdown(`\n\n### Error\n\n${error.message}\n`);
                if (error.message.includes('No workspace folder')) {
                    stream.markdown('\nOpen a workspace folder first, then try again.\n');
                }
                if (error.message.includes('No language models')) {
                    stream.markdown('\nMake sure GitHub Copilot or another LM provider is active.\n');
                }
            } else {
                stream.markdown('\n\n### Unexpected Error\n\nSomething went wrong. Please try again.\n');
            }
        }
    }

    private async handleGeneralQuestion(
        request: vscode.ChatRequest,
        context: vscode.ChatContext,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<void> {
        const model = await selectModel();

        const [teamLead, specWriter, scrumMaster, implEngineer, reviewer, testRunner, designer, infraEngineer] = await Promise.all([
            this.resources.getAgent('team-lead'),
            this.resources.getAgent('specification-writer'),
            this.resources.getAgent('scrum-master'),
            this.resources.getAgent('implementation-engineer'),
            this.resources.getAgent('code-reviewer-feedback'),
            this.resources.getAgent('test-runner'),
            this.resources.getAgent('ui-ux-designer'),
            this.resources.getAgent('infrastructure-engineer'),
        ]);

        const systemPrompt = `You are the My Little Scrum Team assistant — a coordinator for a team of AI agents that helps developers spec, plan, implement, and ship features.

## Your Team

### Team Lead
${teamLead}

### Specification Writer
${specWriter}

### Scrum Master
${scrumMaster}

### Implementation Engineer
${implEngineer}

### Code Reviewer
${reviewer}

### Test Runner
${testRunner}

### UI/UX Designer
${designer}

### Infrastructure Engineer
${infraEngineer}

---

## Available Commands

- \`@mls /run\` — Start or continue the full workflow for an epic (auto-detects phase)
- \`@mls /refine [idea]\` — Collaboratively refine an idea before autonomous execution
- \`@mls /spec [request]\` — Write a detailed technical specification
- \`@mls /tasks [input]\` — Break a spec into atomic, actionable tasks
- \`@mls /implement [task]\` — Get implementation guidance for a task
- \`@mls /design [task]\` — Create UI/UX design specifications
- \`@mls /review [code]\` — Get structured code review feedback
- \`@mls /test [code]\` — Generate comprehensive tests

---

## Instructions

Answer the user's question helpfully. If their question maps to a specific command, suggest it.
Be concise and direct. Refer to specific agents by name when relevant.`;

        const fullPrompt = `${systemPrompt}\n\n---\n\n## User Question\n\n${request.prompt}`;

        await sendPromptStreaming(model, fullPrompt, stream, token);
    }
}
