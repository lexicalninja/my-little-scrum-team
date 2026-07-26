# Configuration

Learn how to set up MLS with your preferred LLM provider and customize behavior.

## Setting Up Your Provider

MLS uses models configured in **pi** (the parent CLI). You don't configure providers in MLS directly—instead, you:

1. **Configure your provider in pi** (OpenAI, Anthropic, Google, local, etc.)
2. **Choose which model to use** in `.mls/config.json` using the `"provider/id"` format

Providers and models are managed by pi. See the [pi documentation](https://pi.dev) for:
- How to set up OpenAI, Anthropic, Google, or local models
- How to configure API keys and endpoints
- How to view available models

Once pi is configured, you can override which model MLS uses in `.mls/config.json`.

### Check Available Models in Pi

To see all models available to pi:

```bash
pi --models
```

You'll see output like:
- `openai/gpt-4o`
- `openai/gpt-4-turbo`
- `anthropic/claude-opus-4-5`
- `anthropic/claude-sonnet-4-5`
- `google/gemini-2.0-flash`

Use these exact strings in your MLS config.

### Current Model in Pi

To see which model pi is currently using:

```bash
pi status
```

MLS will use this model by default unless you override it in `.mls/config.json`.

## Configuration Levels

MLS supports configuration at three levels, with lower levels overriding higher levels:

### 1. User Level (Home Directory)

Global settings for all projects on your machine.

**Location:** `~/.mls/config.json`

**Use for:**
- Your preferred LLM models
- Default execution profiles
- Your team's standard configuration

**Example:**
```bash
# Create user config
mkdir -p ~/.mls
cat > ~/.mls/config.json << 'EOF'
{
  "models": {
    "default": "openai/gpt-4o"
  },
  "executionProfile": {
    "name": "balanced"
  }
}
EOF
```

### 2. Project Level (Repository Root)

Overrides user settings for a specific project.

**Location:** `.mls/config.json`

**Use for:**
- Project-specific models (e.g., cheaper model for dev, faster for prod)
- Project-specific execution profiles
- Project-specific customizations

**Example:**
```bash
# Create project config
mkdir -p .mls
cat > .mls/config.json << 'EOF'
{
  "models": {
    "default": "openai/gpt-4-turbo",
    "coding": "openai/gpt-4o"
  },
  "executionProfile": {
    "maxReviewIterations": 1,
    "maxTestRetries": 1
  }
}
EOF
```

### 3. Environment Variables (Runtime)

Environment variables in pi are handled by pi itself, not MLS.

## Configuration Precedence

Settings are merged in this order (lowest to highest priority):

```
1. Pi's active model (from pi's configuration)
   ↓
2. ~/.mls/config.json (user level)
   ↓
3. .mls/config.json (project level)
```

**Example:** If pi has `openai/gpt-4o` active, but you set `"default": "openai/gpt-4-turbo"` in ~/.mls/config.json, and then `"coding": "anthropic/claude-opus-4-5"` in .mls/config.json:
- Default model: `openai/gpt-4-turbo` (from user level)
- Coding model: `anthropic/claude-opus-4-5` (from project level)
- All other roles: `openai/gpt-4-turbo` (from user level)

## Configuration File

Create `.mls/config.json` in your project root:

```json
{
  "models": {
    "default": "openai/gpt-4o",
    "coding": "openai/gpt-4o",
    "planning": "openai/gpt-4o",
    "scrumMaster": "openai/gpt-4o",
    "review": "openai/gpt-4o",
    "tests": "openai/gpt-4o",
    "agents": {
      "mls-spec-writer": "openai/gpt-4o",
      "mls-scrum-master": "openai/gpt-4o",
      "mls-impl-engineer": "openai/gpt-4o"
    }
  },
  "executionProfile": {
    "name": "balanced",
    "group1Concurrency": 3,
    "group2Concurrency": 4,
    "maxReviewIterations": 2,
    "maxTestRetries": 3,
    "enablePhase0": true,
    "enableSpecGate": true,
    "enableReviewGate": true,
    "sequentialGroup1": false,
    "skipAgentsMdExtraction": false
  },
  "humanGates": ["post-spec", "post-tasks"],
  "pipelineMode": "full",
  "providers": {
    "openai": {
      "concurrency": 5,
      "spawnDelayMs": 100
    }
  }
}
```

### About Providers and Models

MLS uses the model system from **pi** (the parent CLI). Models are specified as `"provider/id"` strings.

**Common model format examples:**
- `"openai/gpt-4o"` — OpenAI's latest model
- `"openai/gpt-4-turbo"` — OpenAI's faster variant
- `"anthropic/claude-opus-4-5"` — Anthropic's most capable model
- `"anthropic/claude-sonnet-4-5"` — Anthropic's balanced model
- `"google/gemini-2.0-flash"` — Google's fast model

To see all available models configured in **pi**, run:

```bash
pi --models
```

Models are configured in pi's configuration, not in `.mls/config.json`. If you don't specify a model in MLS config, it uses whatever model is currently active in pi.

### Configuration Options

#### `models` (Optional)

Configure which LLM model to use for different tasks and agents.

**Specify models as:** `"provider/id"` strings (e.g., `"openai/gpt-4o"`, `"anthropic/claude-opus-4-5"`)

**default:** Default model for all tasks (string)
- Used when no specific model is configured for a task/agent
- Example: `"openai/gpt-4o"`

**build:** Model for entire build process (string)
- Overrides default for all build phases
- Example: `"openai/gpt-4o"`

**prd:** Model for PRD generation (string)
- Used when generating product requirement documents
- Example: `"openai/gpt-4o"`

**coding:** Model for code generation (string)
- Used by impl-engineer and infra-engineer agents
- Example: `"openai/gpt-4o"` or `"anthropic/claude-opus-4-5"` for higher quality

**planning:** Model for planning tasks (string)
- Used by spec-writer and scrum-master agents
- Example: `"openai/gpt-4o"`

**scrumMaster:** Model for task orchestration (string)
- Used by scrum-master agent for breaking down tasks
- Example: `"anthropic/claude-opus-4-5"` for better reasoning

**review:** Model for code review (string)
- Used by code-reviewer agent
- Example: `"openai/gpt-4o"`

**tests:** Model for test generation (string)
- Used by test-runner agent
- Example: `"openai/gpt-4o"` or cheaper option like `"openai/gpt-4-turbo"`

**agents:** Per-agent model overrides (object)
- Override model for specific agents
- Keys: Agent names (e.g., `"mls-spec-writer"`, `"mls-impl-engineer"`)
- Values: `"provider/id"` model strings

Example (use expensive model for planning, cheaper for tests):
```json
{
  "models": {
    "default": "openai/gpt-4-turbo",
    "planning": "anthropic/claude-opus-4-5",
    "tests": "openai/gpt-4-turbo",
    "agents": {
      "mls-spec-writer": "anthropic/claude-opus-4-5",
      "mls-test-runner": "openai/gpt-4-turbo"
    }
  }
}
```

#### `executionProfile` (Optional)

Configure how MLS orchestrates agents and handles iterations. This is a nested object inside the main config.

**name:** Profile name for logging (string, default: `"custom"`)
- Cosmetic — used in log output only
- Example: `"fast"`, `"thorough"`, `"custom"`

**group1Concurrency:** Max parallel agents in Group 1 (design/infra/docs phase) (number, default: varies)
- Controls how many "design" agents run simultaneously
- Range: 1-10
- Higher = faster but more API calls

**group2Concurrency:** Max parallel implementation tasks per batch (number, default: varies)
- Controls how many "coding" agents run simultaneously
- Range: 1-10
- Higher = faster but more API calls

**maxReviewIterations:** Max code review loops before escalation (number, default: varies)
- If code is rejected this many times, task is escalated
- Range: 1-5
- Higher = more iterations to get it right

**maxTestRetries:** Max test fix attempts before escalation (number, default: varies)
- If tests fail this many times, task is escalated
- Range: 1-5
- Higher = more attempts to fix failing tests

**enablePhase0:** Run idea refinement phase (boolean, default: `true`)
- Phase 0 clarifies non-requirement input with LLM
- Set to `false` to skip if input is already clear

**enableSpecGate:** Run spec completeness check (boolean, default: `true`)
- LLM gate validates specification after Phase 1
- Set to `false` to skip and accept specs as-is

**enableReviewGate:** Run code review gate (boolean, default: `true`)
- LLM gate validates code quality after implementation
- Set to `false` to auto-approve code after first review

**sequentialGroup1:** Run Group 1 tasks sequentially (boolean, default: `false`)
- If `true`, design/infra agents run one-by-one instead of in parallel
- Set to `true` for lower API usage, slower overall

**skipAgentsMdExtraction:** Skip AGENTS.md parsing (boolean, default: `false`)
- If `true`, skip LLM call to extract tech stack from AGENTS.md
- Set to `true` to save context/cost on subsequent builds

Example for "fast" profile (low cost, high speed):
```json
{
  "executionProfile": {
    "name": "fast",
    "group1Concurrency": 5,
    "group2Concurrency": 6,
    "maxReviewIterations": 1,
    "maxTestRetries": 1,
    "enablePhase0": false,
    "enableSpecGate": false,
    "enableReviewGate": false,
    "sequentialGroup1": false
  }
}
```

Example for "thorough" profile (high quality, slower):
```json
{
  "executionProfile": {
    "name": "thorough",
    "group1Concurrency": 2,
    "group2Concurrency": 2,
    "maxReviewIterations": 3,
    "maxTestRetries": 4,
    "enablePhase0": true,
    "enableSpecGate": true,
    "enableReviewGate": true,
    "sequentialGroup1": true
  }
}
```

#### `providers` (Optional)

Configure provider-specific behavior.

**concurrency:** Max concurrent API requests to this provider (number)
- Example: `5` for OpenAI, `2` for Anthropic

**spawnDelayMs:** Delay between spawning agents (milliseconds, number)
- Helps avoid rate limits
- Example: `100` for 100ms delay between agents

Example:
```json
{
  "providers": {
    "openai": {
      "concurrency": 10,
      "spawnDelayMs": 50
    },
    "anthropic": {
      "concurrency": 3,
      "spawnDelayMs": 200
    }
  }
}
```

#### `humanGates` (Optional, Top-Level)

Top-level override for human approval gates. This goes at the root of your config, NOT inside executionProfile.

**Type:** Array of gate points
**Options:** `"post-spec"`, `"post-tasks"`, `"post-design"`, `"on-escalation"`, `"post-review"`
**Default:** `[]` (no gates, fully autonomous)

Gate point descriptions:
- `"post-spec"` — After spec is written, before task breakdown
- `"post-tasks"` — After tasks are broken down, before implementation
- `"post-design"` — After design/infra work, before implementation
- `"on-escalation"` — When a task hits max iterations/retries
- `"post-review"` — After code review, before marking complete

Example:
```json
{
  "humanGates": ["post-spec", "post-tasks"]
}
```

#### `pipelineMode` (Optional, Top-Level)

Top-level override for pipeline execution mode. This goes at the root of your config, NOT inside executionProfile.

**Type:** String
**Options:** `"full"`, `"gated"`, `"review-only"`
**Default:** `"full"`

- `"full"` — Run all phases (default)
- `"gated"` — Pause at human gates for approval
- `"review-only"` — Stop after Phase 2 (planning only, no implementation)

Example:
```json
{
  "pipelineMode": "review-only"
}
```

#### `mode` (Optional, Top-Level)

Shorthand to activate the built-in local execution profile. Only `"local"` is supported.

```json
{
  "mode": "local"
}
```

Setting `"mode": "local"` is equivalent to using the local profile: sequential execution (`group1Concurrency: 1`, `group2Concurrency: 1`), all LLM gates disabled, minimal retries. Intended for Ollama or LM Studio where concurrency causes GPU/CPU contention.

Ollama and LM Studio providers also activate the local profile automatically without needing this setting.

## Environment Variables

Never commit API keys. Use environment variables instead.

### User Level Setup (Recommended)

Store API keys in your shell profile so they're available in all projects:

**Add to your shell profile** (`~/.bashrc`, `~/.zshrc`, `~/.bash_profile`, etc.):

```bash
# LLM Provider API Keys
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."
export GOOGLE_API_KEY="..."
```

Then reload your shell:
```bash
source ~/.zshrc  # or ~/.bashrc
```

Verify it's set:
```bash
echo $OPENAI_API_KEY
```

### Project Level Setup

Create `.env` file in your project (do not commit):

```bash
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=...
```

Add to `.gitignore`:
```bash
.env
.env.local
```

### GitHub Actions

Set secrets in repository settings → Secrets and variables → Actions:

1. Go to your GitHub repo
2. Settings → Secrets and variables → Actions
3. Click "New repository secret"
4. Name: `OPENAI_API_KEY`
5. Value: Your API key
6. Click "Add secret"

Then use in `.github/workflows/build.yml`:

```yaml
env:
  OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

## Validation

MLS reads your configuration on startup, but it does not comprehensively validate every field.

If something is not working as expected, manually check that:
- `.mls/config.json` contains valid JSON
- Model names use the `"provider/id"` format expected by pi
- Concurrency values are numeric and appropriate for your API quota
- `pipelineMode` is one of: `"full"`, `"gated"`, `"review-only"`
- `humanGates` only includes supported gate points
- Iteration-related settings are numeric values that make sense for your workflow

## Best Practices

### Performance
✅ Set `group1Concurrency` and `group2Concurrency` based on your API quota  
✅ Use `maxReviewIterations: 2` and `maxTestRetries: 3` for balance  
✅ Set `pipelineMode: "review-only"` for planning-only builds  
✅ Enable `humanGates` for critical features  
✅ Use `sequentialGroup1: true` to reduce concurrent API calls  
❌ Don't set concurrency too high (will hit rate limits)  
❌ Don't set concurrency too low (will be very slow)  

### Model Selection
✅ Use `gpt-4o` or `claude-opus` for best quality  
✅ Override coding model separately if budget is tight  
✅ Use different models for dev vs. production  
✅ Set per-agent overrides for specialized tasks  
❌ Don't use slow models (takes 2-3x longer)  

### Cost Control
✅ Use cheaper models for non-critical tasks (e.g., tests)  
✅ Set `maxReviewIterations: 1` and `maxTestRetries: 1` to save cost  
✅ Use `sequentialGroup1: true` to reduce parallelism  
✅ Skip `enablePhase0` and `enableSpecGate` if specs are clear  
❌ Don't leave concurrency unlimited  
❌ Don't run full builds for simple changes  

## Troubleshooting

### "Build times out"
- Check `group1Concurrency` and `group2Concurrency` aren't too high
- Models may be slow; try `gpt-4o` instead of other models
- Reduce scope of the feature request
- Check internet connection to API provider

### "Too many API calls / rate limited"
- Reduce `group1Concurrency` and `group2Concurrency`
- Increase `spawnDelayMs` in provider config
- Set `sequentialGroup1: true` to run sequentially
- Skip `enablePhase0` and `enableSpecGate`

### "Code quality is bad"
- Increase `maxReviewIterations` and `maxTestRetries`
- Enable `humanGates: ["post-spec", "post-tasks"]`
- Use higher-quality model (e.g., `gpt-4o`)
- Set `pipelineMode: "review-only"` to plan first

### "Tests keep failing"
- Increase `maxTestRetries` (default is 3)
- Check that test framework is installed
- Provide more context in the feature description
- Verify acceptance criteria are clear

### "Phase 0 / Phase 1 not running"
- Check `enablePhase0` is `true`
- Check `enableSpecGate` is `true`
- Check `pipelineMode` is `"full"` (not `"review-only"`)

## Next Steps

✅ Set up `.mls/config.json` with your preferred models  
✅ Configure `executionProfile` for your use case (fast, balanced, thorough)  
✅ Set `humanGates` at the top level if you need approval checkpoints  
✅ Test with a simple feature first

Continue to [Advanced Usage](../advanced/) to learn about specialist agents and orchestration.
