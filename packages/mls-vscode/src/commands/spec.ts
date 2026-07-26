import * as vscode from 'vscode';
import { ResourceLoader } from '../resourceLoader';
import { WorkspaceFiles } from '../workspaceFiles';
import { selectModel, sendPromptStreaming, slugify, todayISO } from '../lmAgent';

export async function handleSpec(
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
    resources: ResourceLoader
): Promise<void> {
    const ws = new WorkspaceFiles();
    const model = await selectModel();

    stream.markdown('## Writing Specification\n\n');

    stream.progress('Loading resources...');
    const [specWriterAgent, requirementSkill, techSpecSkill, specTemplate] = await Promise.all([
        resources.getAgent('specification-writer'),
        resources.getSkill('requirement-analyzer'),
        resources.getSkill('technical-spec-writer'),
        resources.getTemplate('specification'),
    ]);

    // Load decision records if they exist
    stream.progress('Reading decision records...');
    const decisions = await ws.readDir('decisions');
    const decisionContext = Object.entries(decisions)
        .map(([name, content]) => `### ${name}\n\n${content}`)
        .join('\n\n---\n\n');

    const userRequest = request.prompt.trim() || 'Create a specification for the feature described in the decision records.';

    const prompt = `${specWriterAgent}

---

## Available Skills

### Requirement Analyzer
${requirementSkill}

### Technical Spec Writer
${techSpecSkill}

---

## Specification Template

Use this template structure for your output:

${specTemplate}

---

${decisionContext ? `## Decision Records\n\n${decisionContext}\n\n---\n\n` : ''}## User Request

${userRequest}

---

## Instructions

You are the specification-writer agent. Create a detailed, actionable specification following the template above.

Use the requirement-analyzer skill to extract functional and non-functional requirements.
Use the technical-spec-writer skill to fill in architecture, data models, and API details.

If information is ambiguous or missing, note your assumptions clearly.

Output the complete specification document wrapped in markers:

<!-- BEGIN SPECIFICATION -->
[complete specification markdown]
<!-- END SPECIFICATION -->`;

    stream.progress('Writing specification...');
    const fullOutput = await sendPromptStreaming(model, prompt, stream, token);

    const specContent = extractSection(fullOutput, 'SPECIFICATION');
    const slug = slugify(userRequest.split('\n')[0].slice(0, 60)) || 'spec';
    const filename = `specs/SPEC-${todayISO()}-${slug}.md`;

    if (specContent) {
        try {
            await ws.writeFile(filename, specContent);
            stream.markdown(`\n\n---\n\n**Specification saved to \`${filename}\`.**\nNext: run \`@mls /tasks\` to break this into actionable tasks.\n`);
        } catch {
            stream.markdown(`\n\n---\n\n*Could not save specification to workspace.*\n`);
        }
    } else {
        // Try to save full output as fallback
        try {
            await ws.writeFile(filename, fullOutput);
            stream.markdown(`\n\n---\n\n**Specification saved to \`${filename}\`.**\nNext: run \`@mls /tasks\` to break this into actionable tasks.\n`);
        } catch {
            stream.markdown(`\n\n---\n\nNext: run \`@mls /tasks\` to break this into actionable tasks.\n`);
        }
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
