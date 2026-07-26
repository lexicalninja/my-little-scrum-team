/**
 * MLS Pi Extension — Direct LLM Calls
 *
 * Subprocess-based LLM calls with --no-extensions to prevent re-entrancy.
 * Uses parent model for consistent provider/key resolution.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// No timeout — high-reasoning models (Opus 4.6, o1) can take 3-5+ minutes

export interface LlmCallOptions {
  signal?: AbortSignal;
  /**
   * Hint describing the reasoning depth needed for this call. Used for observability
   * (emitted in the `llm_start` dashboard event) but does NOT currently select a
   * different model — the orchestrator uses a single model for all LLM calls.
   *
   * - `"fast"`     — Classification, JSON parsing, simple verdicts.
   * - `"balanced"` — Evaluation tasks (spec gate, task extraction).
   * - `"strong"`   — Complex generation (currently unused; reserved).
   */
  tier?: "fast" | "balanced" | "strong";
  /**
   * Called with the most recent non-empty text line as the model streams.
   * Suitable for driving a spinner or status line — not guaranteed to receive every token.
   */
  onProgress?: (text: string) => void;
}

/**
 * Thin wrapper around the `pi` subprocess for direct LLM calls within the orchestrator.
 *
 * Uses the parent session's model so all LLM calls share the user's configured
 * provider and API keys without additional setup. Runs with `--no-extensions` to
 * prevent the MLS extension from loading in the subprocess (re-entrancy guard).
 *
 * No timeout is applied: high-reasoning models (e.g., o1, Opus) can take 3–5+ minutes
 * for complex prompts and must not be killed prematurely.
 */
export class LlmClient {
  private model: string | undefined;

  /**
   * @param model - Parent model in `"provider/id"` format (e.g., `"anthropic/claude-opus-4-5"`).
   *   Pass `undefined` to let `pi` use its default configured model.
   */
  constructor(model?: string) {
    this.model = model;
  }

  /**
   * Execute a single LLM call and return the final assistant text.
   *
   * The system prompt is written to a temp file to avoid shell-escaping issues with
   * long or special-character prompts. The temp file is deleted in a `finally` block
   * so cleanup is guaranteed even when the call rejects.
   *
   * @param systemPrompt - Full system prompt text.
   * @param userPrompt - User turn text passed as the `pi` positional argument.
   * @param opts - Optional signal, tier hint, and streaming progress callback.
   * @returns The final assistant text from the model.
   * @throws If the subprocess exits non-zero and produced no output.
   */
  async call(
    systemPrompt: string,
    userPrompt: string,
    opts: LlmCallOptions = {},
  ): Promise<string> {
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "mls-llm-"));
    const promptFile = path.join(tmpDir, "system.md");
    await fs.promises.writeFile(promptFile, systemPrompt, "utf-8");

    try {
      return await spawnPi(promptFile, userPrompt, this.model, opts.signal, opts.onProgress);
    } finally {
      try { fs.unlinkSync(promptFile); } catch {}
      try { fs.rmdirSync(tmpDir); } catch {}
    }
  }
}

/**
 * Spawn a stateless `pi` subprocess and collect the final assistant text.
 *
 * Key flags:
 * - `--no-extensions`         Prevents MLS (and all other extensions) from loading in the
 *                             subprocess, avoiding re-entrant orchestrator invocations.
 * - `--no-session`            Stateless call — no session history is read or written.
 * - `--no-tools`              Disables all tools — LLM calls for classification and gate
 *                             evaluation should not read, write, or execute anything.
 * - `--append-system-prompt`  Passes the system prompt via a temp file path rather than
 *                             inline, avoiding shell-escaping issues with long prompts.
 * - `--model` (position 6)    Spliced at index 6 to preserve the arg order expected by `pi`.
 *
 * Resolution: rejects only when `output` is empty AND `code !== 0`. Empty output with
 * exit 0 (e.g., model returned nothing) resolves to an empty string rather than rejecting,
 * so callers can handle that case explicitly.
 *
 * @param promptFile - Path to the temp file containing the system prompt.
 * @param userPrompt - Text of the user turn, passed as the `pi` positional argument.
 * @param model      - Optional `"provider/id"` model string.
 * @param signal     - Optional abort signal; sends SIGTERM to the subprocess on abort.
 * @param onProgress - Called with the latest non-empty text line as the model streams.
 */
function spawnPi(
  promptFile: string,
  userPrompt: string,
  model?: string,
  signal?: AbortSignal,
  onProgress?: (text: string) => void,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const args = [
      "--mode", "json", "-p",
      "--no-session",
      "--no-extensions",
      "--no-tools",
      "--append-system-prompt", promptFile,
    ];
    if (model) args.splice(6, 0, "--model", model);

    const proc = spawn("pi", args, {
      cwd: process.cwd(), shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Pass user prompt via stdin to avoid CLI parsing issues with leading dashes
    proc.stdin.write(userPrompt);
    proc.stdin.end();

    let buffer = "";
    let output = "";
    let stderr = "";
    const textChunks: string[] = [];

    proc.stdout.on("data", (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const delta = parseTextDelta(line);
        if (delta && onProgress) {
          textChunks.push(delta);
          const lastLine = textChunks.join("").split("\n").filter((l: string) => l.trim()).pop() ?? "";
          if (lastLine) onProgress(lastLine);
        }
        output = parseAssistantText(line) ?? output;
      }
    });

    proc.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });

    proc.on("close", (code: number | null) => {
      if (buffer.trim()) output = parseAssistantText(buffer) ?? output;
      if (!output && code !== 0) {
        reject(new Error(`LLM exited ${code}. stderr: ${stderr.slice(0, 500)}`));
      } else {
        resolve(output);
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`LLM spawn failed: ${err.message}`));
    });

    if (signal) {
      signal.addEventListener("abort", () => proc.kill("SIGTERM"), { once: true });
    }
  });
}

/**
 * Parse a single JSON SSE line and extract a streaming text delta.
 *
 * Returns the delta string only when the event is a `message_update` carrying
 * an `assistantMessageEvent` of type `text_delta`. Returns `null` for all other
 * event types (thinking deltas, tool events, `message_end`, malformed JSON, etc.).
 *
 * @param line - A single newline-delimited JSON string from the `pi` subprocess stdout.
 * @returns The text delta string, or `null` if this line is not a text delta.
 */
export function parseTextDelta(line: string): string | null {
  if (!line.trim()) return null;
  try {
    const e = JSON.parse(line);
    if (e.type === "message_update") {
      const ame = e.assistantMessageEvent;
      if (ame?.type === "text_delta") return ame.delta ?? null;
    }
    return null;
  } catch { return null; }
}

/**
 * Parse a single JSON SSE line and extract the final assistant text from a `message_end` event.
 *
 * Handles both string `content` and content-block arrays (filtering for `type === "text"` blocks).
 * Returns `null` for any line that is not a `message_end` event with `role === "assistant"`.
 *
 * @param line - A single newline-delimited JSON string from the `pi` subprocess stdout.
 * @returns The complete assistant text, or `null` if this line is not a matching `message_end`.
 */
export function parseAssistantText(line: string): string | null {
  if (!line.trim()) return null;
  try {
    const e = JSON.parse(line);
    if (e.type !== "message_end" || e.message?.role !== "assistant") return null;
    const c = e.message.content;
    if (typeof c === "string") return c;
    if (Array.isArray(c)) return c.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
    return null;
  } catch { return null; }
}
