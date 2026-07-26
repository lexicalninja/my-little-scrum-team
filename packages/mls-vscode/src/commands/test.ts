import * as vscode from 'vscode';
import { ResourceLoader } from '../resourceLoader';
import { WorkspaceFiles } from '../workspaceFiles';
import { selectModel, sendPromptStreaming } from '../lmAgent';

export async function handleTest(
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
    resources: ResourceLoader
): Promise<void> {
    const ws = new WorkspaceFiles();
    const model = await selectModel();

    stream.markdown('## Test Runner\n\n');

    stream.progress('Loading resources...');
    const [testRunnerAgent, testWriterSkill] = await Promise.all([
        resources.getAgent('test-runner'),
        resources.getSkill('test-writer'),
    ]);

    const userInput = request.prompt.trim();

    if (!userInput) {
        stream.markdown('Provide the code or file path(s) to test. Example:\n\n```\n@mls /test src/auth.ts\n```\n\nOr paste the code directly after the command.\n');
        return;
    }

    // Load task context for acceptance criteria
    const tasks = await ws.readDir('tasks');
    const taskContext = Object.entries(tasks)
        .map(([name, content]) => `### ${name}\n\n${content}`)
        .join('\n\n---\n\n');

    const prompt = `${testRunnerAgent}

---

## Test Writer Skill
${testWriterSkill}

---

${taskContext ? `## Task Documents (for acceptance criteria)\n\n${taskContext}\n\n---\n\n` : ''}## Code to Test

${userInput}

---

## Instructions

You are the test-runner agent. Analyze the code and generate comprehensive tests.

Use the test-writer skill to create:
1. **Unit tests** — Test individual functions/components in isolation
2. **Integration tests** — Test component interactions
3. **Edge cases** — Test boundary conditions and error scenarios

For each test:
- Use the appropriate test framework for the detected language/framework
- Follow the project's existing test patterns if apparent from the code
- Cover happy paths, error cases, and edge cases
- Include setup/teardown as needed

After generating tests, provide a test execution summary describing:
- What tests were written
- What they cover
- How to run them
- Expected coverage metrics

Format tests in fenced code blocks with the appropriate language tag.`;

    stream.progress('Generating tests...');
    await sendPromptStreaming(model, prompt, stream, token);

    stream.markdown(`\n\n---\n\n**Next steps:**\n- Copy the tests into your test files\n- Run the test suite to validate\n- Run \`@mls /review\` for code review\n`);
}
