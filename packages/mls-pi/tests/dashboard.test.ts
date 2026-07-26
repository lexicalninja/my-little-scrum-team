import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { Dashboard, SessionHandle } from "../.pi/extensions/mls/dashboard.js";
import type { MlsEvent } from "../.pi/extensions/mls/types.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function httpGet(url: string): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString(), headers: res.headers }),
      );
    });
    req.on("error", reject);
  });
}

function waitForServerClose(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.on("close", resolve));
}

function makeEvent(agent: string, task: string): MlsEvent {
  return { type: "agent_start", agent, prompt: task, taskLabel: "", timestamp: Date.now() } as MlsEvent;
}

function readLogLines(logPath: string): string[] {
  if (!fs.existsSync(logPath)) return [];
  return fs.readFileSync(logPath, "utf8").split("\n").filter(Boolean);
}

// ─── Shared server instance ───────────────────────────────────────────────────

let tmpDir: string;
let dashboard: Dashboard;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mls-dash-"));
  Dashboard.resetInstance();
  dashboard = Dashboard.acquire();
  await new Promise((r) => setTimeout(r, 50));
});

afterAll(async () => {
  const server = (dashboard as unknown as { server: http.Server | null }).server;
  dashboard.stop();
  Dashboard.resetInstance();
  if (server) await waitForServerClose(server);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Dashboard.acquire() singleton ──────────────────────────────────────────

describe("Dashboard — singleton", () => {
  it("acquire() returns the same instance", () => {
    const d2 = Dashboard.acquire();
    expect(d2).toBe(dashboard);
  });

  it("url getter returns http://localhost:4242", () => {
    expect(dashboard.url).toBe("http://localhost:4242");
  });

  it("HTTP server responds on port 4242", async () => {
    const result = await httpGet("http://127.0.0.1:4242/");
    expect(result.status).toBe(200);
  });
});

// ─── SessionHandle lifecycle ────────────────────────────────────────────────

describe("Dashboard — SessionHandle", () => {
  let session: SessionHandle;

  beforeEach(() => {
    session = dashboard.createSession(tmpDir);
  });

  afterEach(() => {
    session.stop();
  });

  it("createSession() returns a SessionHandle with a sessionId", () => {
    expect(session.sessionId).toBeTruthy();
    expect(typeof session.sessionId).toBe("string");
  });

  it("runLogPath returns a .jsonl path after createSession()", () => {
    expect(session.runLogPath).not.toBeNull();
    expect(session.runLogPath!.endsWith(".jsonl")).toBe(true);
    expect(session.runLogPath).toContain(path.join(".mls", "sessions"));
  });

  it("url includes sessionId query parameter", () => {
    expect(session.url).toBe(`http://localhost:4242?sessionId=${session.sessionId}`);
  });

  it("emit() writes events to the session's log file", async () => {
    session.emit(makeEvent("log-a", "T1"));
    session.emit(makeEvent("log-b", "T2"));

    await vi.waitFor(() => {
      expect(readLogLines(session.runLogPath!).length).toBeGreaterThanOrEqual(2);
    }, { timeout: 1000 });

    const lines = readLogLines(session.runLogPath!);
    expect(JSON.parse(lines[0]).agent).toBe("log-a");
    expect(JSON.parse(lines[1]).agent).toBe("log-b");
  });

  it("emit() stamps sessionId on the event", async () => {
    session.emit(makeEvent("stamp-test", "T1"));

    await vi.waitFor(() => {
      expect(readLogLines(session.runLogPath!).length).toBeGreaterThanOrEqual(1);
    }, { timeout: 1000 });

    const line = JSON.parse(readLogLines(session.runLogPath!)[0]);
    expect(line.sessionId).toBe(session.sessionId);
  });

  it("emit() does not throw after stop()", () => {
    session.stop();
    expect(() => session.emit(makeEvent("post-stop", "T1"))).not.toThrow();
  });
});

// ─── Multi-session isolation ────────────────────────────────────────────────

describe("Dashboard — multi-session isolation", () => {
  let sessionA: SessionHandle;
  let sessionB: SessionHandle;

  beforeEach(() => {
    sessionA = dashboard.createSession(tmpDir);
    sessionB = dashboard.createSession(tmpDir);
  });

  afterEach(() => {
    sessionA.stop();
    sessionB.stop();
  });

  it("two sessions get different sessionIds", () => {
    expect(sessionA.sessionId).not.toBe(sessionB.sessionId);
  });

  it("two sessions get different log files", () => {
    expect(sessionA.runLogPath).not.toBe(sessionB.runLogPath);
  });

  it("events from session A do not appear in session B's log", async () => {
    sessionA.emit(makeEvent("only-a", "T1"));
    sessionB.emit(makeEvent("only-b", "T1"));

    await vi.waitFor(() => {
      expect(readLogLines(sessionA.runLogPath!).length).toBeGreaterThanOrEqual(1);
      expect(readLogLines(sessionB.runLogPath!).length).toBeGreaterThanOrEqual(1);
    }, { timeout: 1000 });

    const aLines = readLogLines(sessionA.runLogPath!);
    const bLines = readLogLines(sessionB.runLogPath!);
    expect(aLines.every(l => JSON.parse(l).agent === "only-a")).toBe(true);
    expect(bLines.every(l => JSON.parse(l).agent === "only-b")).toBe(true);
  });
});

// ─── SSE endpoint with session filtering ────────────────────────────────────

describe("Dashboard — SSE endpoint", () => {
  it("SSE endpoint responds with status 200 and correct Content-Type", async () => {
    const result = await new Promise<{ status: number; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
      const req = http.get("http://127.0.0.1:4242/events", (res) => {
        resolve({ status: res.statusCode ?? 0, headers: res.headers });
        res.destroy();
      });
      req.on("error", reject);
    });
    expect(result.status).toBe(200);
    expect(result.headers["content-type"]).toBe("text/event-stream");
  });

  it("replays only the requested session's events", async () => {
    const sessionA = dashboard.createSession(tmpDir);
    const sessionB = dashboard.createSession(tmpDir);

    const sentinelA = `sentinel-a-${Date.now()}`;
    const sentinelB = `sentinel-b-${Date.now()}`;
    sessionA.emit(makeEvent(sentinelA, "T1"));
    sessionB.emit(makeEvent(sentinelB, "T1"));

    // Connect filtering for sessionA only
    const received = await new Promise<string>((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:4242/events?sessionId=${sessionA.sessionId}`, (res) => {
        let buf = "";
        res.on("data", (chunk: Buffer) => {
          buf += chunk.toString();
          if (buf.includes(sentinelA)) {
            resolve(buf);
            res.destroy();
          }
        });
        res.on("error", () => {});
      });
      req.on("error", () => {});
      setTimeout(() => { reject(new Error("SSE replay timeout")); }, 2000);
    });

    expect(received).toContain(sentinelA);
    expect(received).not.toContain(sentinelB);

    sessionA.stop();
    sessionB.stop();
  });

  it("broadcasts live events only to matching session clients", async () => {
    const session = dashboard.createSession(tmpDir);
    const sentinel = `live-${Date.now()}`;

    // Emit a primer so the replay has data and the data handler fires
    session.emit(makeEvent("primer", "T0"));

    const received = await new Promise<string>((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:4242/events?sessionId=${session.sessionId}`, (res) => {
        let buf = "";
        res.on("data", (chunk: Buffer) => {
          buf += chunk.toString();
          if (buf.includes(sentinel)) {
            resolve(buf);
            res.destroy();
          }
        });
        res.on("error", () => {});
        setTimeout(() => session.emit(makeEvent(sentinel, "T-live")), 100);
      });
      req.on("error", () => {});
      setTimeout(() => reject(new Error("SSE live broadcast timeout")), 3000);
    });

    expect(received).toContain(sentinel);
    session.stop();
  });

  it("unfiltered SSE receives events from all sessions", async () => {
    const sessionA = dashboard.createSession(tmpDir);
    const sessionB = dashboard.createSession(tmpDir);
    const sentinelA = `all-a-${Date.now()}`;
    const sentinelB = `all-b-${Date.now()}`;

    const received = await new Promise<string>((resolve, reject) => {
      const req = http.get("http://127.0.0.1:4242/events", (res) => {
        let buf = "";
        res.on("data", (chunk: Buffer) => {
          buf += chunk.toString();
          if (buf.includes(sentinelA) && buf.includes(sentinelB)) {
            resolve(buf);
            res.destroy();
          }
        });
        res.on("error", () => {});
        setTimeout(() => {
          sessionA.emit(makeEvent(sentinelA, "T1"));
          sessionB.emit(makeEvent(sentinelB, "T1"));
        }, 30);
      });
      req.on("error", () => {});
      setTimeout(() => reject(new Error("SSE all-sessions timeout")), 2000);
    });

    expect(received).toContain(sentinelA);
    expect(received).toContain(sentinelB);
    sessionA.stop();
    sessionB.stop();
  });
});

