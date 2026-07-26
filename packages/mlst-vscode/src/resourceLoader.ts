import * as vscode from 'vscode';

const AGENT_NAMES = [
    'code-reviewer-feedback',
    'implementation-engineer',
    'infrastructure-engineer',
    'scrum-master',
    'specification-writer',
    'team-lead',
    'test-runner',
    'ui-ux-designer',
] as const;

export type AgentName = typeof AGENT_NAMES[number];

const TEMPLATE_NAMES = [
    'decision-record',
    'specification',
    'task-breakdown',
] as const;

export type TemplateName = typeof TEMPLATE_NAMES[number];

export class ResourceLoader {
    private cache = new Map<string, string>();

    constructor(private extensionUri: vscode.Uri) {}

    private resourceUri(...segments: string[]): vscode.Uri {
        return vscode.Uri.joinPath(this.extensionUri, 'resources', ...segments);
    }

    private async readResource(...segments: string[]): Promise<string> {
        const key = segments.join('/');
        if (this.cache.has(key)) return this.cache.get(key)!;
        const uri = this.resourceUri(...segments);
        const content = Buffer.from(
            await vscode.workspace.fs.readFile(uri)
        ).toString('utf-8');
        this.cache.set(key, content);
        return content;
    }

    async getAgent(name: AgentName): Promise<string> {
        return this.readResource('agents', `${name}.md`);
    }

    async getAllAgents(): Promise<Record<AgentName, string>> {
        const entries = await Promise.all(
            AGENT_NAMES.map(async (name) => [name, await this.getAgent(name)] as const)
        );
        return Object.fromEntries(entries) as Record<AgentName, string>;
    }

    async getCoreAgents(): Promise<Record<string, string>> {
        const coreNames: AgentName[] = [
            'team-lead',
            'specification-writer',
            'scrum-master',
            'implementation-engineer',
            'code-reviewer-feedback',
            'test-runner',
        ];
        const entries = await Promise.all(
            coreNames.map(async (name) => [name, await this.getAgent(name)] as const)
        );
        return Object.fromEntries(entries);
    }

    async getTemplate(name: TemplateName): Promise<string> {
        return this.readResource('templates', `${name}.md`);
    }

    async getSkill(skillName: string): Promise<string> {
        return this.readResource('skills', skillName, 'SKILL.md');
    }

    async getCommand(commandName: string): Promise<string> {
        return this.readResource('commands', `${commandName}.md`);
    }
}
