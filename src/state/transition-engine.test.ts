import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { applyTransition } from "./transition-engine.js";

function withMutedConsoleError<T>(fn: () => T): T {
  const original = console.error;
  console.error = () => undefined;
  try {
    return fn();
  } finally {
    console.error = original;
  }
}

test("FC-grace-state-applyTransition initializes missing state and persists first legal transition", () => {
  const dir = mkdtempSync(join(tmpdir(), "grace-transition-"));
  const stateFile = join(dir, "WorkflowState.json");
  const logFile = join(dir, "TransitionLog.jsonl");

  const result = withMutedConsoleError(() =>
    applyTransition({
      productId: "grace",
      traceId: "TRACE-GRACE-CORE",
      actor: "COORDINATOR",
      transition: "classify_intake",
      stateFile,
      transitionLogFile: logFile,
      now: "2026-04-05T07:35:00+03:00",
    }),
  );

  assert.equal(result.state.currentState, "INTAKE_CLASSIFIED");
  assert.equal(result.event.from, "INTAKE_RECEIVED");
  assert.equal(result.event.to, "INTAKE_CLASSIFIED");

  const persistedState = JSON.parse(readFileSync(stateFile, "utf8")) as { currentState: string; traceId: string };
  assert.equal(persistedState.currentState, "INTAKE_CLASSIFIED");
  assert.equal(persistedState.traceId, "TRACE-GRACE-CORE");

  const transitionLog = readFileSync(logFile, "utf8").trim().split(/\r?\n/u);
  assert.equal(transitionLog.length, 1);
});

test("FC-grace-state-applyTransition appends transition events across sequential legal moves", () => {
  const dir = mkdtempSync(join(tmpdir(), "grace-transition-"));
  const stateFile = join(dir, "WorkflowState.json");
  const logFile = join(dir, "TransitionLog.jsonl");

  withMutedConsoleError(() =>
    applyTransition({
      productId: "grace",
      traceId: "TRACE-GRACE-CORE",
      actor: "COORDINATOR",
      transition: "classify_intake",
      stateFile,
      transitionLogFile: logFile,
      now: "2026-04-05T07:35:00+03:00",
    }),
  );
  const result = withMutedConsoleError(() =>
    applyTransition({
      productId: "grace",
      traceId: "TRACE-GRACE-CORE",
      actor: "ARCHITECT",
      transition: "start_blueprint",
      stateFile,
      transitionLogFile: logFile,
      artifactRefs: [
        "docs/grace/RequirementsAnalysis.xml",
        "docs/grace/Technology.xml",
      ],
      now: "2026-04-05T07:35:01+03:00",
    }),
  );

  assert.equal(result.state.currentState, "BLUEPRINT_DRAFTING");
  assert.equal(result.event.id, "TRANS-0002");
  assert.deepEqual(result.event.artifactRefs, [
    "docs/grace/RequirementsAnalysis.xml",
    "docs/grace/Technology.xml",
  ]);
});

