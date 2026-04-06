import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { initializeAgentRun, updateAgentRun } from "./agent-run.js";

const descriptor = {
  roleName: "coordinator" as const,
  actorRole: "COORDINATOR" as const,
  systemFile: "SYSTEM.md",
  systemRef: "docs/grace/agents/SYSTEM.md",
  mandatorySkillRefs: ["mode-coordinator"],
  availableSkillRefs: ["mode-coordinator"],
};

test("FC-grace-agents-persistRun allows governed resume for retryable failed runs", () => {
  const dir = mkdtempSync(join(tmpdir(), "grace-agent-run-"));
  const stateFile = join(dir, "CoordinatorRunState-Workflow-0001.json");
  const logFile = join(dir, "CoordinatorRunLog-Workflow-0001.jsonl");

  initializeAgentRun({
    runId: "COORDINATOR-RUN-grace-agent-01",
    traceId: "TRACE-GRACE-CORE",
    productId: "grace",
    descriptor,
    executionSequence: 1,
    adapterKind: "external-cli",
    allowedStates: ["HANDOFF_APPROVED"],
    inputRefs: ["docs/grace/handoffs/Handoff.xml"],
    taskPacketRef: "docs/grace/executions/CoordinatorTaskPacket-Workflow-0001.json",
    invocationRef: "docs/grace/executions/CoordinatorInvocation-Workflow-0001.json",
    stateFile,
    logFile,
    sessionId: "cli-session-001",
    resumeToken: "resume-token-001",
    retryBudget: 2,
  });

  updateAgentRun({
    stateFile,
    logFile,
    status: "ACTIVE",
    notes: ["bounded role opened"],
  });
  const failed = updateAgentRun({
    stateFile,
    logFile,
    status: "FAILED",
    failureReason: "timeout waiting for external cli",
    failureCategory: "TRANSIENT",
    notes: ["transient failure"],
  });

  assert.equal(failed.nextAction, "RESUME");
  const resumed = updateAgentRun({
    stateFile,
    logFile,
    status: "ACTIVE",
    retryReason: "resume after timeout",
    resumeContextRef: "docs/grace/reports/forced-context.json",
    notes: ["retry resumed"],
  });

  assert.equal(resumed.currentStatus, "ACTIVE");
  assert.equal(resumed.retryCount, 1);
  assert.equal(resumed.resumeContextRef, "docs/grace/reports/forced-context.json");
  assert.equal(resumed.nextAction, "NONE");
  assert.match(readFileSync(logFile, "utf8"), /"retryReason":"resume after timeout"/u);
});

test("FC-grace-agents-persistRun blocks retry when budget is exhausted or action requires reissue", () => {
  const dir = mkdtempSync(join(tmpdir(), "grace-agent-run-blocked-"));
  const stateFile = join(dir, "CoordinatorRunState-Workflow-0001.json");
  const logFile = join(dir, "CoordinatorRunLog-Workflow-0001.jsonl");

  initializeAgentRun({
    runId: "COORDINATOR-RUN-grace-agent-02",
    traceId: "TRACE-GRACE-CORE",
    productId: "grace",
    descriptor,
    executionSequence: 2,
    adapterKind: "external-cli",
    allowedStates: ["HANDOFF_APPROVED"],
    inputRefs: ["docs/grace/handoffs/Handoff.xml"],
    taskPacketRef: "docs/grace/executions/CoordinatorTaskPacket-Workflow-0002.json",
    invocationRef: "docs/grace/executions/CoordinatorInvocation-Workflow-0002.json",
    stateFile,
    logFile,
    sessionId: "cli-session-002",
    resumeToken: "resume-token-002",
    retryBudget: 1,
  });

  updateAgentRun({ stateFile, logFile, status: "ACTIVE" });
  updateAgentRun({
    stateFile,
    logFile,
    status: "FAILED",
    failureReason: "tool exited 1",
    failureCategory: "TOOL_FAILURE",
  });
  updateAgentRun({
    stateFile,
    logFile,
    status: "ACTIVE",
    retryReason: "single governed retry",
    resumeContextRef: "docs/grace/reports/forced-context.json",
  });
  updateAgentRun({
    stateFile,
    logFile,
    status: "FAILED",
    failureReason: "tool exited 1 again",
    failureCategory: "TOOL_FAILURE",
  });

  assert.throws(
    () => {
      updateAgentRun({
        stateFile,
        logFile,
        status: "ACTIVE",
        retryReason: "budget exhausted retry",
        resumeContextRef: "docs/grace/reports/forced-context.json",
      });
    },
    /nextAction=ESCALATE|retry budget exhausted/u,
  );

  const reissueStateFile = join(dir, "CoordinatorRunState-Workflow-0003.json");
  const reissueLogFile = join(dir, "CoordinatorRunLog-Workflow-0003.jsonl");
  initializeAgentRun({
    runId: "COORDINATOR-RUN-grace-agent-03",
    traceId: "TRACE-GRACE-CORE",
    productId: "grace",
    descriptor,
    executionSequence: 3,
    adapterKind: "external-cli",
    allowedStates: ["HANDOFF_APPROVED"],
    inputRefs: ["docs/grace/handoffs/Handoff.xml"],
    taskPacketRef: "docs/grace/executions/CoordinatorTaskPacket-Workflow-0003.json",
    invocationRef: "docs/grace/executions/CoordinatorInvocation-Workflow-0003.json",
    stateFile: reissueStateFile,
    logFile: reissueLogFile,
    retryBudget: 2,
  });
  updateAgentRun({ stateFile: reissueStateFile, logFile: reissueLogFile, status: "ACTIVE" });
  const blocked = updateAgentRun({
    stateFile: reissueStateFile,
    logFile: reissueLogFile,
    status: "BLOCKED",
    failureReason: "FC_SCOPE_VIOLATION",
    failureCategory: "SCOPE_VIOLATION",
  });

  assert.equal(blocked.nextAction, "REISSUE");
  assert.throws(
    () =>
      updateAgentRun({
        stateFile: reissueStateFile,
        logFile: reissueLogFile,
        status: "ACTIVE",
        retryReason: "illegal blocked retry",
      }),
    /Illegal agent run transition: BLOCKED -> ACTIVE/u,
  );
});
