/**
 * MLS Dashboard — Real-time observability via SSE
 *
 * Single HTTP server on port 4242 that multiplexes multiple concurrent sessions.
 * Each session gets a unique `sessionId`; SSE clients filter by `?sessionId=` query param.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { MlsEvent } from "./types.js";

const PORT = 4242;
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function toBase62(bytes: Buffer): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  if (n === 0n) return "0";
  let result = "";
  while (n > 0n) {
    result = BASE62[Number(n % 62n)] + result;
    n /= 62n;
  }
  return result;
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
};

/** Per-session state held by the singleton Dashboard. */
interface SessionState {
  sessionId: string;
  events: MlsEvent[];
  logStream: fs.WriteStream;
  logPath: string;
  startedAt: number;
  ended: boolean;
}

/**
 * Singleton HTTP server that multiplexes multiple MLS build sessions.
 *
 * Serves static files from `dashboard-ui/` on port 4242 and exposes:
 * - `/events?sessionId=<id>` — SSE endpoint filtered by session (omit for all sessions)
 * - `/api/sessions` — JSON list of active and completed sessions
 *
 * Each session produces its own `.mls/sessions/<sessionId>.jsonl` log file.
 * Use {@link Dashboard.acquire} to get the singleton and {@link Dashboard.createSession}
 * to start a new session.
 */
export class Dashboard {
  private static instance: Dashboard | null = null;

