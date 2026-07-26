/**
 * Save/resume build state to .mls/runs/<id>/ directory.
 */
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { serializeState, deserializeState } from './store.js';
import type { BuildState } from './types.js';

function getRunsDir(stateDir: string): string {
  return resolve(stateDir, 'runs');
}

function getRunDir(stateDir: string, runId: string): string {
  return join(getRunsDir(stateDir), runId);
}

export async function saveState(state: BuildState, stateDir: string = '.mls'): Promise<string> {
  const runDir = getRunDir(stateDir, state.id);
  await mkdir(runDir, { recursive: true });

  const filePath = join(runDir, 'state.json');
  const serialized = serializeState(state);
  await writeFile(filePath, JSON.stringify(serialized, null, 2), 'utf-8');

  return runDir;
}

export async function loadState(runId: string, stateDir: string = '.mls'): Promise<BuildState> {
  const filePath = join(getRunDir(stateDir, runId), 'state.json');
  const content = await readFile(filePath, 'utf-8');
  const data = JSON.parse(content);
  return deserializeState(data);
}

export async function listRuns(stateDir: string = '.mls'): Promise<Array<{ id: string; phase: string; updatedAt: string; input: string }>> {
  const runsDir = getRunsDir(stateDir);
  const runs: Array<{ id: string; phase: string; updatedAt: string; input: string }> = [];

  try {
    const entries = await readdir(runsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const state = await loadState(entry.name, stateDir);
        runs.push({
          id: state.id,
          phase: state.phase,
          updatedAt: state.updatedAt,
          input: state.input.slice(0, 100),
        });
      } catch {
        // Corrupted run directory — skip
      }
    }
  } catch {
    // No runs directory yet
  }

  return runs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Save an artifact (spec, task breakdown, decision record) alongside the state */
export async function saveArtifact(
  runId: string,
  name: string,
  content: string,
  stateDir: string = '.mls',
): Promise<string> {
  const runDir = getRunDir(stateDir, runId);
  await mkdir(runDir, { recursive: true });
  const filePath = join(runDir, name);
  await writeFile(filePath, content, 'utf-8');
  return filePath;
}

export async function loadArtifact(
  runId: string,
  name: string,
  stateDir: string = '.mls',
): Promise<string | null> {
  try {
    const filePath = join(getRunDir(stateDir, runId), name);
    return await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}
