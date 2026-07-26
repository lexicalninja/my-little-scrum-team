# Cost Tracking

Monitor your LLM spending to avoid surprises and optimize budgets.

## View Costs

### Last Build

Use `/mls-status` in pi to view the current sprint's status and cost summary.

To extract cost from session logs:

```bash
cat .mls/sessions/*.jsonl | jq 'select(.type=="agent_end") | {agent, cost: .usage.cost}'
```

## Cost per Model

| Model | Avg Cost |
|-------|----------|
| gpt-4o | \$10/M avg |
| gpt-4-turbo | \$20/M avg |
| gpt-3.5-turbo | \$1/M avg |
| claude-opus | \$45/M avg |
| claude-sonnet | \$9/M avg |

## Cost Optimization

### Strategy 1: Use Cheaper Models for Dev

```json
{
  "models": {
    "default": "openai/gpt-4-turbo",
    "coding": "openai/gpt-3.5-turbo",
    "tests": "openai/gpt-3.5-turbo"
  }
}
```

### Strategy 2: Reduce Concurrency

```json
{
  "executionProfile": {
    "group1Concurrency": 2,
    "group2Concurrency": 2
  }
}
```

### Strategy 3: Skip Optional Phases

```json
{
  "executionProfile": {
    "enablePhase0": false,
    "enableSpecGate": false,
    "skipAgentsMdExtraction": true
  }
}
```

## Next Steps

- [Configure models](../guide/configuration.md) for cost optimization
- [Debugging](./debugging.md) to fix expensive failures
