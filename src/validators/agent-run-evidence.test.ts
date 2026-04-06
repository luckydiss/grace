import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { validateAgentRunEvidence } from "./agent-run-evidence.js";

function writeAgentRunArtifacts(dir: string, prefix: string): void {
  writeFileSync(
    join(dir, `${prefix}RunState-Workflow-0001.json`),
    '{ "schemaVersion": "grace-agent-run-state-v1", "currentStatus": "SUCCEEDED", "retryCount": 0, "retryBudget": 1, "nextAction": "NONE" }\n',
    "utf8",
  );
  writeFileSync(
    join(dir, `${prefix}RunLog-Workflow-0001.jsonl`),
    '{"schemaVersion":"grace-agent-run-event-v1","status":"DISPATCHED","retryCount":0,"retryBudget":1,"nextAction":"NONE"}\n{"schemaVersion":"grace-agent-run-event-v1","status":"ACTIVE","retryCount":0,"retryBudget":1,"nextAction":"NONE"}\n{"schemaVersion":"grace-agent-run-event-v1","status":"SUCCEEDED","retryCount":0,"retryBudget":1,"nextAction":"NONE"}\n',
    "utf8",
  );
}

test("FC-grace-validators-validateAgentRunEvidence accepts durable agent run lifecycle artifacts", () => {
  const dir = mkdtempSync(join(tmpdir(), "grace-agent-run-evidence-"));
  writeAgentRunArtifacts(dir, "Architect");
  writeAgentRunArtifacts(dir, "Coordinator");
  writeAgentRunArtifacts(dir, "Coder");

  const result = validateAgentRunEvidence({
    repoRoot: process.cwd(),
    productId: "grace",
    traceId: "TRACE-GRACE-CORE",
    executionDir: dir,
    requiredRoles: ["ARCHITECT", "COORDINATOR", "CODER"],
  });

  assert.equal(result.ok, true);
  assert.equal(result.failures.length, 0);
});

test("FC-grace-validators-validateAgentRunEvidence blocks missing or malformed run lifecycle artifacts", () => {
  const dir = mkdtempSync(join(tmpdir(), "grace-agent-run-evidence-bad-"));
  writeAgentRunArtifacts(dir, "Architect");
  writeFileSync(join(dir, "CoordinatorRunState-Workflow-0001.json"), '{ "schemaVersion": "grace-agent-run-state-v1", "retryCount": 2, "retryBudget": 1, "nextAction": "ESCALATE" }\n', "utf8");
  writeFileSync(join(dir, "CoordinatorRunLog-Workflow-0001.jsonl"), '{"schemaVersion":"grace-agent-run-event-v1","status":"DISPATCHED","retryCount":0,"retryBudget":1,"nextAction":"NONE"}\n', "utf8");

  const result = validateAgentRunEvidence({
    repoRoot: process.cwd(),
    productId: "grace",
    traceId: "TRACE-GRACE-CORE",
    executionDir: dir,
    requiredRoles: ["ARCHITECT", "COORDINATOR", "CODER"],
  });

  assert.equal(result.ok, false);
  assert.equal(result.failures.length > 0, true);
});

test("FC-grace-validators-validateAgentRunEvidence blocks illegal retry transitions", () => {
  const dir = mkdtempSync(join(tmpdir(), "grace-agent-run-evidence-transition-"));
  writeFileSync(
    join(dir, "ArchitectRunState-Workflow-0001.json"),
    '{ "schemaVersion": "grace-agent-run-state-v1", "currentStatus": "FAILED", "retryCount": 1, "retryBudget": 2, "nextAction": "RESUME" }\n',
    "utf8",
  );
  writeFileSync(
    join(dir, "ArchitectRunLog-Workflow-0001.jsonl"),
    '{"schemaVersion":"grace-agent-run-event-v1","status":"DISPATCHED","retryCount":0,"retryBudget":2,"nextAction":"NONE"}\n{"schemaVersion":"grace-agent-run-event-v1","status":"ACTIVE","retryCount":0,"retryBudget":2,"nextAction":"NONE"}\n{"schemaVersion":"grace-agent-run-event-v1","status":"FAILED","retryCount":0,"retryBudget":2,"nextAction":"RESUME"}\n{"schemaVersion":"grace-agent-run-event-v1","status":"SUCCEEDED","retryCount":0,"retryBudget":2,"nextAction":"NONE"}\n',
    "utf8",
  );
  writeAgentRunArtifacts(dir, "Coordinator");
  writeAgentRunArtifacts(dir, "Coder");

  const result = validateAgentRunEvidence({
    repoRoot: process.cwd(),
    productId: "grace",
    traceId: "TRACE-GRACE-CORE",
    executionDir: dir,
    requiredRoles: ["ARCHITECT", "COORDINATOR", "CODER"],
  });

  assert.equal(result.ok, false);
  assert.equal(result.failures.some((failure) => failure.code === "AGENT_RUN_TRANSITION_INVALID"), true);
});
