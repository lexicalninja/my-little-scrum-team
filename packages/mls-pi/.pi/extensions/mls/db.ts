/**
 * MLS Pi Extension — SQLite Database
 *
 * Persistent task tracking that survives interruptions.
 * Schema maps to GitHub Projects: projects > sprints > issues (with sub-issues).
 *
 * An epic is an issue with children (parent_id), not a separate entity.
 * A sprint maps to a GitHub Milestone — one per /build run.
 */

import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";

const require = createRequire(import.meta.url);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Project {
  id: number;
  name: string;
  description: string | null;
  /** Absolute path to the git repository root; used as the unique project key. */
  repo_path: string;
  created_at: string;
}

export interface Sprint {
  id: number;
  project_id: number;
  name: string;
  /** The full user input that triggered this sprint run (stored as the sprint goal). */
  goal: string | null;
  status: "active" | "completed" | "cancelled" | "aborted";
  /**
   * LLM classification of the sprint input. Mirrors the {@link Classification} type from
   * `types.ts` but stored as a plain string in SQLite.
   */
  classification: string | null;
  specification: string | null;
  /** JSON-serialized ExecutionProfile used for this sprint (for resume). */
  execution_profile: string | null;
  /** JSON object of gate annotations keyed by GatePoint name (for resume). */
  gate_annotations: string | null;
  /** Tech stack + conventions context string (for resume). */
  sprint_context: string | null;
  /** Model override string in provider/id format (for resume). */
  model: string | null;
  /** Human-provided reason when the sprint is aborted (nullable). */
  abort_reason: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface Label {
  id: number;
  project_id: number;
  name: string;
  color: string | null;
  description: string | null;
}

export interface Issue {
  id: number;
  project_id: number;
  sprint_id: number;
  /** Parent issue id for sub-issues (epics). `null` for top-level issues. */
  parent_id: number | null;
  /** Sequential number within the sprint (auto-assigned, 1-based). */
  number: number;
  title: string;
  body: string | null;
  type: string;
  /**
   * Current workflow status of the issue.
   * Valid values mirror `TaskStatus` from `types.ts`:
   * - `"open"`       — Task created but not started (maps to `"pending"`).
   * - `"in_progress"` — Implementation or fix agent is running.
   * - `"testing"`    — Test-runner agent is active.
   * - `"reviewing"`  — Code-reviewer agent is active.
   * - `"closed"`     — All criteria met and review approved (maps to `"complete"`).
   * - `"escalated"`  — Max iterations hit or unrecoverable error; needs human attention.
   */
  status: "open" | "in_progress" | "testing" | "reviewing" | "closed" | "escalated";
  assigned_agent: string | null;
  /**
   * JSON-serialized `string[]` of task label dependencies (e.g., `["TASK-001"]`).
   * Stored as a string because SQLite has no native array type.
   */
  dependencies: string;
  /**
   * JSON-serialized `string[]` of acceptance criterion strings.
   * Stored as a string because SQLite has no native array type.
   */
  acceptance_criteria: string;
  /**
   * JSON-serialized `string[]` of file paths expected to be modified by this task.
   * Stored as a string because SQLite has no native array type.
   */
  files_affected: string;
  output: string | null;
  review_output: string | null;
  design_output: string | null;
  iteration_count: number;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  repo_path TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sprints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  goal TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  classification TEXT,
  specification TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS labels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  color TEXT,
  description TEXT,
  UNIQUE(project_id, name)
);

CREATE TABLE IF NOT EXISTS issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  sprint_id INTEGER NOT NULL REFERENCES sprints(id),
  parent_id INTEGER REFERENCES issues(id),
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  type TEXT NOT NULL DEFAULT 'Implementation',
  status TEXT NOT NULL DEFAULT 'open',
  assigned_agent TEXT,
  dependencies TEXT NOT NULL DEFAULT '[]',
  acceptance_criteria TEXT NOT NULL DEFAULT '[]',
  files_affected TEXT NOT NULL DEFAULT '[]',
  output TEXT,
  review_output TEXT,
  design_output TEXT,
  iteration_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT
);

