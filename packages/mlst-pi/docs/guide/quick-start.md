# Quick Start

Get MLST running and build your first feature in under 5 minutes.

## 1. Install Pi

MLST is a Pi extension. First, install [Pi](https://pi.dev):

```bash
npm install -g @mariozechner/pi-coding-agent

# Verify installation
pi --version
```

See the [Pi documentation](https://pi.dev) for complete setup instructions.

## 2. Clone the Repository

The MLST extension is in the `my-little-scrum-team` repository:

```bash
git clone https://github.com/lexicalninja/my-little-scrum-team.git
cd my-little-scrum-team
```

MLST is located at: `packages/mlst-pi/`

## 3. Install MLST Dependencies

Install the extension's dependencies:

```bash
cd packages/mlst-pi
npm install
```

## 4. Install the Extension

Choose one method:

### Development (Symlink)
Changes take effect immediately:
```bash
npm run dev
```

### Global (Copy)
Available in all projects:
```bash
npm run install-ext
```

### Project-Local (Optional)
Only available in one repo:
```bash
cd /your/project
mkdir -p .pi/extensions
ln -s /path/to/my-little-scrum-team/packages/mlst-pi/.pi/extensions/mlst .pi/extensions/mlst
```

## 5. Verify Installation

Start pi in any project:

```bash
pi
```

You should see:
```
Available commands:
  /build                         Run a full MLST sprint
  /mlst-status                    Show current sprint status
```

If you don't see these, check:
- Pi is up to date: `pi --version`
- Extension symlink is valid: `ls ~/.pi/agent/extensions/mlst`
- No TypeScript errors: `cat ~/.pi/logs/pi.log | tail -20`

## 6. Run Your First Build

In any project with a git repo:

```bash
/build add a health check endpoint that returns {"status": "ok"}
```

Watch what happens:

1. **Phase 0** — MLST classifies this as a `feature` (takes ~3s)
2. **Phase 1** — spec-writer creates specification (takes ~15s)
3. **Phase 2** — scrum-master breaks into tasks (takes ~10s)
4. **Phase 3** — impl-engineer writes code, tests run, code review happens
5. **Phase 4** — Summary and completion

**Total time:** 2–5 minutes depending on your model provider

## 7. Watch the Dashboard

In another terminal window:

```bash
open http://localhost:4242
```

You'll see:

- **Left panel:** Orchestrator state, current phase, active agents
- **Top right:** Event log — phase transitions, agent spawns, gate results
- **Bottom right:** Test results — which tests passed/failed

Live updates via Server-Sent Events (SSE). Refresh if it doesn't load.

## 8. Check the Output

The build writes state to `.mlst/`:

```bash
# See the SQL database
sqlite3 .mlst/mlst.db "SELECT * FROM sprints ORDER BY created_at DESC LIMIT 1;"

# Watch the JSONL session log
tail -f .mlst/sessions/*.jsonl | jq .

# Show costs
cat .mlst/sessions/*.jsonl | jq 'select(.type == "agent_end") | {agent, cost: .usage.cost}'
```

## 9. Next: Configuration

Want to use a different model or adjust rate limiting?

See **[Configuration](./configuration.md)** for:
- Switching models (Anthropic, OpenAI, Google, etc.)
- Per-project model overrides
- Rate limiting and concurrency settings

## Troubleshooting

### `/build` command not found
- Make sure pi is running in the correct directory
- Check extension installed: `ls ~/.pi/agent/extensions/mlst/`
- Restart pi session

### Dashboard shows "Connection refused"
- Port 4242 might be in use: `lsof -i :4242`
- Try: `kill -9 <PID>` or wait 10s and refresh

### Build takes forever
- Check if rate limited: look for 429 errors in event log
- Increase spawn delay in `.mlst/config.json`
- Try a simpler description

### Tests keep failing
- Read agent logs: look at bottom-right test output panel
- Check acceptance criteria: are they clear enough?
- Try `/build` again with more specific description

## Next Steps

- **[Input Formats](./input-formats.md)** — Learn all four ways to describe a feature
- **[Build Phases](./phases.md)** — Understand what's happening in each phase
- **[Dashboard](./dashboard.md)** — Deep dive into the monitoring UI
- **[Configuration](./configuration.md)** — Set up models and providers
