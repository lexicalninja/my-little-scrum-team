/**
 * MLS Pi Extension — Task Parser
 *
 * Converts raw scrum-master agent output into structured TaskState objects.
 * Two-phase parse: structured JSON lines first, markdown heading fallback second.
 */

import * as crypto from "node:crypto";
import type { TaskState, TaskType } from "../types.js";
import { mapTypeToAgent } from "./helpers.js";
import type { ParsedTaskPayload, ParsedTaskLine } from "./helpers.js";

/** Callable signature for the direct LLM extraction call. */
type LlmFn = (system: string, user: string, tier?: "fast" | "balanced" | "strong") => Promise<string>;

/**
 * Parse the scrum-master agent's raw output into a structured `TaskState[]`.
 *
 * Two-phase parse:
 * 1. **Structured JSON lines** — LLM is prompted to emit one JSON object per line;
 *    `parseStructuredTasks()` collects all lines starting with `{`.
 * 2. **Markdown heading fallback** — if no JSON lines are found, `parseTaskHeadings()`
 *    extracts `## TASK-001: Title` headings from the raw agent output.
 *
 * After parsing, each task label is assigned a UUID. Label references in `dependencies`
 * and `parallelWith` are converted to UUIDs via the `labelToId` map.
 *
 * @param taskOutput - Raw output text from the `mls-scrum-master` agent.
 * @param llm        - LLM callable for structured task extraction.
 * @returns Fully hydrated `TaskState[]` ready to pass to `StateManager.setTasks()`.
 */
export async function parseTasks(taskOutput: string, llm: LlmFn): Promise<TaskState[]> {
  const response = await llm(
    `Extract tasks. For each, output one JSON line:
{"label":"TASK-001","title":"...","type":"Implementation|Testing|Design|Infrastructure|Deployment|Documentation","dependencies":["TASK-X"],"parallelWith":[],"acceptanceCriteria":[],"filesAffected":[]}
Format the output as JSON lines.`,
    taskOutput,
    "balanced",
  );

  const raw = parseStructuredTasks(response);
  const fallback = raw.length > 0 ? raw : parseTaskHeadings(taskOutput);
  const labelToId = new Map<string, string>();
  for (const task of fallback) {
    labelToId.set(task.label, crypto.randomUUID());
  }

  return fallback.map((task) => createTaskState(task, labelToId));
}

/**
 * Parse structured JSON lines from the LLM's task-extraction response.
 *
 * Scans each line; any line beginning with `{` is attempted as JSON. Invalid
 * JSON lines are silently skipped. Returns an empty array if no valid lines are found,
 * triggering the markdown heading fallback in {@link parseTasks}.
 *
 * @param response - Raw LLM response text from the task-extraction call.
 * @returns Array of parsed task lines with their label and payload.
 */
export function parseStructuredTasks(response: string): ParsedTaskLine[] {
  const tasks: ParsedTaskLine[] = [];

  for (const line of response.split("\n")) {
    if (!line.trim().startsWith("{")) {
      continue;
    }

    try {
      const parsed = JSON.parse(line.trim()) as ParsedTaskPayload;
      // Prefer short TASK-NNN labels; fall back to parsed.label/id only if they look like short IDs.
      const rawLabel = parsed.label ?? parsed.id;
      const isShortLabel = rawLabel && rawLabel.length <= 20 && !/^[0-9a-f]{8}-/.test(rawLabel);
      tasks.push({
        label: isShortLabel ? rawLabel : `TASK-${String(tasks.length + 1).padStart(3, "0")}`,
        parsed,
      });
    } catch {
      continue;
    }
  }

  return tasks;
}

/**
 * Fallback parser: extract tasks from `## TASK-001: Title` markdown headings.
 *
 * Used when {@link parseStructuredTasks} returns zero results. Matches both `##` and
 * `###` heading levels. Only captures `label` and `title`; all other fields default
 * to empty values in {@link createTaskState}.
 *
 * @param taskOutput - Raw agent output from `mls-scrum-master`.
 * @returns Array of parsed task lines extracted from markdown headings.
 */
export function parseTaskHeadings(taskOutput: string): ParsedTaskLine[] {
  const tasks: ParsedTaskLine[] = [];
  const regex = /#{2,3}\s+(TASK-\d+):\s*(.+)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(taskOutput)) !== null) {
    tasks.push({
      label: match[1],
      parsed: { title: match[2].trim() },
    });
  }

  return tasks;
}

/**
 * Construct a fully-hydrated `TaskState` from a parsed task line and the label→UUID map.
 *
 * Resolves label references in `dependencies` and `parallelWith` to UUIDs using
 * `labelToId`. Labels not found in the map are left as-is (handles forward-references
 * to tasks outside the current parse result).
 *
 * @param task      - Parsed task line with label and raw payload.
 * @param labelToId - Map from TASK-001 style labels to pre-assigned UUIDs.
 * @returns Fully-hydrated `TaskState` ready for `StateManager.setTasks()`.
 * @throws If the label has no corresponding UUID in `labelToId` (indicates a parse bug).
 */
export function createTaskState(task: ParsedTaskLine, labelToId: Map<string, string>): TaskState {
  const type = (task.parsed.type ?? "Implementation") as TaskType;
  const id = labelToId.get(task.label);
  if (!id) {
    throw new Error(`Missing task ID for ${task.label}`);
  }

  return {
    id,
    label: task.label,
    title: task.parsed.title ?? "Untitled",
    type,
    status: "pending",
    dependencies: (task.parsed.dependencies ?? []).map((dependency) => labelToId.get(dependency) ?? dependency),
    parallelWith: (task.parsed.parallelWith ?? []).map((dependency) => labelToId.get(dependency) ?? dependency),
    acceptanceCriteria: task.parsed.acceptanceCriteria ?? [],
    filesAffected: task.parsed.filesAffected ?? [],
    assignedAgent: mapTypeToAgent(type),
    iterationCount: 0,
  };
}
