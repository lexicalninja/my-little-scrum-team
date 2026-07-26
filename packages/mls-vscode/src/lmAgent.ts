import * as vscode from 'vscode';

export interface AgentRequest {
    name: string;
    prompt: string;
}

export interface AgentResponse {
    name: string;
    text: string;
}

export async function selectModel(): Promise<vscode.LanguageModelChat> {
    const models = await vscode.lm.selectChatModels();
    if (models.length === 0) {
        throw new Error('No language models available. Make sure GitHub Copilot or another LM provider is active.');
    }
    models.sort((a, b) => (b.maxInputTokens ?? 0) - (a.maxInputTokens ?? 0));
    return models[0];
}

export async function sendPrompt(
    model: vscode.LanguageModelChat,
    prompt: string,
    token: vscode.CancellationToken
): Promise<string> {
    const messages = [vscode.LanguageModelChatMessage.User(prompt)];
    const response = await model.sendRequest(messages, {}, token);
    const chunks: string[] = [];
    for await (const chunk of response.text) {
        chunks.push(chunk);
    }
    return chunks.join('');
}

export async function sendPromptStreaming(
    model: vscode.LanguageModelChat,
    prompt: string,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
): Promise<string> {
    const messages = [vscode.LanguageModelChatMessage.User(prompt)];
    const response = await model.sendRequest(messages, {}, token);
    const chunks: string[] = [];
    for await (const chunk of response.text) {
        stream.markdown(chunk);
        chunks.push(chunk);
    }
    return chunks.join('');
}

export async function runAgentsParallel(
    model: vscode.LanguageModelChat,
    agents: AgentRequest[],
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
): Promise<AgentResponse[]> {
    stream.markdown('\n\n');
    const results = await Promise.all(
        agents.map(async (agent): Promise<AgentResponse> => {
            stream.progress(`${agent.name} working...`);
            const text = await sendPrompt(model, agent.prompt, token);
            return { name: agent.name, text };
        })
    );
    return results;
}

export function formatAgentOutputs(outputs: AgentResponse[]): string {
    return outputs.map((o) => `## ${o.name}\n\n${o.text}`).join('\n\n---\n\n');
}

export function extractSection(text: string, sectionName: string): string | null {
    const beginMarker = `<!-- BEGIN ${sectionName} -->`;
    const endMarker = `<!-- END ${sectionName} -->`;
    const startIdx = text.indexOf(beginMarker);
    const endIdx = text.indexOf(endMarker);
    if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return null;
    return text.substring(startIdx + beginMarker.length, endIdx).trim();
}

export function slugify(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .slice(0, 50)
        // Trim after truncating, not before — otherwise cutting mid-word
        // reintroduces a trailing dash and yields names like `SPEC-2026-07-26-foo-.md`.
        .replace(/^-+|-+$/g, '');
}

export function todayISO(): string {
    return new Date().toISOString().slice(0, 10);
}
