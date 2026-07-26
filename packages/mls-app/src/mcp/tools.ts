/**
 * MCP tool definitions — maps MCP tool calls to orchestrator engine.
 */
import type { OrchestrationEngine } from '../orchestrator/engine.js';
import type { MLSConfig } from '../config/schema.js';
import { listRuns, loadState, loadArtifact } from '../state/persistence.js';
import { MCPInteraction } from '../interaction/mcp-interaction.js';

export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<string>;
}

export function createMCPTools(engine: OrchestrationEngine, config: MLSConfig): MCPToolDefinition[] {
  return [
    {
      name: 'mls_build',
      description: 'Start a new build. Orchestrates specialist AI agents to implement software from a description. If the response contains `needs_clarification: true`, ask the user the `question` field, then call `mls_resume` with `runId` and `context` set to the user\'s answer.',
      inputSchema: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'What to build' },
          fromIssue: { type: 'number', description: 'GitHub issue number (optional)' },
          fromFile: { type: 'string', description: 'Path to specification file (optional)' },
        },
        required: ['description'],
      },
      handler: async (args) => {
        const events: string[] = [];
        const interaction = new MCPInteraction();
        let description = args.description as string;
        if (args.fromIssue) {
          const { fetchGitHubIssue, inferRepoFromGitRemote } =
            await import('../utils/github-issue.js');
          const { owner, repo } = await inferRepoFromGitRemote(process.cwd());
          description = await fetchGitHubIssue(
            { owner, repo, number: args.fromIssue as number },
            process.cwd(),
          );
        }
        const result = await engine.build(
          description,
          (event) => {
            if (event.type === 'phase_start' || event.type === 'agent_complete' || event.type === 'build_complete' || event.type === 'error') {
              events.push(JSON.stringify(event));
            }
          },
          {
            fromIssue: args.fromIssue as number | undefined,
            fromFile: args.fromFile as string | undefined,
            interaction,
          },
        );
        if (result.needs_clarification) {
          return JSON.stringify({
            needs_clarification: true,
            question: result.clarification_question,
            runId: result.state.id,
          });
        }
        return JSON.stringify({ success: result.success, summary: result.summary, events });
      },
    },
    {
      name: 'mls_status',
      description: 'Check status of a specific build run or list recent runs.',
      inputSchema: {
        type: 'object',
        properties: {
          runId: { type: 'string', description: 'Build run ID (optional — lists recent runs if omitted)' },
        },
      },
      handler: async (args) => {
        if (args.runId) {
          const state = await loadState(args.runId as string, config.stateDir);
          const tasks = Array.from(state.tasks.values()).map((t) => ({
            id: t.id, title: t.title, status: t.status,
          }));
          return JSON.stringify({ id: state.id, phase: state.phase, inputType: state.inputType, tasks });
        }
        const runs = await listRuns(config.stateDir);
        return JSON.stringify(runs);
      },
    },
    {
      name: 'mls_resume',
      description: 'Resume an interrupted build run. Use `context` to provide the user\'s answer when resuming after a `needs_clarification` response.',
      inputSchema: {
        type: 'object',
        properties: {
          runId: { type: 'string', description: 'Build run ID to resume' },
          context: { type: 'string', description: 'Additional instructions for the resumed build, or the user\'s answer to a clarification question' },
        },
        required: ['runId'],
      },
      handler: async (args) => {
        const events: string[] = [];
        const interaction = new MCPInteraction(args.context as string | undefined);
        const result = await engine.build(
          '', // Input comes from saved state
          (event) => {
            if (event.type !== 'agent_thinking' && event.type !== 'agent_tool_use') {
              events.push(JSON.stringify(event));
            }
          },
          {
            resumeId: args.runId as string,
            resumeContext: args.context as string | undefined,
            interaction,
          },
        );
        if (result.needs_clarification) {
          return JSON.stringify({
            needs_clarification: true,
            question: result.clarification_question,
            runId: result.state.id,
          });
        }
        return JSON.stringify({ success: result.success, summary: result.summary, events });
      },
    },
    {
      name: 'mls_list_runs',
      description: 'List recent build runs with their status.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => {
        const runs = await listRuns(config.stateDir);
        return JSON.stringify(runs);
      },
    },
    {
      name: 'mls_config',
      description: 'View current MLS configuration.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => {
        return JSON.stringify(config, null, 2);
      },
    },
  ];
}
