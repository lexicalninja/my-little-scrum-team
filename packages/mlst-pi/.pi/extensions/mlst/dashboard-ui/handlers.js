/**
 * Event handler dispatch table — pure state mutations, no DOM side-effects.
 * Each handler: (state, ev) => void, where state is the Alpine component instance.
 */

const PIPELINE_STEPS = [
  { id: "phase0", title: "Refine idea", status: "pending", isPhase: true },
  { id: "phase1", title: "Write specification", status: "pending", isPhase: true },
  { id: "phase2", title: "Break down tasks", status: "pending", isPhase: true },
  { id: "phase4", title: "Generate summary", status: "pending", isPhase: true },
];

function createPipelineSteps() { return PIPELINE_STEPS.map(step => ({ ...step })); }

// ─── Handlers ────────────────────────────────────────────────────────────────

const EVENT_HANDLERS = {
  sprint_start(state, ev) {
    state.status = "running";
    state.startTime = ev.timestamp;
    state.testRuns = [];
    state._testRunCounter = 0;
    state._taskTests = {};
    state.gates = [];
    state.gateCost = { llmCalls: 0 };
    state._pipelineSteps = createPipelineSteps();
    state._activePipelineId = null;
    state._taskTokens = {};
    state._phaseTokens = {};
    state._agentTypeTotals = {};
  },

  sprint_end(state, ev) {
    state.status = ev.aborted ? "aborted" : "complete";
    state._activeAgents = {};
    for (const s of state._pipelineSteps) {
      if (s.status === "in-progress") s.status = "complete";
    }
  },

  phase(state, ev) {
    state.currentPhase = ev.phase;
    // Mark all earlier pipeline steps as complete (handles skipped phases)
    const stepIdx = state._pipelineSteps.findIndex(s => s.id === ev.phase);
    // For unknown phases (phase3/scaffold), mark all pre-task steps complete but NOT phase4
    const phase4Idx = state._pipelineSteps.findIndex(s => s.id === "phase4");
    const cutoff = stepIdx === -1 ? (phase4Idx === -1 ? state._pipelineSteps.length : phase4Idx) : stepIdx;
    for (let i = 0; i < cutoff; i++) {
      if (state._pipelineSteps[i].status !== "complete") state._pipelineSteps[i].status = "complete";
    }
    const step = stepIdx >= 0 ? state._pipelineSteps[stepIdx] : undefined;
    if (step) { step.status = "in-progress"; state._activePipelineId = step.id; }
    else { state._activePipelineId = ev.phase; }
  },

  task(state, ev) {
    state.tasks[ev.id] = { ...state.tasks[ev.id], status: ev.status, title: ev.title };
  },

  agent_start(state, ev) {
    const id = `agent-${state._agentCounter++}`;
    const effectiveLabel = ev.taskLabel || state._activePipelineId || "";
    state._activeAgents[id] = {
      id, agent: ev.agent, taskLabel: effectiveLabel,
      taskTitle: state.findTaskTitle(ev.taskLabel),
      startTime: ev.timestamp, toolCount: 0, progress: "",
    };
  },

  agent_end(state, ev) {
    const effectiveLabel = ev.taskLabel || state._activePipelineId || "";
    const tokens = (ev.usage?.input || 0) + (ev.usage?.output || 0);
    // Attribute tokens to task or phase
    if (ev.taskLabel && state.tasks[ev.taskLabel]) {
      state._taskTokens[ev.taskLabel] = (state._taskTokens[ev.taskLabel] || 0) + tokens;
    } else if (effectiveLabel) {
      state._phaseTokens[effectiveLabel] = (state._phaseTokens[effectiveLabel] || 0) + tokens;
    }
    // Track per-agent-type totals
    const cost = ev.usage?.cost || 0;
    if (!state._agentTypeTotals[ev.agent]) {
      state._agentTypeTotals[ev.agent] = { tokens: 0, cost: 0, runs: 0 };
    }
    state._agentTypeTotals[ev.agent].tokens += tokens;
    state._agentTypeTotals[ev.agent].cost += cost;
    state._agentTypeTotals[ev.agent].runs++;
    // Remove the matching active agent and add to history
    for (const [id, a] of Object.entries(state._activeAgents)) {
      if (a.agent === ev.agent && a.taskLabel === effectiveLabel) {
        state._agentHistory.push({
          ...a,
          endTime: ev.timestamp,
          duration: Math.round((ev.timestamp - a.startTime) / 1000),
          cost: ev.usage?.cost || 0,
          model: ev.model || "",
        });
        delete state._activeAgents[id];
        break;
      }
    }
  },

  agent_progress(state, ev) {
    for (const a of Object.values(state._activeAgents)) {
      const effectiveLabel = ev.taskLabel || state._activePipelineId || "";
      if (a.agent === ev.agent && a.taskLabel === effectiveLabel) {
        a.progress = ev.text;
        a.toolCount = ev.toolCount;
        break;
      }
    }
  },

  human_gate(state, ev) {
    const existing = state.gates.find(g => g.gate === ev.gate);
    if (existing) {
      Object.assign(existing, { status: ev.status, feedbackRounds: ev.feedbackRounds, autonomous: ev.autonomous, summary: ev.conversationSummary || existing.summary, timestamp: ev.timestamp });
    } else {
      state.gates.push({ gate: ev.gate, status: ev.status, feedbackRounds: ev.feedbackRounds, autonomous: ev.autonomous, summary: ev.conversationSummary || null, timestamp: ev.timestamp });
    }
    if (ev.status === "analyzing" || ev.status === "reviewing") {
      state.gateCost.llmCalls++;
    }
  },

  exec_end(state, ev) {
    if (!ev.stdout) return;
    const results = parseTestOutput(ev.stdout);
    if (!results) return;
    state._testRunCounter++;
    const run = { timestamp: ev.timestamp, results, runNumber: state._testRunCounter, exitCode: ev.code };
    state.testRuns.push(run);
    if (state.testRuns.length > 50) state.testRuns.shift();
    // Find the task currently in testing/in-progress/reviewing state
    const taskList = Object.entries(state.tasks).map(([id, t]) => ({ id, ...t }));
    const activeTask = taskList.find(t => t.status === "testing") || taskList.find(t => t.status === "in-progress" || t.status === "reviewing");
    if (activeTask) {
      if (!state._taskTests[activeTask.id]) state._taskTests[activeTask.id] = [];
      state._taskTests[activeTask.id].push(run);
    }
  },
};

// ─── Stats ───────────────────────────────────────────────────────────────────

function updateStats(stats, ev) {
  if (ev.type === "agent_start") stats.agents++;
  if (ev.type === "llm_start") stats.llm++;
  if (ev.type === "exec_start") stats.exec++;
  if (ev.type === "agent_end") {
    stats.cost += ev.usage?.cost || 0;
    stats.agentLlmCalls += ev.usage?.turns || 0;
    stats.agentTokens += (ev.usage?.input || 0) + (ev.usage?.output || 0);
  }
}
