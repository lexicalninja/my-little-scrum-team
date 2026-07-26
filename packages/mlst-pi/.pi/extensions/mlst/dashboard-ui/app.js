/**
 * MLST Dashboard — Alpine.js application
 * Agent-centric: agents appear, grab tasks, show work, exit.
 *
 * Loaded after parsers.js (test output parsers) and handlers.js (event dispatch table).
 */

const PHASE_LIST = ["phase0", "phase1", "phase2", "scaffold", "phase3", "phase4"];
const PHASE_LABELS = {
  phase0: "Idea Refinement", phase1: "Specification", phase2: "Task Breakdown",
  scaffold: "Scaffolding", phase3: "Building", phase4: "Completion",
};
const TASK_ICONS = {
  open: "○", "in-progress": "◐", in_progress: "◐", testing: "◑",
  reviewing: "◕", closed: "✓", escalated: "✗", complete: "✓",
  pending: "○", blocked: "⊘",
};
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const REVIEW_ESCALATION_TERMS = ["hard-fail", "wreck", "meltdown", "cratered", "toast"];
const REVIEW_FAIL_TERMS = ["fail", "miss", "reject", "nope", "not-yet"];

// ─── Utilities ───────────────────────────────────────────────────────────────

function fmtTokens(n) { return n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`; }
function trunc(s, n) { return s && s.length > n ? s.slice(0, n) + "..." : s || ""; }
function fmt(ts) { return new Date(ts).toLocaleTimeString("en", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
function hashString(v) { let h = 0; for (let i = 0; i < v.length; i++) { h = ((h << 5) - h) + v.charCodeAt(i); h |= 0; } return Math.abs(h); }
function pickStableTerm(seed, terms) { return terms[hashString(seed) % terms.length]; }
function getReviewReason(ev) { if (ev.reason) return ev.reason; if (ev.approved) return "approved"; return ev.iteration >= ev.max ? "max-iterations" : "needs-fixes"; }
function isEscalatedReview(ev) { return ev.escalated ?? getReviewReason(ev) === "max-iterations"; }
function gateStatusClass(status) {
  switch (status) {
    case "approved": return "gate";
    case "rejected": case "timeout": return "review";
    case "waiting": case "analyzing": case "reviewing": return "agent";
    default: return "gate";
  }
}

function reviewSummary(ev) {
  const label = ev.label ?? ev.taskId;
  const title = ev.title ? `: ${ev.title}` : "";
  const prefix = `${label}${title} iter ${ev.iteration}/${ev.max}`;
  if (ev.approved) return `${prefix} APPROVED`;
  const terms = isEscalatedReview(ev) ? REVIEW_ESCALATION_TERMS : REVIEW_FAIL_TERMS;
  return `${prefix} ${pickStableTerm(`${ev.taskId}:${ev.iteration}`, terms)}`;
}

function highlight(text) {
  if (!text) return "";
  let html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) => {
    try {
      const hl = lang && hljs.getLanguage(lang) ? hljs.highlight(code.trim(), { language: lang }).value : hljs.highlightAuto(code.trim()).value;
      return `<pre><code class="hljs">${hl}</code></pre>`;
    } catch { return `<pre><code>${code}</code></pre>`; }
  });
  html = html.replace(/`([^`]+)`/g, '<code style="color: var(--green); opacity: 0.8;">$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong style="color: var(--text);">$1</strong>');
  html = html.replace(/^(#{1,3})\s+(.+)$/gm, (_m, h, t) => `<strong style="color: var(--text); font-size: ${h.length === 1 ? 14 : h.length === 2 ? 13 : 12}px;">${t}</strong>`);
  html = html.replace(/- \[ \]/g, '<span style="color: var(--muted);">☐</span>');
  html = html.replace(/- \[x\]/gi, '<span style="color: var(--green);">☑</span>');
  return html;
}

// ─── Event Display ───────────────────────────────────────────────────────────

const DISPLAY_EVENT_MAP = {
  sprint_start: (ev, base) => ({ ...base, tag: "START", tagClass: "phase", summary: `${trunc(ev.input, 70)} → ${ev.classification}`, detail: ev.input }),
  phase: (ev, base) => ({ ...base, tag: "PHASE", tagClass: "phase", summary: PHASE_LABELS[ev.phase] ?? ev.phase, detail: null }),
  agent_start: (ev, base) => ({ ...base, tag: "AGENT", tagClass: "agent", summary: `${ev.agent} started${ev.taskLabel ? ` (${ev.taskLabel})` : ""}`, detail: ev.prompt }),
  agent_end: (ev, base) => ({ ...base, tag: "AGENT", tagClass: "agent", summary: `${ev.agent} done${ev.model ? ` (${ev.model})` : ""}`, detail: ev.output, cost: `$${(ev.usage?.cost || 0).toFixed(4)}` }),
  llm_start: (ev, base) => ({ ...base, tag: "LLM", tagClass: "llm", summary: trunc(ev.purpose, 50), detail: `System:\n${trunc(ev.system, 500)}\n\nUser:\n${trunc(ev.user, 1000)}` }),
  llm_end: (ev, base) => ({ ...base, tag: "LLM", tagClass: "llm", summary: `${trunc(ev.purpose, 30)} → ${trunc(ev.response, 50)}`, detail: ev.response }),
  exec_start: (ev, base) => ({ ...base, tag: "CODE", tagClass: "code", summary: `${ev.command} ${ev.args.join(" ")}`, detail: null }),
  exec_end: (ev, base) => ({ ...base, tag: "CODE", tagClass: "code", summary: `${ev.command} → exit ${ev.code}`, detail: ev.stdout || null }),
  gate: (ev, base) => ({ ...base, tag: "GATE", tagClass: "gate", summary: `${ev.name.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase())}: ${ev.passed ? "PASS" : "FAIL"}`, detail: ev.issues?.length ? ev.issues.join("\n") : null }),
  task: (ev, base) => ({ ...base, tag: "TASK", tagClass: "phase", summary: `${ev.id} → ${ev.status.toUpperCase()}`, detail: null }),
  review: (ev, base) => ({ ...base, tag: "REVIEW", tagClass: "review", summary: reviewSummary(ev), detail: null, escalated: isEscalatedReview(ev) }),
  rate_limit: (ev, base) => ({ ...base, tag: "RATE", tagClass: "gate", summary: `Rate limited — backing off ${Math.round(ev.delayMs/1000)}s, concurrency → ${ev.concurrency}`, detail: null }),
  deletion_check: (ev, base) => ({ ...base, tag: "CHECK", tagClass: "gate", summary: `Deletion ${ev.tier}: ${ev.filesDeleted.length} files, -${ev.linesRemoved}/+${ev.linesAdded}`, detail: ev.warning || null }),
  checkpoint: (ev, base) => ({ ...base, tag: "CKPT", tagClass: "phase", summary: `Checkpoint: ${ev.ref}`, detail: null }),
  clarification: (ev, base) => ({ ...base, tag: "CLARIFY", tagClass: "agent", summary: `${ev.agent}: ${ev.questions.length} question(s)${ev.autonomous ? " (auto)" : ""}`, detail: ev.questions.join("\n") }),
  human_gate: (ev, base) => ({ ...base, tag: "GATE", tagClass: gateStatusClass(ev.status), summary: `Human Gate [${ev.gate}]: ${ev.status}${ev.feedbackRounds > 0 ? ` (${ev.feedbackRounds} rounds)` : ""}${ev.autonomous ? " (auto)" : ""}`, detail: ev.conversationSummary || null }),
  sprint_end: (ev, base) => ({ ...base, tag: "END", tagClass: "phase", summary: "Sprint complete", detail: ev.summary }),
};

function toDisplayEvent(ev) {
  const base = { timestamp: ev.timestamp, open: false, raw: ev, escalated: false };
  const fn = DISPLAY_EVENT_MAP[ev.type];
  return fn ? fn(ev, base) : { ...base, tag: "?", tagClass: "", summary: JSON.stringify(ev), detail: null };
}

// ─── Alpine Component ────────────────────────────────────────────────────────

document.addEventListener("alpine:init", () => {
  Alpine.data("mlst", () => ({
    status: "waiting",
    currentPhase: null,
    tasks: {},
    events: [],
    stats: { agents: 0, llm: 0, exec: 0, cost: 0, agentLlmCalls: 0, agentTokens: 0 },
    startTime: null,
    elapsed: "0s",
    allPhases: PHASE_LIST,
    // Active agents: keyed by a unique spawn ID
    _activeAgents: {},
    _agentHistory: [],
    _agentCounter: 0,
    _spinnerFrame: 0,
    // Test runner state
    testRuns: [],
    _testRunCounter: 0,
    _taskTests: {},  // taskId → [{ runNumber, results, exitCode, timestamp }]
    // Human gate state
    gates: [],
    gateCost: { llmCalls: 0 },
    // Multi-run state
    availableSessions: [],
    selectedSessionId: null,
    _hasExplicitSelection: false,
    _eventSource: null,
    // Pipeline steps (phases as task cards)
    _pipelineSteps: createPipelineSteps(),
    _activePipelineId: null,
    // Per-task/phase token tracking
    _taskTokens: {},    // taskId → total tokens
    _phaseTokens: {},   // phaseId → total tokens
    // Per-agent-type cumulative totals for the usage panel
    _agentTypeTotals: {},  // agentName → { tokens, cost, runs }

    get activeAgents() {
      return Object.values(this._activeAgents);
    },
    get agentHistory() {
      return this._agentHistory.slice().reverse();
    },
    get taskList() { return Object.entries(this.tasks).map(([id, t]) => ({ id, ...t })); },
    get pendingTasks() { return this.taskList.filter(t => t.status === "open" || t.status === "pending" || t.status === "in-progress" || t.status === "testing" || t.status === "reviewing"); },
    get doneTasks() { return this.taskList.filter(t => t.status === "complete" || t.status === "closed" || t.status === "escalated"); },
    get completedCount() { return this.doneTasks.filter(t => t.status === "complete" || t.status === "closed").length; },
    get totalTasks() { return this.taskList.length; },
    // Unified pipeline view: phases + tasks merged, each enriched with agents
    get taskView() {
      const enrichItem = (item) => {
        const active = Object.values(this._activeAgents).find(a => a.taskLabel === item.id);
        const history = this._agentHistory.filter(a => a.taskLabel === item.id);
        const testRuns = this._taskTests[item.id] || [];
        const latestTest = testRuns.length ? testRuns[testRuns.length - 1] : null;
        const tokens = (item.isPhase ? this._phaseTokens[item.id] : this._taskTokens[item.id]) || 0;
        return { ...item, activeAgent: active || null, agentHistory: history, testRuns, latestTest, tokens };
      };
      const prePhases = this._pipelineSteps.filter(s => s.id !== "phase4").map(enrichItem);
      const realTasks = this.taskList.map(enrichItem);
      const postPhases = this._pipelineSteps.filter(s => s.id === "phase4").map(enrichItem);
      return [...prePhases, ...realTasks, ...postPhases];
    },
    // Agents not tied to any task or phase
    get untaskedAgents() {
      return Object.values(this._activeAgents).filter(a => !a.taskLabel);
    },
    get untaskedHistory() {
      return this._agentHistory.filter(a => !a.taskLabel).reverse();
    },
    // Test runner computed
    get latestTestRun() { return this.testRuns.length ? this.testRuns[this.testRuns.length - 1] : null; },
    get testTree() {
      if (!this.latestTestRun) return [];
      return this.latestTestRun.results.files.map(file => {
        const history = this.testRuns.map(run => {
          const match = run.results.files.find(f => f.path === file.path);
          return match ? { runNumber: run.runNumber, status: match.status } : null;
        }).filter(Boolean);
        return { ...file, history };
      });
    },
    get testSummary() { return this.latestTestRun?.results?.summary || null; },

    get spinnerFrame() { return SPINNER[this._spinnerFrame % SPINNER.length]; },
    get progressPct() {
      if (!this.currentPhase) return 0;
      const idx = PHASE_LIST.indexOf(this.currentPhase);
      return this.status === "complete" ? 100 : Math.round(((idx + 0.5) / PHASE_LIST.length) * 100);
    },
    get progressLabel() { return PHASE_LABELS[this.currentPhase] ?? this.currentPhase ?? ""; },
    // Segmented progress: pre-phases + tasks + post-phase
    get progressSegments() {
      const segments = [];
      const phaseIdx = this.currentPhase ? PHASE_LIST.indexOf(this.currentPhase) : -1;
      // Pre-task phases: spec, breakdown
      segments.push({ label: "SPEC", status: phaseIdx > 0 ? "done" : phaseIdx === 0 ? "active" : "pending" });
      segments.push({ label: "PLAN", status: phaseIdx > 1 ? "done" : phaseIdx === 1 ? "active" : "pending" });
      // Task segments
      for (const t of this.taskList) {
        const s = t.status;
        let status = "pending";
        if (s === "complete" || s === "closed") status = "done";
        else if (s === "escalated") status = "escalated";
        else if (s === "in-progress" || s === "testing" || s === "reviewing") status = "active";
        segments.push({ label: t.id, status });
      }
      // If no tasks yet but in phase3, show placeholder
      if (this.taskList.length === 0 && phaseIdx >= 2) {
        segments.push({ label: "BUILD", status: "active" });
      }
      // Post-task phase
      segments.push({ label: "DONE", status: this.status === "complete" ? "done" : phaseIdx >= 4 ? "active" : "pending" });
      return segments;
    },

    connect() {
      const params = new URLSearchParams(window.location.search);
      this.selectedSessionId = params.get("sessionId") || null;
      this._hasExplicitSelection = !!params.get("sessionId");
      this.connectSSE();
      this.fetchSessions();
      setInterval(() => { this._spinnerFrame++; this.tick(); }, 80);
      setInterval(() => this.fetchSessions(), 5000);
    },

    connectSSE() {
      if (this._eventSource) this._eventSource.close();
      const url = this.selectedSessionId ? `/events?sessionId=${this.selectedSessionId}` : "/events";
      const source = new EventSource(url);
      source.onmessage = (e) => this.handleEvent(JSON.parse(e.data));
      this._eventSource = source;
    },

    fetchSessions() {
      fetch("/api/sessions").then(r => r.json()).then(data => {
        this.availableSessions = data.sessions || [];
        // Auto-select the only active session when no explicit selection has been made
        if (!this._hasExplicitSelection) {
          const active = this.availableSessions.filter(s => !s.ended);
          if (active.length === 1) {
            this.switchSession(active[0].sessionId);
          }
        }
      }).catch(() => {});
    },

    switchSession(sessionId) {
      this._hasExplicitSelection = true;
      this.selectedSessionId = sessionId || null;
      // Reset all state — SSE replay will rebuild it
      this.events = [];
      this.tasks = {};
      this._activeAgents = {};
      this._agentHistory = [];
      this._agentCounter = 0;
      this.testRuns = [];
      this._testRunCounter = 0;
      this._taskTests = {};
      this.gates = [];
      this.gateCost = { llmCalls: 0 };
      this.status = "waiting";
      this.currentPhase = null;
      this.startTime = null;
      this.stats = { agents: 0, llm: 0, exec: 0, cost: 0, agentLlmCalls: 0 };
      this.connectSSE();
      // Update URL without reload
      const url = new URL(window.location);
      if (sessionId) url.searchParams.set("sessionId", sessionId);
      else url.searchParams.delete("sessionId");
      history.replaceState(null, "", url);
    },

    handleEvent(ev) {
      // 1. Log (skip noisy progress events)
      if (ev.type !== "agent_progress") {
        this.events.push(toDisplayEvent(ev));
      }
      // 2. Stats
      updateStats(this.stats, ev);
      // 3. Dispatch state mutation
      const handler = EVENT_HANDLERS[ev.type];
      if (handler) handler(this, ev);
      // 4. Auto-scroll
      if (ev.type !== "agent_progress") {
        const scrollPanels = () => {
          const log = this.$refs.logScroll;
          if (log) log.scrollTop = log.scrollHeight;
          const orch = this.$refs.orchScroll;
          if (orch) orch.scrollTop = orch.scrollHeight;
        };
        this.$nextTick(() => { scrollPanels(); setTimeout(scrollPanels, 300); });
      }
    },

    findTaskTitle(label) {
      if (!label) return "";
      const t = this.tasks[label];
      return t?.title || "";
    },

    tick() {
      if (!this.startTime) return;
      const sec = Math.round((Date.now() - this.startTime) / 1000);
      this.elapsed = sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${sec % 60}s`;
    },

    get agentTypeList() {
      return Object.entries(this._agentTypeTotals).map(([name, t]) => ({
        name, displayName: this.shortAgent(name), ...t,
      })).sort((a, b) => b.tokens - a.tokens);
    },
    get totalTokens() { return Object.values(this._agentTypeTotals).reduce((s, t) => s + t.tokens, 0); },
    get totalCost() { return Object.values(this._agentTypeTotals).reduce((s, t) => s + t.cost, 0); },

    fmt,
    fmtTokens,
    highlight,
    taskIcon(status) { return TASK_ICONS[status] || "?"; },
    shortAgent(name) { return name ? name.replace("mlst-", "").replace(/-/g, " ").toUpperCase() : ""; },
    agentElapsed(a) {
      if (!a.startTime) return "";
      const sec = Math.round((Date.now() - a.startTime) / 1000);
      return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m${sec % 60}s`;
    },
    phaseClass(p) {
      if (!this.currentPhase) return "";
      const ci = PHASE_LIST.indexOf(this.currentPhase);
      const di = PHASE_LIST.indexOf(p);
      return di < ci ? "done" : di === ci ? "active" : "";
    },
    phaseLabel(p) { return PHASE_LABELS[p] || p; },
    gateCardClass(status) {
      switch (status) {
        case "waiting": case "analyzing": case "reviewing": return "gate-waiting";
        case "approved": return "gate-approved";
        case "rejected": return "gate-rejected";
        case "timeout": return "gate-timeout";
        default: return "";
      }
    },
    gateIcon(status) {
      switch (status) {
        case "waiting": return "⏳";
        case "analyzing": return "🔍";
        case "reviewing": return "✏️";
        case "approved": return "✅";
        case "rejected": return "❌";
        case "timeout": return "⏰";
        default: return "○";
      }
    },
    eventClasses(ev) {
      return {
        expandable: ev.detail,
        'phase-row': ev.tag === 'PHASE',
        'gate-pass': (ev.tag === 'GATE' && ev.raw?.passed) || (ev.tag === 'TASK' && ev.raw?.status === 'complete'),
        'gate-fail': ev.tag === 'GATE' && ev.raw?.passed === false,
        'review-fail': ev.tag === 'REVIEW' && ev.raw?.approved === false && !ev.escalated,
        'review-escalated': ev.tag === 'REVIEW' && ev.escalated,
        'task-escalated': ev.tag === 'TASK' && ev.raw?.status === 'escalated',
        'deletion-normal': ev.tag === 'CHECK' && ev.raw?.tier === 'normal',
        'deletion-large': ev.tag === 'CHECK' && ev.raw?.tier === 'large',
        'deletion-catastrophic': ev.tag === 'CHECK' && ev.raw?.tier === 'catastrophic',
      };
    },
  }));
});
