# MLST Bug Report: writeFile Tool Call Fails Due to Invalid JSON from Model

## Summary

`mlst_build` fails mid-execution with:

```
Build failed: Invalid arguments for tool writeFile: JSON parsing failed
```

This happens when an agent (most commonly the test-writer) attempts to call `writeFile` with content containing indented code. The model emits literal control characters in the JSON string instead of properly escaping them, producing invalid JSON that the AI SDK cannot parse.

## Root Cause

**File:** `dist/src/agents/base-agent.js` — `generateText()` call

When gpt-4o-mini (and occasionally gpt-4o) generates a `writeFile` tool call that includes file content with indented code, it sometimes emits raw control characters (e.g., literal tab `\t` `0x09`) inside the JSON string value rather than the valid escape sequence `\\t`. This produces malformed JSON.

The call chain on failure:

1. Agent calls `generateText()` → model returns a `writeFile` tool call with invalid JSON args
2. `doParseToolCall()` in `ai/dist/index.js` calls `safeParseJSON({ text: toolCall.args, schema })`
3. `safeParseJSON` uses `secure-json-parse`, which rejects the raw control character → returns `{ success: false }`
4. `doParseToolCall` throws `InvalidToolArgumentsError`
5. `retryWithBackoff()` in `base-agent.js` **only retries on rate-limit errors** — this error propagates immediately
6. Build fails

## Evidence

- Error message from build output: `"JSON parsing failed: Text: {\"file_path\":\"index.test.js\",\"content\":\"describe('index.html', () => {\n    it(...) ...` followed by a long run of literal `\t` characters
- `retryWithBackoff` source confirms it only checks for `Rate limit` / `429` / `rate_limit` in the error message before retrying
- The AI SDK (`ai/dist/index.js`) includes `experimental_repairToolCall` support in `generateText()` for exactly this scenario — but it is not wired up in `base-agent.js`

## Relevant Source Locations

| File | Location | Notes |
|------|----------|-------|
| `dist/src/agents/base-agent.js` | `retryWithBackoff()` | Only retries rate-limit errors |
| `dist/src/agents/base-agent.js` | `generateText()` call | Missing `experimental_repairToolCall` |
| `node_modules/ai/dist/index.js` | `doParseToolCall()` | Where `InvalidToolArgumentsError` is thrown |
| `node_modules/@ai-sdk/provider-utils/dist/index.js` | `safeParseJSON()` | Uses `secure-json-parse` which rejects raw control chars |

## Suggested Fix

### Option A — Add `experimental_repairToolCall` (recommended)

The Vercel AI SDK's `generateText()` accepts `experimental_repairToolCall`, which is called when a tool call fails to parse. Add it to the `generateText()` call in `base-agent.js`:

```js
const result = await retryWithBackoff(() => generateText({
    model,
    system: fullSystemPrompt,
    prompt: context.userPrompt,
    tools: tools,
    maxSteps,
    experimental_repairToolCall: async ({ toolCall, error }) => {
        // Strip unescaped control characters (0x00–0x1F except \n, \r)
        // that models sometimes emit inside JSON string values
        const cleaned = toolCall.args.replace(/[\x00-\x09\x0B\x0C\x0E-\x1F]/g, '');
        return { ...toolCall, args: cleaned };
    },
    onStepFinish: (step) => { ... },
}), this.name);
```

This is the lowest-risk fix: the SDK calls the repair function only when parsing fails, cleans the args, and retries the parse before the error propagates.

### Option B — Also retry `InvalidToolArgumentsError` in `retryWithBackoff`

As a belt-and-suspenders complement to Option A, extend `retryWithBackoff` to catch this specific error class and retry the entire agent step:

```js
const isInvalidArgs = message.includes('Invalid arguments for tool') || message.includes('JSON parsing failed');
if ((!isRateLimit && !isInvalidArgs) || attempt === maxRetries) {
    throw error;
}
```

This is coarser (retries the whole agent call) but provides a fallback if the repair function cannot fix the args.

### Option C — Use gpt-4o for all writing tasks

The model router assigns gpt-4o-mini to some agents for cost reasons. Promoting test-writer and implementation-engineer to gpt-4o would reduce occurrence frequency, but not eliminate it entirely — gpt-4o also produces this error occasionally.

**Recommendation:** Option A alone should be sufficient. Option A + B together is the most robust.

## Affected Files (TypeScript source)

- `src/agents/base-agent.ts` — `generateText()` call and `retryWithBackoff()`

## Reproduction

From any empty git repo with MLST configured, run a build that involves writing test files (e.g., any implementation task with testing requirements):

```
mlst_build: Create a static website (single HTML file with inline CSS) featuring a cute
ASCII art kitty cat. No frameworks, no JavaScript — just a self-contained index.html.
```

The failure occurs during TASK-001 testing phase when the test-writer agent calls `writeFile`
to create `index.test.js` with indented Jest test content.
