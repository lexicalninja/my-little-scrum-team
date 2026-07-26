import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { MlstDatabase } from "../.pi/extensions/mlst/db.js";

describe("MlstDatabase", () => {
  let tmpDir: string;
  let db: MlstDatabase;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mlst-db-test-"));
    db = new MlstDatabase(tmpDir);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("getOrCreateProject", () => {
    it("creates a project on first call", () => {
      const project = db.getOrCreateProject("/repo/path", "test-project");
      expect(project.id).toBeDefined();
      expect(project.name).toBe("test-project");
    });

    it("returns the same project on second call (idempotent by repo_path)", () => {
      const first = db.getOrCreateProject("/repo/path", "test-project");
      const second = db.getOrCreateProject("/repo/path", "test-project");
      expect(first.id).toBe(second.id);
    });
  });

  describe("Sprint lifecycle", () => {
    it("creates a sprint and retrieves it as active", () => {
      const project = db.getOrCreateProject("/repo", "proj");
      const sprint = db.createSprint(project.id, "Sprint 1", "Ship it");
      expect(sprint.id).toBeDefined();
      expect(sprint.name).toBe("Sprint 1");

      const active = db.getActiveSprint(project.id);
      expect(active).not.toBeNull();
      expect(active!.id).toBe(sprint.id);
    });

    it("updateSprint changes status", () => {
      const project = db.getOrCreateProject("/repo", "proj");
      const sprint = db.createSprint(project.id, "Sprint 1");

      db.updateSprint(sprint.id, { status: "completed" });

      const active = db.getActiveSprint(project.id);
      expect(active).toBeFalsy();
    });
  });

  describe("Issue CRUD", () => {
    let projectId: number;
    let sprintId: number;

    beforeEach(() => {
      const project = db.getOrCreateProject("/repo", "proj");
      projectId = project.id;
      const sprint = db.createSprint(projectId, "Sprint 1");
      sprintId = sprint.id;
    });

    it("creates issues with auto-incrementing IDs", () => {
      const issue1 = db.createIssue({
        project_id: projectId,
        sprint_id: sprintId,
        title: "First issue",
        type: "task",
      });
      const issue2 = db.createIssue({
        project_id: projectId,
        sprint_id: sprintId,
        title: "Second issue",
        type: "task",
      });
      expect(issue2.id).toBeGreaterThan(issue1.id);
    });

    it("assigns sequential numbers within a sprint (1-based)", () => {
      const issue1 = db.createIssue({
        project_id: projectId,
        sprint_id: sprintId,
        title: "First",
        type: "task",
      });
      const issue2 = db.createIssue({
        project_id: projectId,
        sprint_id: sprintId,
        title: "Second",
        type: "task",
      });
      expect(issue1.number).toBe(1);
      expect(issue2.number).toBe(2);
    });

    it("throws on issue creation with nonexistent sprint_id", () => {
      expect(() =>
        db.createIssue({
          project_id: projectId,
          sprint_id: 99999,
          title: "Orphan",
          type: "task",
        })
      ).toThrow();
    });

    it("getIssue returns created issue", () => {
      const created = db.createIssue({
        project_id: projectId,
        sprint_id: sprintId,
        title: "Roundtrip test",
        body: "Some body",
        type: "bug",
        assigned_agent: "mlst-developer",
      });
      const fetched = db.getIssue(created.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.title).toBe("Roundtrip test");
      expect(fetched!.body).toBe("Some body");
      expect(fetched!.type).toBe("bug");
      expect(fetched!.assigned_agent).toBe("mlst-developer");
    });

    it("updateIssue modifies fields", () => {
      const issue = db.createIssue({
        project_id: projectId,
        sprint_id: sprintId,
        title: "Update me",
        type: "task",
      });
      db.updateIssue(issue.id, { status: "closed", output: "task completed" });
      const updated = db.getIssue(issue.id);
      expect(updated!.status).toBe("closed");
      expect(updated!.output).toBe("task completed");
    });
  });

  describe("Queries", () => {
    let projectId: number;
    let sprintId: number;

    beforeEach(() => {
      const project = db.getOrCreateProject("/repo", "proj");
      projectId = project.id;
      const sprint = db.createSprint(projectId, "Sprint 1");
      sprintId = sprint.id;
    });

    it("getSprintIssues returns all issues in sprint", () => {
      db.createIssue({
        project_id: projectId,
        sprint_id: sprintId,
        title: "A",
        type: "task",
      });
      db.createIssue({
        project_id: projectId,
        sprint_id: sprintId,
        title: "B",
        type: "task",
      });
      const issues = db.getSprintIssues(sprintId);
      expect(issues.length).toBe(2);
    });

    it("getOpenIssues filters out closed and escalated", () => {
      const open = db.createIssue({
        project_id: projectId,
        sprint_id: sprintId,
        title: "Open",
        type: "task",
      });
      const closed = db.createIssue({
        project_id: projectId,
        sprint_id: sprintId,
        title: "Closed",
        type: "task",
      });
      const escalated = db.createIssue({
        project_id: projectId,
        sprint_id: sprintId,
        title: "Escalated",
        type: "task",
      });
      db.updateIssue(closed.id, { status: "closed" });
      db.updateIssue(escalated.id, { status: "escalated" });

      const openIssues = db.getOpenIssues(sprintId);
      expect(openIssues.length).toBe(1);
      expect(openIssues[0].title).toBe("Open");
    });

    it("getChildIssues returns children of a parent", () => {
      const parent = db.createIssue({
        project_id: projectId,
        sprint_id: sprintId,
        title: "Parent",
        type: "story",
      });
      db.createIssue({
        project_id: projectId,
        sprint_id: sprintId,
        parent_id: parent.id,
        title: "Child 1",
        type: "task",
      });
      db.createIssue({
        project_id: projectId,
        sprint_id: sprintId,
        parent_id: parent.id,
        title: "Child 2",
        type: "task",
      });
      const children = db.getChildIssues(parent.id);
      expect(children.length).toBe(2);
    });

    it("getSprintSummary returns correct counts", () => {
      db.createIssue({
        project_id: projectId,
        sprint_id: sprintId,
        title: "Open 1",
        type: "task",
      });
      const toClose = db.createIssue({
        project_id: projectId,
        sprint_id: sprintId,
        title: "Closed 1",
        type: "task",
      });
      const toEscalate = db.createIssue({
        project_id: projectId,
        sprint_id: sprintId,
        title: "Escalated 1",
        type: "task",
      });
      db.updateIssue(toClose.id, { status: "closed" });
      db.updateIssue(toEscalate.id, { status: "escalated" });

      const summary = db.getSprintSummary(sprintId);
      expect(summary.total).toBe(3);
      expect(summary.open).toBe(1);
      expect(summary.closed).toBe(1);
      expect(summary.escalated).toBe(1);
    });
  });

  describe("Labels", () => {
    let projectId: number;
    let sprintId: number;

    beforeEach(() => {
      const project = db.getOrCreateProject("/repo", "proj");
      projectId = project.id;
      const sprint = db.createSprint(projectId, "Sprint 1");
      sprintId = sprint.id;
    });

    it("getOrCreateLabel is idempotent", () => {
      const first = db.getOrCreateLabel(projectId, "bug", "#ff0000");
      const second = db.getOrCreateLabel(projectId, "bug", "#ff0000");
      expect(first.id).toBe(second.id);
    });

    it("addLabelToIssue and getIssueLabels work together", () => {
      const issue = db.createIssue({
        project_id: projectId,
        sprint_id: sprintId,
        title: "Labeled issue",
        type: "task",
      });
      const label = db.getOrCreateLabel(projectId, "priority", "#00ff00");
      db.addLabelToIssue(issue.id, label.id);

      const labels = db.getIssueLabels(issue.id);
      expect(labels.length).toBe(1);
      expect(labels[0].name).toBe("priority");
    });

    it("getIssuesByLabel returns matching issues", () => {
      const issue1 = db.createIssue({
        project_id: projectId,
        sprint_id: sprintId,
        title: "Bug 1",
        type: "bug",
      });
      const issue2 = db.createIssue({
        project_id: projectId,
        sprint_id: sprintId,
        title: "Feature 1",
        type: "task",
      });
      const bugLabel = db.getOrCreateLabel(projectId, "bug");
      db.addLabelToIssue(issue1.id, bugLabel.id);

      const bugIssues = db.getIssuesByLabel(projectId, "bug");
      expect(bugIssues.length).toBe(1);
      expect(bugIssues[0].title).toBe("Bug 1");
    });
  });

  describe("close", () => {
    it("does not crash when called", () => {
      const project = db.getOrCreateProject("/repo", "proj");
      expect(() => db.close()).not.toThrow();
    });
  });
});