CREATE TABLE IF NOT EXISTS issue_labels (
  issue_id INTEGER NOT NULL REFERENCES issues(id),
  label_id INTEGER NOT NULL REFERENCES labels(id),
  PRIMARY KEY (issue_id, label_id)
);

CREATE INDEX IF NOT EXISTS idx_issues_sprint ON issues(sprint_id);
CREATE INDEX IF NOT EXISTS idx_issues_parent ON issues(parent_id);
CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);
CREATE INDEX IF NOT EXISTS idx_sprints_project ON sprints(project_id);
CREATE INDEX IF NOT EXISTS idx_issue_labels_issue ON issue_labels(issue_id);
CREATE INDEX IF NOT EXISTS idx_issue_labels_label ON issue_labels(label_id);
`;

// ─── Database ─────────────────────────────────────────────────────────────────

/**
 * SQLite-backed persistence layer for MLS sprint and task tracking.
 *
 * Schema mirrors GitHub Projects: `projects → sprints → issues`, with `labels`
 * and `issue_labels` for tagging. WAL mode is enabled for write performance.
 * Foreign keys are enforced. An epic is an issue with a non-null `parent_id`;
 * there is no separate epics table.
 *
 * Requires the optional `better-sqlite3` dependency. Throws a descriptive error
 * at construction time if it is not installed.
 */
export class MlsDatabase {
  private db: any; // better-sqlite3 Database instance

  /**
   * Open (or create) the MLS database at `<cwd>/.mls/mls.db`.
   *
   * Creates the `.mls/` directory if it does not exist. Enables WAL journal mode
   * and foreign key enforcement via pragmas. Applies the schema using idempotent
   * `CREATE TABLE IF NOT EXISTS` statements, so this is safe to call on an existing db.
   *
   * @param cwd - Project working directory; the database is placed at `<cwd>/.mls/mls.db`.
   * @throws If `better-sqlite3` is not installed, with a message that includes the install command.
   */
  constructor(cwd: string) {
    const mlsDir = path.join(cwd, ".mls");
    if (!fs.existsSync(mlsDir)) fs.mkdirSync(mlsDir, { recursive: true });

    const dbPath = path.join(mlsDir, "mls.db");
    let Database: any;
    try {
      Database = require("better-sqlite3");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `MLS requires the optional dependency "better-sqlite3". Run "npm install" in plugins/my-little-scrum-team-pi before loading the extension. Original error: ${message}`,
      );
    }
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(SCHEMA);
    this.migrate();
  }

  /**
   * Apply schema migrations for columns added after the initial schema.
   * Uses ALTER TABLE ADD COLUMN which is a no-op if the column already exists
   * (catches the "duplicate column" error and ignores it).
   */
  private migrate(): void {
    const newColumns = [
      { table: "sprints", column: "execution_profile", type: "TEXT" },
      { table: "sprints", column: "gate_annotations", type: "TEXT" },
      { table: "sprints", column: "sprint_context", type: "TEXT" },
      { table: "sprints", column: "model", type: "TEXT" },
      { table: "sprints", column: "abort_reason", type: "TEXT" },
    ];

    for (const { table, column, type } of newColumns) {
      try {
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
      } catch {
        // Column already exists — safe to ignore
      }
    }
  }

  // ─── Projects ─────────────────────────────────────────────────────────

  /**
   * Upsert a project record by `repo_path`.
   *
   * If a project with the given `repo_path` already exists, it is returned as-is.
   * Otherwise a new project is created. `name` defaults to `path.basename(repoPath)`
   * when not provided.
   *
   * @param repoPath - Absolute path to the repository root (unique constraint).
   * @param name     - Optional display name; defaults to the directory name.
   * @returns The existing or newly created project row.
   */
  getOrCreateProject(repoPath: string, name?: string): Project {
    const existing = this.db.prepare("SELECT * FROM projects WHERE repo_path = ?").get(repoPath);
    if (existing) return existing as Project;

    const result = this.db.prepare(
      "INSERT INTO projects (name, repo_path) VALUES (?, ?) RETURNING *",
    ).get(name ?? path.basename(repoPath), repoPath);
    return result as Project;
  }

  // ─── Sprints ──────────────────────────────────────────────────────────

  /**
   * Create a new sprint for the given project.
   * One sprint is created per `/build` run; it starts with status `"active"`.
   *
   * @param projectId - ID of the owning project.
   * @param name      - Short display name (typically the first 100 chars of the input).
   * @param goal      - Full user input text stored as the sprint goal.
   * @returns The newly created sprint row.
   */
  createSprint(projectId: number, name: string, goal?: string): Sprint {
    return this.db.prepare(
      "INSERT INTO sprints (project_id, name, goal) VALUES (?, ?, ?) RETURNING *",
    ).get(projectId, name, goal ?? null) as Sprint;
  }

  private static SPRINT_COLUMNS = new Set(["status", "classification", "specification", "completed_at", "execution_profile", "gate_annotations", "sprint_context", "model", "abort_reason"]);

  /**
   * Update mutable fields of a sprint.
   *
   * Uses an allowlist (`SPRINT_COLUMNS`) to prevent SQL injection via key names.
   * Silently no-ops if `updates` contains no valid keys or all values are `undefined`.
   *
   * @param id      - Sprint row ID.
   * @param updates - Partial sprint fields to change.
   */
  updateSprint(id: number, updates: Partial<Pick<Sprint, "status" | "classification" | "specification" | "completed_at" | "execution_profile" | "gate_annotations" | "sprint_context" | "model" | "abort_reason">>): void {
    const sets: string[] = [];
    const values: any[] = [];

    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined && MlsDatabase.SPRINT_COLUMNS.has(key)) {
        sets.push(`${key} = ?`);
        values.push(value);
      }
    }

    if (sets.length === 0) return;
    values.push(id);
    this.db.prepare(`UPDATE sprints SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  }

  /**
   * Return the most recently created active sprint for a project.
   *
   * "Active" means `status = 'active'`. Returns the highest-id row when multiple
   * active sprints exist (which should not happen in normal operation).
   *
   * @param projectId - ID of the owning project.
   * @returns The active sprint row, or `null` if none exists.
   */
  getActiveSprint(projectId: number): Sprint | null {
    return this.db.prepare(
      "SELECT * FROM sprints WHERE project_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1",
    ).get(projectId) as Sprint | null;
  }

  /**
   * Fetch a single sprint by its primary key.
   *
   * @param id - Sprint row ID.
   * @returns The sprint row, or `null` if not found.
   */
  getSprint(id: number): Sprint | null {
    return this.db.prepare("SELECT * FROM sprints WHERE id = ?").get(id) as Sprint | null;
  }

  /**
   * Find the most recent completed or active sprint for a project.
   * Used by --resume to find the sprint to continue from.
   *
   * @param projectId - ID of the owning project.
   * @returns The most recent sprint row, or `null` if none exists.
   */
  getLatestSprint(projectId: number): Sprint | null {
    return this.db.prepare(
      "SELECT * FROM sprints WHERE project_id = ? ORDER BY id DESC LIMIT 1",
    ).get(projectId) as Sprint | null;
  }

  // ─── Issues ───────────────────────────────────────────────────────────

  /**
   * Create a new issue (task) in the given sprint.
   *
   * Auto-assigns a sequential `number` within the sprint (1-based, per-sprint unique).
   * Array fields (`dependencies`, `acceptance_criteria`, `files_affected`) are
   * JSON-serialized to strings because SQLite has no native array type.
   *
   * @param issue - Fields for the new issue; array fields accept plain arrays.
   * @returns The newly created issue row (with all defaults applied).
   */
  createIssue(issue: {
    project_id: number;
    sprint_id: number;
    parent_id?: number;
    title: string;
    body?: string;
    type: string;
    assigned_agent?: string;
    dependencies?: string[];
    acceptance_criteria?: string[];
    files_affected?: string[];
  }): Issue {
    const nextNumber = this.nextIssueNumber(issue.sprint_id);

    return this.db.prepare(`
      INSERT INTO issues (project_id, sprint_id, parent_id, number, title, body, type,
        assigned_agent, dependencies, acceptance_criteria, files_affected)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `).get(
      issue.project_id,
      issue.sprint_id,
      issue.parent_id ?? null,
      nextNumber,
      issue.title,
      issue.body ?? null,
      issue.type,
      issue.assigned_agent ?? null,
      JSON.stringify(issue.dependencies ?? []),
      JSON.stringify(issue.acceptance_criteria ?? []),
      JSON.stringify(issue.files_affected ?? []),
    ) as Issue;
  }

  private static ISSUE_COLUMNS = new Set(["status", "output", "review_output", "design_output", "iteration_count", "closed_at"]);

  /**
   * Update mutable fields of an issue.
   *
   * Uses an allowlist (`ISSUE_COLUMNS`) to prevent SQL injection via key names.
   * Always sets `updated_at = datetime('now')` regardless of which fields are updated.
   * Silently no-ops if `updates` contains no valid keys or all values are `undefined`.
   *
   * @param id      - Issue row ID.
   * @param updates - Partial issue fields to change.
   */
  updateIssue(id: number, updates: Partial<Pick<Issue, "status" | "output" | "review_output" | "design_output" | "iteration_count" | "closed_at">>): void {
    const sets: string[] = ["updated_at = datetime('now')"];
    const values: any[] = [];

    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined && MlsDatabase.ISSUE_COLUMNS.has(key)) {
        sets.push(`${key} = ?`);
        values.push(value);
      }
    }

    values.push(id);
    this.db.prepare(`UPDATE issues SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  }

  /**
   * Fetch a single issue by primary key.
   *
   * @param id - Issue row ID.
   * @returns The issue row, or `null` if not found.
   */
  getIssue(id: number): Issue | null {
    return this.db.prepare("SELECT * FROM issues WHERE id = ?").get(id) as Issue | null;
  }

  /**
   * Fetch all issues for a sprint in ascending `number` order.
   *
   * @param sprintId - Sprint row ID.
   * @returns All issues, including closed and escalated ones.
   */
  getSprintIssues(sprintId: number): Issue[] {
    return this.db.prepare(
      "SELECT * FROM issues WHERE sprint_id = ? ORDER BY number",
    ).all(sprintId) as Issue[];
  }

  /**
   * Fetch issues that are not yet resolved (excludes `"closed"` and `"escalated"`).
   *
   * @param sprintId - Sprint row ID.
   * @returns Open, in-progress, testing, and reviewing issues in `number` order.
   */
  getOpenIssues(sprintId: number): Issue[] {
    return this.db.prepare(
      "SELECT * FROM issues WHERE sprint_id = ? AND status NOT IN ('closed', 'escalated') ORDER BY number",
    ).all(sprintId) as Issue[];
  }

  /**
   * Fetch sub-issues (children) of an epic issue.
   *
   * Epics are represented as issues with a non-null `parent_id`; there is no separate
   * epics table. Returns results in ascending `number` order.
   *
   * @param parentId - ID of the parent issue.
   * @returns All child issues of the given parent.
   */
  getChildIssues(parentId: number): Issue[] {
    return this.db.prepare(
      "SELECT * FROM issues WHERE parent_id = ? ORDER BY number",
    ).all(parentId) as Issue[];
  }

  private nextIssueNumber(sprintId: number): number {
    const row = this.db.prepare(
      "SELECT COALESCE(MAX(number), 0) + 1 AS next FROM issues WHERE sprint_id = ?",
    ).get(sprintId) as { next: number };
    return row.next;
  }

  // ─── Labels ───────────────────────────────────────────────────────────

  /**
   * Upsert a label record by `(project_id, name)` unique constraint.
   *
   * If a label with the given name already exists for the project, it is returned as-is.
   * Otherwise a new label is created with the optional color.
   *
   * @param projectId - ID of the owning project.
   * @param name      - Label display name (e.g., task type like `"Implementation"`).
   * @param color     - Optional hex color string (e.g., `"#0075ca"`).
   * @returns The existing or newly created label row.
   */
  getOrCreateLabel(projectId: number, name: string, color?: string): Label {
    const existing = this.db.prepare(
      "SELECT * FROM labels WHERE project_id = ? AND name = ?",
    ).get(projectId, name);
    if (existing) return existing as Label;

    return this.db.prepare(
      "INSERT INTO labels (project_id, name, color) VALUES (?, ?, ?) RETURNING *",
    ).get(projectId, name, color ?? null) as Label;
  }

  /**
   * Associate a label with an issue via the `issue_labels` join table.
   * Uses `INSERT OR IGNORE` so duplicate associations are silently dropped.
   *
   * @param issueId - Issue row ID.
   * @param labelId - Label row ID.
   */
  addLabelToIssue(issueId: number, labelId: number): void {
    this.db.prepare(
      "INSERT OR IGNORE INTO issue_labels (issue_id, label_id) VALUES (?, ?)",
    ).run(issueId, labelId);
  }

  /**
   * Fetch all labels attached to a given issue via the `issue_labels` join table.
   *
   * @param issueId - Issue row ID.
   * @returns All label rows for the issue, in unspecified order.
   */
  getIssueLabels(issueId: number): Label[] {
    return this.db.prepare(
      "SELECT l.* FROM labels l JOIN issue_labels il ON l.id = il.label_id WHERE il.issue_id = ?",
    ).all(issueId) as Label[];
  }

  /**
   * Find all issues in a project that carry a specific label name.
   *
   * Joins through `issue_labels` and `labels`; filters by both `project_id` and label name.
   *
   * @param projectId - ID of the project to search within.
   * @param labelName - Exact label name to match (case-sensitive).
   * @returns Matching issues in ascending `number` order.
   */
  getIssuesByLabel(projectId: number, labelName: string): Issue[] {
    return this.db.prepare(`
      SELECT i.* FROM issues i
      JOIN issue_labels il ON i.id = il.issue_id
      JOIN labels l ON il.label_id = l.id
      WHERE i.project_id = ? AND l.name = ?
      ORDER BY i.number
    `).all(projectId, labelName) as Issue[];
  }

  // ─── Queries ──────────────────────────────────────────────────────────

  /**
   * Compute aggregate counts for a sprint's issues.
   *
   * - `total`     — All issues in the sprint.
   * - `open`      — Issues not yet in a terminal state (everything except `"closed"` and `"escalated"`).
   * - `closed`    — Issues with status `"closed"` (successfully completed).
   * - `escalated` — Issues with status `"escalated"` (need human attention).
   *
   * @param sprintId - Sprint row ID.
   */
  getSprintSummary(sprintId: number): { total: number; open: number; closed: number; escalated: number } {
    const row = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status NOT IN ('closed', 'escalated') THEN 1 ELSE 0 END) as open,
        SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed,
        SUM(CASE WHEN status = 'escalated' THEN 1 ELSE 0 END) as escalated
      FROM issues WHERE sprint_id = ?
    `).get(sprintId) as any;
    return row;
  }

  /**
   * Close the database connection, flushing the WAL and releasing the file lock.
   *
   * Must be called to cleanly release the SQLite file lock. Currently not invoked
   * in the extension because the database has singleton lifetime (it lives for the
   * entire pi session). Relevant if the extension is ever unloaded or restarted.
   */
  close(): void {
    this.db.close();
  }
}