test("FC-grace-state-applyTransition emits workflow-owned process artifacts and appends their refs to durable evidence", () => {
  const dir = mkdtempSync(join(tmpdir(), "grace-transition-"));
  const stateFile = join(dir, "WorkflowState.json");
  const logFile = join(dir, "TransitionLog.jsonl");
  const handoffFile = join(dir, "WorkflowOwnedHandoff.xml");

  writeFileSync(
    stateFile,
    `${JSON.stringify(
      {
        schemaVersion: "grace-workflow-state-v1",
        productId: "grace",
        traceId: "TRACE-GRACE-CORE",
        currentState: "HANDOFF_DRAFTING",
        currentActor: "COORDINATOR",
        updatedAt: "2026-04-05T07:35:04+03:00",
        activeHandoffRef: null,
        activeCwoRef: null,
        blocked: false,
        blockReasons: [],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const result = withMutedConsoleError(() =>
    applyTransition({
      productId: "grace",
      traceId: "TRACE-GRACE-CORE",
      actor: "COORDINATOR",
      transition: "propose_handoff",
      stateFile,
      transitionLogFile: logFile,
      workflowOwnedArtifactSpecs: [
        {
          kind: "handoff",
          outputFile: handoffFile,
          ref: "docs/grace/handoffs/WorkflowOwnedHandoff.xml",
          sourceTransition: "propose_handoff",
        },
      ],
      now: "2026-04-05T07:35:05+03:00",
    }),
  );

  assert.equal(result.state.currentState, "HANDOFF_PROPOSED");
  assert.equal(result.state.activeHandoffRef, "docs/grace/handoffs/WorkflowOwnedHandoff.xml");
  assert.match(readFileSync(handoffFile, "utf8"), /WorkflowOwnedHandoff/u);
  assert.match(result.event.artifactRefs.join(" "), /WorkflowOwnedHandoff\.xml/u);
});

test("FC-grace-state-applyTransition rejects illegal transitions from the current state", () => {
  const dir = mkdtempSync(join(tmpdir(), "grace-transition-"));
  const stateFile = join(dir, "WorkflowState.json");
  const logFile = join(dir, "TransitionLog.jsonl");
  const policyFile = join(dir, "transition-policy.json");
  writeFileSync(
    policyFile,
    JSON.stringify({
      schemaVersion: "grace-transition-policy-v1",
      productId: "grace",
      traceId: "TRACE-GRACE-CORE",
      transitions: {
        start_blueprint: {
          allowedActors: ["ARCHITECT"],
          requiredArtifactRefs: [],
        },
      },
    }),
    "utf8",
  );

  assert.throws(
    () =>
      withMutedConsoleError(() =>
        applyTransition({
          productId: "grace",
          traceId: "TRACE-GRACE-CORE",
          actor: "ARCHITECT",
          transition: "start_blueprint",
          stateFile,
          transitionLogFile: logFile,
          policyFile,
          now: "2026-04-05T07:35:00+03:00",
        }),
      ),
    /transition start_blueprint is not allowed from INTAKE_RECEIVED/u,
  );
});

test("FC-grace-state-applyTransition persists BLOCKED state when policy guards fail", () => {
  const dir = mkdtempSync(join(tmpdir(), "grace-transition-"));
  const stateFile = join(dir, "WorkflowState.json");
  const logFile = join(dir, "TransitionLog.jsonl");
  const issueReportFile = join(dir, "IssueReport-TRANS-0001.xml");

  const result = withMutedConsoleError(() =>
    applyTransition({
      productId: "grace",
      traceId: "TRACE-GRACE-CORE",
      actor: "CODER",
      transition: "issue_cwo",
      stateFile,
      transitionLogFile: logFile,
      issueReportFile,
      artifactRefs: [],
      now: "2026-04-05T07:35:00+03:00",
    }),
  );

  assert.equal(result.state.currentState, "BLOCKED");
  assert.equal(result.state.blocked, true);
  assert.equal(result.event.to, "BLOCKED");
  assert.match(result.event.notes.join(" "), /ACTOR_NOT_ALLOWED|ARTIFACT_REF_MISSING/u);
  assert.match(readFileSync(issueReportFile, "utf8"), /WorkflowIssueReport/u);
  assert.match(result.event.artifactRefs.join(" "), /IssueReport-TRANS-0001\.xml/u);
});

test("FC-grace-state-applyTransition auto-emits approvals.log evidence for approve_handoff", () => {
  const dir = mkdtempSync(join(tmpdir(), "grace-transition-"));
  const stateFile = join(dir, "WorkflowState.json");
  const logFile = join(dir, "TransitionLog.jsonl");
  const approvalLogFile = join(dir, "approvals.log");
  writeFileSync(
    stateFile,
    `${JSON.stringify(
      {
        schemaVersion: "grace-workflow-state-v1",
        productId: "grace",
        traceId: "TRACE-GRACE-CORE",
        currentState: "HANDOFF_APPROVAL_PENDING",
        currentActor: "COORDINATOR",
        updatedAt: "2026-04-05T07:35:04+03:00",
        activeHandoffRef: "docs/grace/handoffs/Handoff-20260405-02-GRACE-Artifact-Emitters.xml",
        activeCwoRef: null,
        blocked: false,
        blockReasons: [],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const result = withMutedConsoleError(() =>
    applyTransition({
      productId: "grace",
      traceId: "TRACE-GRACE-CORE",
      actor: "HUMAN",
      transition: "approve_handoff",
      stateFile,
      transitionLogFile: logFile,
      approvalsRef: "docs/grace/approvals.log",
      approvalLogFile,
      artifactRefs: ["docs/grace/handoffs/Handoff-20260405-02-GRACE-Artifact-Emitters.xml"],
      now: "2026-04-05T07:35:05+03:00",
    }),
  );

  assert.equal(result.state.currentState, "HANDOFF_APPROVED");
  assert.match(result.event.artifactRefs.join(" "), /docs\/grace\/approvals\.log/u);
  assert.match(readFileSync(approvalLogFile, "utf8"), /GRACE_APPROVAL/u);
  assert.match(readFileSync(approvalLogFile, "utf8"), /Handoff-20260405-02-GRACE-Artifact-Emitters/u);
});

test("FC-grace-state-applyTransition blocks legacy source writes until write mode is authorized", () => {
  const dir = mkdtempSync(join(tmpdir(), "grace-transition-"));
  const stateFile = join(dir, "WorkflowState.json");
  const logFile = join(dir, "TransitionLog.jsonl");
  const issueReportFile = join(dir, "IssueReport-TRANS-0001.xml");
  const policyFile = join(dir, "transition-policy.json");
  writeFileSync(
    policyFile,
    JSON.stringify({
      schemaVersion: "grace-transition-policy-v1",
      productId: "legacy-overlay",
      traceId: "TRACE-LEGACY-OVERLAY-CORE",
      transitions: {
        classify_intake: {
          allowedActors: ["COORDINATOR"],
          requiredArtifactRefs: [],
        },
      },
    }),
    "utf8",
  );

  const result = withMutedConsoleError(() =>
    applyTransition({
      productId: "legacy-overlay",
      traceId: "TRACE-LEGACY-OVERLAY-CORE",
      actor: "COORDINATOR",
      transition: "classify_intake",
      stateFile,
      transitionLogFile: logFile,
      issueReportFile,
      policyFile,
      sourceRepoRoot: "C:/repo/legacy-source",
      requestedWritePaths: ["C:/repo/legacy-source/src/app.ts"],
      writeModeAuthorized: false,
      now: "2026-04-05T14:15:00+03:00",
    }),
  );

  assert.equal(result.state.currentState, "BLOCKED");
  assert.match(result.event.notes.join(" "), /LEGACY_WRITE_MODE_REQUIRED/u);
  assert.match(result.event.notes.join(" "), /LEGACY_SOURCE_WRITE_FORBIDDEN/u);
  assert.match(readFileSync(issueReportFile, "utf8"), /LEGACY_WRITE_MODE_REQUIRED/u);
});

test("FC-grace-state-applyTransition accepts persisted legacy onboarding states as valid typed workflow state values", () => {
  const dir = mkdtempSync(join(tmpdir(), "grace-transition-"));
  const stateFile = join(dir, "WorkflowState.json");
  const logFile = join(dir, "TransitionLog.jsonl");

  writeFileSync(
    stateFile,
    `${JSON.stringify(
      {
        schemaVersion: "grace-workflow-state-v1",
        productId: "legacy-overlay",
        traceId: "TRACE-LEGACY-OVERLAY-CORE",
        currentState: "LEGACY_SLICE_READY",
        currentActor: "COORDINATOR",
        updatedAt: "2026-04-05T17:05:00+03:00",
        activeHandoffRef: null,
        activeCwoRef: null,
        blocked: false,
        blockReasons: [],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const result = withMutedConsoleError(() =>
    applyTransition({
      productId: "legacy-overlay",
      traceId: "TRACE-LEGACY-OVERLAY-CORE",
      actor: "COORDINATOR",
      transition: "block_workflow",
      stateFile,
      transitionLogFile: logFile,
      now: "2026-04-05T17:06:00+03:00",
    }),
  );

  assert.equal(result.event.from, "LEGACY_SLICE_READY");
  assert.equal(result.event.to, "BLOCKED");
  assert.equal(result.state.currentState, "BLOCKED");
});