  private server: http.Server | null = null;
  /** SSE clients mapped to the sessionId they filter on (`null` = all sessions). */
  private clients = new Map<http.ServerResponse, string | null>();
  private sessions = new Map<string, SessionState>();
  private uiDir: string;
  private shutdownTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.uiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "dashboard-ui");
  }

  /**
   * Get or create the singleton Dashboard instance.
   * Starts the HTTP server on first call; subsequent calls return the existing instance.
   */
  static acquire(): Dashboard {
    if (!Dashboard.instance) {
      Dashboard.instance = new Dashboard();
      Dashboard.instance.start();
    }
    // Cancel any pending auto-shutdown since a new caller needs the server.
    if (Dashboard.instance.shutdownTimer) {
      clearTimeout(Dashboard.instance.shutdownTimer);
      Dashboard.instance.shutdownTimer = null;
    }
    return Dashboard.instance;
  }

  /** Reset the singleton (for testing). Stops the existing instance if running. */
  static resetInstance(): void {
    Dashboard.instance?.stop();
    Dashboard.instance = null;
  }

  /**
   * Start the HTTP server. Idempotent.
   */
  start(): void {
    if (this.server) return;
    this.server = http.createServer((req, res) => this.route(req, res));
    this.server.listen(PORT, "127.0.0.1");
  }

  /**
   * Create a new session. Returns a {@link SessionHandle} scoped to this session.
   * @param cwd - Project working directory. Session log files are written to `<cwd>/.mls/sessions/`.
   */
  createSession(cwd: string): SessionHandle {
    const sessionId = toBase62(crypto.randomBytes(16));

    const sessionsDir = path.join(cwd, ".mls", "sessions");
    if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir, { recursive: true });
    const logPath = path.join(sessionsDir, `${sessionId}.jsonl`);
    fs.writeFileSync(logPath, "");

    const session: SessionState = {
      sessionId,
      events: [],
      logStream: fs.createWriteStream(logPath, { flags: "a" }),
      logPath,
      startedAt: Date.now(),
      ended: false,
    };
    this.sessions.set(sessionId, session);
    return new SessionHandle(this, sessionId);
  }

  /**
   * Emit an event for a specific session.
   * Stamps `sessionId` on a copy of the event, stores it, broadcasts to matching SSE clients,
   * and appends to the session's JSONL log. Events for unknown or ended sessions are dropped.
   */
  emit(sessionId: string, event: MlsEvent): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.ended) return;
    const stamped = { ...event, sessionId };
    session.events.push(stamped);
    session.logStream?.write(JSON.stringify(stamped) + "\n");

    const data = `data: ${JSON.stringify(stamped)}\n\n`;
    for (const [client, filterSessionId] of this.clients) {
      if (filterSessionId === null || filterSessionId === sessionId) {
        client.write(data);
      }
    }
  }

  /**
   * End a session. Closes its log stream and schedules server auto-shutdown
   * if all sessions have ended.
   */
  endSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.ended) return;
    session.ended = true;
    session.logStream.end();

    // Schedule cleanup of session data after 60s with no SSE clients interested in it.
    setTimeout(() => {
      const hasClients = [...this.clients.values()].some(
        id => id === null || id === sessionId,
      );
      if (!hasClients) this.sessions.delete(sessionId);
    }, 60_000);

    // Auto-shutdown server if all sessions have ended.
    const allEnded = [...this.sessions.values()].every(s => s.ended);
    if (allEnded) {
      this.shutdownTimer = setTimeout(() => {
        const stillAllEnded = [...this.sessions.values()].every(s => s.ended);
        if (stillAllEnded) {
          this.stop();
          Dashboard.instance = null;
        }
      }, 5_000);
    }
  }

  /** Get the JSONL log path for a specific session. */
  sessionLogPath(sessionId: string): string | null {
    return this.sessions.get(sessionId)?.logPath ?? null;
  }

  /** IDs of sessions that have not yet ended. */
  activeSessionIds(): string[] {
    return [...this.sessions.values()].filter(s => !s.ended).map(s => s.sessionId);
  }

  /** Base URL of the dashboard server. */
  get url(): string {
    return `http://localhost:${PORT}`;
  }

  /**
   * Shut down the server and close all sessions.
   */
  stop(): void {
    if (this.shutdownTimer) {
      clearTimeout(this.shutdownTimer);
      this.shutdownTimer = null;
    }
    for (const [client] of this.clients) client.end();
    this.clients.clear();
    for (const session of this.sessions.values()) {
      if (!session.ended) {
        session.ended = true;
        session.logStream.end();
      }
    }
    this.server?.close();
    this.server = null;
  }

  // ─── HTTP routing ─────────────────────────────────────────────────────────

  private route(req: http.IncomingMessage, res: http.ServerResponse): void {
    const parsed = new URL(req.url ?? "/", `http://localhost:${PORT}`);
    if (parsed.pathname === "/events") return this.handleSSE(parsed, res);
    if (parsed.pathname === "/api/sessions") return this.handleApiSessions(res);
    this.serveFile(parsed.pathname === "/" ? "index.html" : parsed.pathname, res);
  }

  private handleSSE(url: URL, res: http.ServerResponse): void {
    const sessionId = url.searchParams.get("sessionId");

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    // Replay events for this session (or all sessions if no filter).
    if (sessionId) {
      const session = this.sessions.get(sessionId);
      if (session) {
        for (const event of session.events) res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } else {
      // All events across all sessions, sorted by timestamp.
      const allEvents = [...this.sessions.values()].flatMap(s => s.events);
      allEvents.sort((a, b) => a.timestamp - b.timestamp);
      for (const event of allEvents) res.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    this.clients.set(res, sessionId);
    res.on("close", () => this.clients.delete(res));
  }

  private handleApiSessions(res: http.ServerResponse): void {
    const sessions = [...this.sessions.values()].map(s => ({
      sessionId: s.sessionId,
      startedAt: s.startedAt,
      ended: s.ended,
      eventCount: s.events.length,
    }));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ sessions }));
  }

  private serveFile(urlPath: string, res: http.ServerResponse): void {
    const relativePath = urlPath.replace(/^\/+/, "");
    const filePath = path.resolve(this.uiDir, relativePath);
    if (!filePath.startsWith(this.uiDir) || !fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] ?? "text/plain" });
    fs.createReadStream(filePath).pipe(res);
  }
}

/**
 * Caller-facing handle for a single dashboard session.
 * Provides the same `emit()` / `runLogPath` / `url` / `stop()` interface
 * that the old monolithic Dashboard class had, so callers need minimal changes.
 */
export class SessionHandle {
  constructor(private dashboard: Dashboard, readonly sessionId: string) {}

  /** Emit an event scoped to this session. */
  emit(event: MlsEvent): void {
    this.dashboard.emit(this.sessionId, event);
  }

  /** Path to this session's JSONL log file. */
  get runLogPath(): string | null {
    return this.dashboard.sessionLogPath(this.sessionId);
  }

  /** Dashboard URL pre-filtered to this session. */
  get url(): string {
    return `${this.dashboard.url}?sessionId=${this.sessionId}`;
  }

  /** End this session (does not shut down the server if other sessions are active). */
  stop(): void {
    this.dashboard.endSession(this.sessionId);
  }
}
