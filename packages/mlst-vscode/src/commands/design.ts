import * as vscode from 'vscode';
import { ResourceLoader } from '../resourceLoader';
import { WorkspaceFiles } from '../workspaceFiles';
import { extractSection, selectModel, sendPromptStreaming, slugify, todayISO } from '../lmAgent';

export async function handleDesign(
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
    resources: ResourceLoader
): Promise<void> {
    const ws = new WorkspaceFiles();
    const model = await selectModel();

    stream.markdown('## UI/UX Design Specifications\n\n');

    stream.progress('Loading resources...');
    const [designerAgent, layoutSkill, componentDesignSkill, colorSkill, typographySkill, spacingSkill, interactionSkill, responsiveSkill, a11ySkill] = await Promise.all([
        resources.getAgent('ui-ux-designer'),
        resources.getSkill('layout-designer'),
        resources.getSkill('component-designer'),
        resources.getSkill('color-system-designer'),
        resources.getSkill('typography-designer'),
        resources.getSkill('spacing-system-designer'),
        resources.getSkill('interaction-designer'),
        resources.getSkill('responsive-design-planner'),
        resources.getSkill('accessibility-design-checker'),
    ]);

    // Load task documents for context
    stream.progress('Reading task context...');
    const tasks = await ws.readDir('tasks');
    const taskContext = Object.entries(tasks)
        .map(([name, content]) => `### ${name}\n\n${content}`)
        .join('\n\n---\n\n');

    const userInput = request.prompt.trim();

    if (!taskContext && !userInput) {
        stream.markdown('No task documents found in `tasks/` and no design request provided.\n\nDescribe what you need designed, or run `@mlst /tasks` first to create a task breakdown.\n');
        return;
    }

    const prompt = `${designerAgent}

---

## Available Design Skills

### Layout Designer
${layoutSkill}

### Component Designer
${componentDesignSkill}

### Color System Designer
${colorSkill}

### Typography Designer
${typographySkill}

### Spacing System Designer
${spacingSkill}

### Interaction Designer
${interactionSkill}

### Responsive Design Planner
${responsiveSkill}

### Accessibility Design Checker
${a11ySkill}

---

${taskContext ? `## Task Documents\n\n${taskContext}\n\n---\n\n` : ''}## Design Request

${userInput || 'Create design specifications for the UI/UX tasks identified in the task documents above.'}

---

## Instructions

You are the ui-ux-designer agent. Create comprehensive design specifications.

Use the appropriate design skills based on what the task needs. Ensure every design includes:
- Accessibility requirements (WCAG AA compliance)
- Responsive design breakpoints
- Component states (default, hover, focus, disabled, error)
- Exact measurements (pixels/rems), colors (hex), spacing values

Output design specifications wrapped in markers:

<!-- BEGIN DESIGN_SPEC -->
[complete design specification markdown]
<!-- END DESIGN_SPEC -->`;

    stream.progress('Creating design specifications...');
    const fullOutput = await sendPromptStreaming(model, prompt, stream, token);

    const designContent = extractSection(fullOutput, 'DESIGN_SPEC');
    const slug = slugify(userInput.split('\n')[0].slice(0, 60) || 'design');
    const filename = `docs/design/DESIGN-${todayISO()}-${slug}.md`;

    const contentToSave = designContent ?? fullOutput;
    try {
        await ws.writeFile(filename, contentToSave);
        stream.markdown(`\n\n---\n\n**Design spec saved to \`${filename}\`.**\nNext: run \`@mlst /implement\` with a reference to this design spec.\n`);
    } catch {
        stream.markdown(`\n\n---\n\nNext: run \`@mlst /implement\` with this design spec to implement it.\n`);
    }
}
