# Monorepo Setup

Run MLS across multiple related projects in a monorepo.

## Directory Structure

```
workspace/
├── .mls/
│   ├── config.json (shared)
│   └── agents/ (shared)
├── packages/
│   ├── api/
│   │   └── .mls/
│   │       └── config.json (overrides)
│   ├── web/
│   │   └── .mls/
│   │       └── config.json (overrides)
│   └── mobile/
│       └── .mls/
│           └── config.json (overrides)
```

## Shared Configuration

Root `.mls/config.json`:

```json
{
  "models": {
    "default": "openai/gpt-4o"
  },
  "executionProfile": {
    "name": "balanced",
    "group1Concurrency": 3,
    "group2Concurrency": 3
  }
}
```

## Package-Specific Overrides

`packages/api/.mls/config.json`:

```json
{
  "models": {
    "default": "openai/gpt-4o"
  },
  "executionProfile": {
    "group1Concurrency": 2,
    "group2Concurrency": 4
  }
}
```

## Building All Packages

```bash
#!/bin/bash
# Run /build for each package by cd-ing into it and running pi
for pkg in api web mobile; do
  (cd "packages/\$pkg" && pi --command "/build add feature")
done
```

## Best Practices

✅ Share base config in root
✅ Override only what differs
✅ Use matrix CI/CD for parallel builds
✅ Build packages in dependency order
✅ Track costs per package

❌ Don't duplicate config
❌ Don't build unrelated packages together
❌ Don't skip testing

## Next Steps

- [Cost tracking](./cost-tracking.md) for per-package budgets
- [Debugging](./debugging.md) for monorepo issues