// ─── /api/sessions endpoint ──────────────────────────────────────────────────

describe("Dashboard — /api/sessions", () => {
  it("returns JSON with sessions array", async () => {
    const session = dashboard.createSession(tmpDir);
    const result = await httpGet("http://127.0.0.1:4242/api/sessions");
    expect(result.status).toBe(200);
    expect(result.headers["content-type"]).toBe("application/json");
    const body = JSON.parse(result.body);
    expect(Array.isArray(body.sessions)).toBe(true);
    expect(body.sessions.some((s: { sessionId: string }) => s.sessionId === session.sessionId)).toBe(true);
    session.stop();
  });

  it("marks ended sessions correctly", async () => {
    const session = dashboard.createSession(tmpDir);
    session.stop();
    const result = await httpGet("http://127.0.0.1:4242/api/sessions");
    const body = JSON.parse(result.body);
    const entry = body.sessions.find((s: { sessionId: string }) => s.sessionId === session.sessionId);
    expect(entry?.ended).toBe(true);
  });

  it("includes eventCount", async () => {
    const session = dashboard.createSession(tmpDir);
    session.emit(makeEvent("count-test", "T1"));
    session.emit(makeEvent("count-test", "T2"));
    const result = await httpGet("http://127.0.0.1:4242/api/sessions");
    const body = JSON.parse(result.body);
    const entry = body.sessions.find((s: { sessionId: string }) => s.sessionId === session.sessionId);
    expect(entry?.eventCount).toBe(2);
    session.stop();
  });
});

