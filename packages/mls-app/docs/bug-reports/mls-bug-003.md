# MLS Bug 003: MCP Server Uses AutoInteraction — Clarifying Questions Never Surface to User

## Summary

When `mls_build` is invoked via the MCP server, Phase 0 (Idea Refinement) silently auto-accepts all prompts instead of asking the user for input. Vague descriptions stall the pipeline with 0 tasks completed and no user notification.

## Observed Behavior

- `mls_build` called with: `"Make a static website with a kitty cat on it."`
- Build completes reporting `Tasks Completed: 0/0`
- No questions are surfaced to the calling agent (Claude Code)
- `specification.md` contains clarifying questions written *to the void*
- `decisionRecord` has an empty `## User Refinement` section

## Root Cause

**File:** `src/mcp/server.js` (line 14)

```js
const interaction = new AutoInteraction();
const engine = new OrchestrationEngine(config, interaction);
```

The MCP server hardcodes `AutoInteraction` for all builds. `AutoInteraction` (defined in `src/interaction/cli.js`) silently returns `''` for every `ask()` call and `true` for every `confirm()` call — it never blocks or notifies anyone.

### What should happen (Phase 0 code in `src/orchestrator/phases.js`):

```js
const questions = await ctx.interaction.ask(
  `Let me help refine this idea. What are the key constraints or requirements I should know about?\n\n` +
  `Original input: "${ctx.state.input.slice(0, 200)}..."`
);
```

This call returns `''` immediately. The spec agent then receives an empty refinement and produces only clarifying questions, which get saved to `specification.md` but never returned to the caller.

### Why the pipeline doesn't stall visibly

Quality Gate 1 (`gateSpecificationReview`) would normally catch a bad spec and call `ctx.interaction.ask()` for clarification — but that also auto-accepts and returns `''`. The build then proceeds through Phase 2 (task breakdown), which also produces no real tasks since the spec is just a list of questions. Phase 4 completes with `0/0` tasks.

## Relevant Files

```
src/mcp/server.js              ← hardcodes AutoInteraction
src/interaction/cli.js         ← AutoInteraction and CLIInteraction implementations
src/orchestrator/phases.js     ← Phase 0 calls ctx.interaction.ask() / confirm()
src/orchestrator/engine.js     ← passes interaction through context to phases
src/mcp/tools.js               ← mls_build handler (no clarification mechanism)
```

## Suggested Fix Routes

### Option A: Interrupt-and-Resume via Tool Response (Recommended)

Add a new `needs_clarification` event type. When `ctx.interaction.ask()` is called during an MCP build, instead of blocking or auto-accepting, collect the question and **return early** from `mls_build` with a structured response indicating clarification is needed.

The calling agent (Claude Code) reads the question, asks the user, then calls `mls_resume` with `context` set to the user's answer.

**Changes needed:**
1. Create `src/interaction/mcp-interaction.js` — an `MCPInteraction` class that, instead of prompting stdin, throws a typed `ClarificationNeeded` error (or resolves a deferred promise) with the question text.
2. In `src/mcp/tools.js` — catch `ClarificationNeeded` in the `mls_build` handler and return `{ needs_clarification: true, question: "...", runId: "..." }`.
3. In `src/mcp/server.js` — instantiate `MCPInteraction` instead of `AutoInteraction`.
4. In `src/mcp/tools.js` `mls_resume` handler — inject `resumeContext` as the answer to the pending question before re-running Phase 0.

**Pros:** Clean separation; the MCP contract stays simple (tool call → response); calling agents can relay questions naturally.
**Cons:** Requires the calling agent to recognize the `needs_clarification` response shape and loop back.

---

### Option B: Front-Load Clarification in the Tool Description

Update the `mls_build` tool description to instruct the calling agent (Claude Code) to gather requirements *before* calling the tool, and only call `mls_build` with a fully-specified description.

**Changes needed:**
1. Update `mls_build` description in `src/mcp/tools.js` to explicitly state: *"Before calling this tool, ask the user for: purpose, tech stack, design preferences, and any constraints. Pass all details in `description`."*
2. Optionally add a `skipRefinement` flag (default `true` in MCP mode) to skip Phase 0 entirely for MCP callers and go straight to Phase 1.

**Pros:** Minimal code change; no new interaction protocol needed.
**Cons:** Relies on the calling agent following instructions; doesn't fix the underlying architecture.

---

### Option C: Emit Questions as MCP Tool Events

Surface the clarifying questions as part of the `mls_build` return payload (alongside `events`), using a new `clarification_needed` event type in the event stream. The calling agent reads these events and prompts the user before calling `mls_resume`.

**Changes needed:**
1. Add `clarification_needed` to the event type union in `src/orchestrator/engine.js`.
2. Modify `MCPInteraction` to emit this event (via `onEvent`) and pause execution until `mls_resume` is called with an answer.
3. Update `mls_build` in `src/mcp/tools.js` to include `clarification_needed` events in its filtered event list.

**Pros:** Fits the existing event-driven architecture.
**Cons:** More complex; requires async coordination between `mls_build` (which must not complete) and `mls_resume` (which delivers the answer) — likely needs a pending-state mechanism in the run store.

## Recommended Path

**Option A** is the cleanest fix. The interrupt-and-resume pattern maps naturally to how MCP tools work: one call gets a `needs_clarification` response with a `runId`, the calling agent relays the question to the user, and a second call to `mls_resume` with `context` containing the answer resumes from Phase 0.

The key implementation detail is that `MCPInteraction.ask()` should save the question to the run state and throw a typed error that `engine.build()` catches and converts to a clean `{ needs_clarification: true, question, runId }` return value rather than a build failure.

## Reproduction

```
cd /any/project/dir
mls_build: "Make a static website with a kitty cat on it."
# → Returns: Tasks Completed: 0/0, no user interaction
# → .mls/runs/<id>/specification.md contains unanswered clarifying questions
```

## Environment

- MLS version: check `package.json`
- Transport: stdio MCP (via Claude Code)
- Calling agent: Claude Code (claude-sonnet-4-6)
