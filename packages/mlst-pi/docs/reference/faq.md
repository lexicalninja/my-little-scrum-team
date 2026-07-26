# FAQ

Common questions and answers.

## Can I run MLST on a private codebase?

Yes. Sprint data (specs, tasks, code reviews) is stored locally in `.mlst/mlst.db` and never leaves your machine.

Code context is sent to your configured LLM provider (Claude, ChatGPT, Google, etc.) during the build—the same as using those tools directly. You choose and control the provider.

MLST has no telemetry and uploads nothing to the project's maintainers.

## What data leaves my machine during a build?

Code context and generated content are sent to your configured LLM provider (Claude, ChatGPT, Google, etc.)—this is how the AI understands your codebase and generates specs/code.

Sprint state (specifications, tasks, code reviews, test results) stays locally in `.mlst/mlst.db`.

MLST has no telemetry, no tracking, and sends nothing to the project's maintainers or any third-party service. Your LLM provider choice is yours to control.

## Does MLST work with monorepos?

Yes, but be careful with scope. If you `/build add a feature`, it applies to the entire monorepo context. For monorepo-specific work, consider:
- Adding `@workspace/name` to the input to hint at scope
- Using a separate `/build` per workspace
- Or check the generated task list and abort if it's too broad

## What if a task fails?

Options:
1. **Retry** — Let the review loop iterate up to the configured `executionProfile.maxReviewIterations` limit (default: 3 in the cloud profile)
2. **Manual fix** — Edit the code yourself, then `/build` continues
3. **New `/build`** — Start fresh with refined input

## Can I use MLST with other pi extensions?

Yes. MLST is just another extension. Other extensions won't interfere.

## How long does a sprint take?

Typical ranges:
- **Simple feature** (e.g., add endpoint): 2–5 min
- **Medium feature** (e.g., auth flow): 5–15 min
- **Complex feature** (e.g., multi-page UI + infra): 15–30 min

Depends on:
- Feature complexity
- Your model's speed
- Model provider (free-tier slower than paid)
- Network latency

## Can I pause and resume a sprint?

Yes—if a `/build` is interrupted, you can try to resume the existing sprint with `/build --resume`.

Resume uses the sprint state stored locally in `.mlst/mlst.db` and continues from the existing sprint when recovery is possible.

Current limitations:
- **Manual resume:** MLST does not auto-resume on restart; you must run `/build --resume`
- **Existing sprint only:** Resume works only when there is recoverable sprint state in `.mlst/mlst.db`
- **Not a full pause feature:** This is recovery for an interrupted sprint, not an explicit pause/checkpoint workflow
- **Fresh start may still be needed:** If the saved state is missing, inconsistent, or no longer usable, start a new `/build`
## What languages does MLST support?

Any language that pi can work with:
- JavaScript/TypeScript ✅
- Python ✅
- Rust ✅
- Go ✅
- Java ✅
- Ruby ✅
- C#/.NET ✅
- etc.

MLST doesn't care about language. It's just coordinating agents who use read/write/bash.

## How much does MLST cost?

Depends on your model provider:
- **Free-tier** (Google, Gemini): $0/month (rate limited)
- **Paid API** (Anthropic, OpenAI): ~$0.10–$1.00 per sprint depending on feature size
- **Subscription** (Claude Pro, ChatGPT Plus): Included in subscription cost
- **Local** (Ollama, LM Studio): $0 (runs on your machine)

Dashboard shows cost per sprint. See **[Cost Tracking](../advanced/cost-tracking.md)** for optimization.

## Can I use MLST in CI/CD pipelines?

No. MLST is designed for interactive development inside pi. Run `/build` locally and commit the results.

## Does MLST work offline?

No. MLST needs network access to:
- Call your LLM provider (Claude, GPT, etc.)
- Fetch GitHub issues (if using `#N` input format)

Pi itself can work with local models (Ollama, LM Studio) if you set them up.

## What's the difference between MLST and just using pi?

| Aspect | Pi | MLST |
|--------|----|----|
| Agents | 1 | 7 specialized |
| Phases | Conversational | 5 structured phases |
| Orchestration | Manual | Automatic |
| Testing | Manual | TDD cycle enforced |
| Code review | Implicit | Explicit gate |
| Cost optimization | Configured by user | Automatic role-based routing |
| Time to feature | Depends on conversation | 2–15 min |

MLST is best for **autonomous batch development**. Pi is best for **interactive pair programming**.

## Can I customize agent prompts?

Yes. Edit `agents/*.md` files in the extension directory. Changes take effect on next `/build`.

See **[Customizing Agents](../advanced/customization.md)**.

## Does MLST generate comments or documentation?

By default, no. But you can:
- Add a skill that instructs agents to write comments
- Or use mlst-designer for documentation specs
- Or manually add comments after the fact

See **[Customization](../advanced/customization.md)** for adding skills to agents.

## How do I report bugs?

File an issue on GitHub: https://github.com/lexicalninja/my-little-scrum-team/issues

Include:
- Input you provided to `/build`
- Error messages from dashboard or JSONL logs
- What you expected to happen
- `.mlst/sessions/*.jsonl` log file (attach or paste tail)

## Where's the source code?

GitHub: https://github.com/lexicalninja/my-little-scrum-team

Extension is in `packages/mlst-pi/`. MIT licensed.