// ─── activeSessionIds() ────────────────────────────────────────────────────────

describe("Dashboard — activeSessionIds()", () => {
  it("returns all session IDs when none have ended", () => {
    const s1 = dashboard.createSession(tmpDir);
    const s2 = dashboard.createSession(tmpDir);
    const active = dashboard.activeSessionIds();
    expect(active).toContain(s1.sessionId);
    expect(active).toContain(s2.sessionId);
    s1.stop();
    s2.stop();
  });

  it("excludes ended sessions", () => {
    const s1 = dashboard.createSession(tmpDir);
    const s2 = dashboard.createSession(tmpDir);
    s1.stop();
    const active = dashboard.activeSessionIds();
    expect(active).not.toContain(s1.sessionId);
    expect(active).toContain(s2.sessionId);
    s2.stop();
  });
});

// ─── stop() with unclosed sessions ────────────────────────────────────────────

describe("Dashboard — stop() closes unclosed sessions", () => {
  it("marks active (non-ended) sessions as ended and closes their log streams", () => {
    // Use a fake stream to avoid real fs I/O and async cleanup races
    const fakeLogStream = { end: vi.fn(), write: vi.fn() };

    const fakeSession = {
      sessionId: "stop-test",
      events: [],
      logStream: fakeLogStream as unknown as fs.WriteStream,
      logPath: "/fake/path.jsonl",
      startedAt: Date.now(),
      ended: false,
    };

    // Call stop() via prototype to avoid creating a new HTTP server
    const fakeState = {
      shutdownTimer: null,
      clients: new Map(),
      sessions: new Map([["stop-test", fakeSession]]),
      server: null,
    };
    Dashboard.prototype.stop.call(fakeState);

    expect(fakeSession.ended).toBe(true);
    expect(fakeLogStream.end).toHaveBeenCalled();
  });

  it("stop() is idempotent when session is already ended", () => {
    const s = dashboard.createSession(tmpDir);
    s.stop();
    expect(() => s.stop()).not.toThrow();
  });
});

// ─── serveFile() — static files and path traversal ───────────────────────────

describe("Dashboard — serveFile() path traversal guard", () => {
  it("serves / as index.html with status 200", async () => {
    const result = await httpGet("http://127.0.0.1:4242/");
    expect(result.status).toBe(200);
  });

  it("serves index.html directly with status 200", async () => {
    const result = await httpGet("http://127.0.0.1:4242/index.html");
    expect(result.status).toBe(200);
  });

  it("sets Content-Type text/html for .html files", async () => {
    const result = await httpGet("http://127.0.0.1:4242/index.html");
    expect(result.headers["content-type"]).toBe("text/html");
  });

  it("sets Content-Type application/javascript for .js files", async () => {
    const result = await httpGet("http://127.0.0.1:4242/app.js");
    expect(result.status).toBe(200);
    expect(result.headers["content-type"]).toBe("application/javascript");
  });

  it("returns 404 for a file that does not exist in uiDir", async () => {
    const result = await httpGet("http://127.0.0.1:4242/nonexistent-file.xyz");
    expect(result.status).toBe(404);
  });

  it("returns 404 for a path traversal attempt (/../)", async () => {
    const result = await httpGet("http://127.0.0.1:4242/../package.json");
    expect(result.status).toBe(404);
  });
});
