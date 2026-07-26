import * as vscode from 'vscode';
import { ResourceLoader } from '../resourceLoader';
import { WorkspaceFiles } from '../workspaceFiles';
import { selectModel, sendPromptStreaming, slugify, todayISO } from '../lmAgent';

export async function handleRefine(
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
    resources: ResourceLoader
): Promise<void> {
    const ws = new WorkspaceFiles();
    const model = await selectModel();

    stream.markdown('## Refining Your Idea\n\n');

    const [ideaRefinerSkill, decisionTemplate] = await Promise.all([
        resources.getSkill('idea-refiner'),
        resources.getTemplate('decision-record'),
    ]);

    stream.progress('Analyzing your idea...');

    const userIdea = request.prompt.trim() || 'No idea provided — please describe what you want to build.';

    const prompt = `${ideaRefinerSkill}

---

## Decision Record Template

Use this template structure when saving the decision record:

${decisionTemplate}

---

## User's Idea

${userIdea}

---

## Instructions

Follow the Idea Refiner skill instructions above. Work through all three phases:

1. **Phase 1 — Understand**: Summarize what you heard, identify gaps, ask 2-4 clarifying questions.
2. **Phase 2 — Propose Approaches**: Generate 2-4 meaningfully different approaches with tradeoffs. State your recommendation.
3. **Phase 3 — Reach Agreement**: Ask the user to confirm their preferred approach.

After presenting your analysis, also provide a filled-in decision record wrapped in markers:

<!-- BEGIN DECISION_RECORD -->
[filled in decision record markdown content]
<!-- END DECISION_RECORD -->

Use today's date (${todayISO()}) for the date field.
Use a short slug derived from the idea for the filename.`;

    const fullOutput = await sendPromptStreaming(model, prompt, stream, token);

    // Extract and save decision record if the LM included one
    const decisionContent = extractDecisionRecord(fullOutput);
    if (decisionContent) {
        const idea = request.prompt.trim().split('\n')[0].slice(0, 60);
        const slug = slugify(idea) || 'idea';
        const filename = `decisions/DECISION-${todayISO()}-${slug}.md`;
        try {
            await ws.writeFile(filename, decisionContent);
            stream.markdown(`\n\n---\n\n**Decision record saved to \`${filename}\`.**\nOnce you agree on an approach, run \`@mls /spec\` to create a detailed specification.\n`);
        } catch {
            stream.markdown(`\n\n---\n\n*Could not save decision record to workspace.*\n`);
        }
    } else {
        stream.markdown(`\n\n---\n\n*Once you agree on an approach, run \`@mls /spec\` with your chosen direction.*\n`);
    }
}

function extractDecisionRecord(text: string): string | null {
    const begin = '<!-- BEGIN DECISION_RECORD -->';
    const end = '<!-- END DECISION_RECORD -->';
    const startIdx = text.indexOf(begin);
    const endIdx = text.indexOf(end);
    if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return null;
    return text.substring(startIdx + begin.length, endIdx).trim();
}
