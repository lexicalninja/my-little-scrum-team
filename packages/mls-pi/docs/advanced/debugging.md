# Debugging Failed Builds

When builds fail, use these tools to diagnose and fix the problem.

## Common Issues and Fixes

### 1. Code Generation Failed

**Causes:**
- Model is slow (GPT-4 vs GPT-4o)
- Feature is too complex
- API is overloaded

**Fixes:**
```bash
# Use faster model
echo '{"models":{"default":"openai/gpt-4o"}}' > .mls/config.json

# Reduce scope — run a simpler, more focused /build
/build add simple validation

# Rebuild
/build
```

### 2. Tests Failing

**Diagnosis:**
```bash
# Run tests manually
npm test

# Check error details
npm test -- --verbose
```

**Fixes:**
```json
{
  "executionProfile": {
    "maxTestRetries": 3,
    "enablePhase0": true
  }
}
```

### 3. Code Review Failed

**Fixes:**
```bash
# Check feedback
cat .mls/sessions/*.jsonl | jq 'select(.type=="review")'

# Rebuild
/build
```

### 4. Database Issues

**Fixes:**
```bash
# Reset database
rm .mls/mls.db

# Rebuild
/build
```

### 5. API Key Errors

**Fixes:**
```bash
# Check API key is set
echo \$OPENAI_API_KEY

# Set it
export OPENAI_API_KEY="sk-..."

# Rebuild
/build
```

### 6. Memory Issues

**Fixes:**
```bash
# Reduce concurrency via config, then rebuild
/build
```

## Step-by-Step Debugging

1. **Check the logs**
2. **Identify the phase**
3. **Check generated code**
4. **Run manually**
5. **Fix and rebuild**

## Next Steps

- [Customize agents](./customization.md) if agents need tuning
- [Track costs](./cost-tracking.md) to understand spending
