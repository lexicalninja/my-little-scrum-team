import * as vscode from 'vscode';
import { ResourceLoader } from '../resourceLoader';
import { selectModel, sendPrompt, sendPromptStreaming, runAgentsParallel, formatAgentOutputs, AgentRequest } from '../lmAgent';

export async function handleReview(
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
    resources: ResourceLoader
): Promise<void> {
    const model = await selectModel();

    stream.markdown('## Code Review\n\n');

    if (!request.prompt.trim()) {
        stream.markdown('Provide the code or file path(s) to review. Example:\n\n```\n@mls /review src/auth.ts\n```\n\nOr paste the code directly after the command.\n');
        return;
    }

    stream.progress('Loading review resources...');
    const [reviewerAgent, bugSkill, securitySkill, styleSkill, perfSkill, a11ySkill, archSkill, bestPracticesSkill, specCheckerSkill] = await Promise.all([
        resources.getAgent('code-reviewer-feedback'),
        resources.getSkill('bug-detector'),
        resources.getSkill('security-scanner'),
        resources.getSkill('code-style-analyzer'),
        resources.getSkill('performance-analyzer'),
        resources.getSkill('accessibility-checker'),
        resources.getSkill('architecture-reviewer'),
        resources.getSkill('best-practices-checker'),
        resources.getSkill('specification-checker'),
    ]);

    const codeToReview = request.prompt.trim();

    stream.markdown('**Running parallel reviews...**\n\n');

    // Run specialized reviewers in parallel
    const reviewAgents: AgentRequest[] = [
        {
            name: 'Bug Detector',
            prompt: `${bugSkill}\n\n---\n\nReview this code for bugs, logic errors, and edge case issues:\n\n${codeToReview}\n\nList all issues found with file/line references where possible. Format each issue as: **BUG-XXX**: [description] — [location]`,
        },
        {
            name: 'Security Scanner',
            prompt: `${securitySkill}\n\n---\n\nReview this code for security vulnerabilities:\n\n${codeToReview}\n\nList all security issues found. Format each issue as: **SEC-XXX**: [description] — [location]`,
        },
        {
            name: 'Code Style Analyzer',
            prompt: `${styleSkill}\n\n---\n\nReview this code for style and formatting issues:\n\n${codeToReview}\n\nList all style issues found. Format each issue as: **STYLE-XXX**: [description] — [location]`,
        },
        {
            name: 'Best Practices Checker',
            prompt: `${bestPracticesSkill}\n\n---\n\nReview this code for best practice violations:\n\n${codeToReview}\n\nList all issues found. Format each issue as: **BEST-XXX**: [description] — [location]`,
        },
        {
            name: 'Performance Analyzer',
            prompt: `${perfSkill}\n\n---\n\nReview this code for performance issues:\n\n${codeToReview}\n\nList all performance issues found. Format each issue as: **PERF-XXX**: [description] — [location]`,
        },
    ];

    const reviewResults = await runAgentsParallel(model, reviewAgents, stream, token);
    const combinedFindings = formatAgentOutputs(reviewResults);

    stream.markdown('\n\n---\n\n## Consolidated Review Feedback\n\n');
    stream.progress('Consolidating and categorizing findings...');

    const consolidationPrompt = `${reviewerAgent}

---

## Individual Review Findings

${combinedFindings}

---

## Original Code

${codeToReview}

---

## Instructions

You are the code-reviewer-feedback agent. Consolidate the findings above into a structured feedback document.

For each issue:
1. Assign a unique ID (BUG-001, SEC-001, STYLE-001, etc.)
2. Categorize by actionability: **Must-Fix**, **Should-Fix**, **Nice-to-Have**, **Out-of-Scope**, or **Needs-Discussion**
3. Include the specific location (file + line if available)
4. Provide a clear fix suggestion

Output the complete feedback document following the standard structure from your agent definition.
Include a summary with issue counts at the top.`;

    await sendPromptStreaming(model, consolidationPrompt, stream, token);

    stream.markdown(`\n\n---\n\n**Next steps:**\n- Fix all **Must-Fix** issues\n- Fix **Should-Fix** issues\n- Run \`@mls /review\` again after fixes to verify\n`);
}
