/**
 * MCP resource providers — exposes build artifacts as readable resources.
 */
import { loadState, loadArtifact } from '../state/persistence.js';

export interface MCPResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export async function listResources(stateDir: string): Promise<MCPResource[]> {
  // Resources are dynamically discovered from saved runs
  const { listRuns } = await import('../state/persistence.js');
  const runs = await listRuns(stateDir);
  const resources: MCPResource[] = [];

  for (const run of runs) {
    resources.push(
      {
        uri: `mls://runs/${run.id}/status`,
        name: `Build ${run.id} — Status`,
        description: `Current status of build ${run.id}`,
        mimeType: 'application/json',
      },
      {
        uri: `mls://runs/${run.id}/specification`,
        name: `Build ${run.id} — Specification`,
        description: `Generated specification for build ${run.id}`,
        mimeType: 'text/markdown',
      },
      {
        uri: `mls://runs/${run.id}/tasks`,
        name: `Build ${run.id} — Tasks`,
        description: `Task breakdown for build ${run.id}`,
        mimeType: 'text/markdown',
      },
    );
  }

  return resources;
}

export async function readResource(uri: string, stateDir: string): Promise<string> {
  const match = uri.match(/^mls:\/\/runs\/([^/]+)\/(.+)$/);
  if (!match) {
    throw new Error(`Invalid resource URI: ${uri}`);
  }

  const [, runId, resourceType] = match;

  switch (resourceType) {
    case 'status': {
      const state = await loadState(runId, stateDir);
      const tasks = Array.from(state.tasks.values()).map((t) => ({
        id: t.id, title: t.title, type: t.type, status: t.status,
      }));
      return JSON.stringify({
        id: state.id,
        phase: state.phase,
        inputType: state.inputType,
        input: state.input.slice(0, 200),
        tasks,
        tokenUsage: state.tokenUsage,
        costEstimate: state.costEstimate,
      }, null, 2);
    }
    case 'specification': {
      const spec = await loadArtifact(runId, 'specification.md', stateDir);
      return spec ?? 'No specification generated yet.';
    }
    case 'tasks': {
      const tasks = await loadArtifact(runId, 'task-breakdown.md', stateDir);
      return tasks ?? 'No task breakdown generated yet.';
    }
    default:
      throw new Error(`Unknown resource type: ${resourceType}`);
  }
}
