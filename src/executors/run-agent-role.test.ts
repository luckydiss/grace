import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runCoordinatorRole } from "./run-agent-role.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function writeState(stateFile: string, currentState: string): void {
  writeFileSync(
    stateFile,
    `${JSON.stringify(
      {
        schemaVersion: "grace-workflow-state-v1",
        productId: "notes-api",
        traceId: "TRACE-NOTES-API-CORE",
        currentState,
        currentActor: "COORDINATOR",
        updatedAt: "2026-04-05T13:00:00+03:00",
        activeHandoffRef: "products/notes-api/docs/grace/handoffs/Handoff-bootstrap-notes-api.xml",
        activeCwoRef: null,
        blocked: false,
        blockReasons: [],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

test("FC-grace-agents-runCoordinatorRole emits execution evidence using repository-owned coordinator descriptor", () => {
  const dir = mkdtempSync(join(tmpdir(), "grace-coordinator-role-"));
  const stateFile = join(dir, "WorkflowState.json");
  writeState(stateFile, "HANDOFF_APPROVED");

  const result = runCoordinatorRole({
    repoRoot,
    productId: "notes-api",
    traceId: "TRACE-NOTES-API-CORE",
    executionSequence: 2,
    allowedStates: ["HANDOFF_APPROVED"],
    allowedFcIds: ["FC-grace-agents-runCoordinatorRole"],
    allowedBaIds: ["BA-grace-run-coordinator-role"],
    scopedSkillRefs: ["coordinator-work-orders", "coordinator-branchspec-gitflow"],
    inputRefs: ["products/notes-api/docs/grace/handoffs/Handoff-bootstrap-notes-api.xml"],
    stateFile,
    executionFile: join(dir, "CoordinatorExecution.xml"),
    skillTraceFile: join(dir, "CoordinatorSkillTrace.json"),
    operation: () => ({
      outputRefs: ["products/notes-api/docs/grace/cwo/CWO-bootstrap-notes-api.xml"],
      touchedFcIds: ["FC-grace-agents-runCoordinatorRole"],
      touchedBaIds: ["BA-grace-run-coordinator-role"],
      notes: ["Coordinator role materialized one bounded work-order window."],
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.descriptor.roleName, "coordinator");
  assert.ok(result.loadedSkillRefs.includes("mode-coordinator"));
  assert.ok(result.loadedSkillRefs.includes("coordinator-work-orders"));
  assert.match(readFileSync(result.taskPacketFile, "utf8"), /grace-agent-task-packet-v1/u);
  assert.match(readFileSync(result.invocationFile, "utf8"), /DISPATCHED/u);
  assert.match(readFileSync(result.executionFile, "utf8"), /CoordinatorExecution/u);
  assert.match(readFileSync(result.skillTraceFile, "utf8"), /coordinator-work-orders/u);
});
