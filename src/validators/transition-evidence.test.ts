import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { applyTransition } from "../state/transition-engine.js";
import { validateTransitionEvidence } from "./transition-evidence.js";

function withMutedConsoleError<T>(fn: () => T): T {
  const original = console.error;
  console.error = () => undefined;
  try {
    return fn();
  } finally {
    console.error = original;
  }
}

function writePolicy(dir: string): string {
  const filePath = join(dir, "transition-policy.json");
  writeFileSync(
    filePath,
    JSON.stringify({
      schemaVersion: "grace-transition-policy-v1",
      productId: "grace",
      traceId: "TRACE-GRACE-CORE",
      transitions: {
        classify_intake: {
          allowedActors: ["COORDINATOR"],
          requiredArtifactRefs: [],
        },
        start_blueprint: {
          allowedActors: ["ARCHITECT"],
          requiredArtifactRefs: ["docs/grace/RequirementsAnalysis.xml"],
        },
      },
    }),
    "utf8",
  );
  return filePath;
}

function createEvidence(dir: string): { stateFile: string; logFile: string } {
  const stateFile = join(dir, "WorkflowState.json");
  const logFile = join(dir, "TransitionLog.jsonl");
  const policyFile = writePolicy(dir);

  withMutedConsoleError(() =>
    applyTransition({
      productId: "grace",
      traceId: "TRACE-GRACE-CORE",
      actor: "COORDINATOR",
      transition: "classify_intake",
      stateFile,
      transitionLogFile: logFile,
      policyFile,
      now: "2026-04-05T08:00:00+03:00",
    }),
  );
  withMutedConsoleError(() =>
    applyTransition({
      productId: "grace",
      traceId: "TRACE-GRACE-CORE",
      actor: "ARCHITECT",
      transition: "start_blueprint",
      stateFile,
      transitionLogFile: logFile,
      policyFile,
      artifactRefs: ["docs/grace/RequirementsAnalysis.xml"],
      now: "2026-04-05T08:00:01+03:00",
    }),
  );

  return { stateFile, logFile };
}

test("FC-grace-validators-validateTransitionEvidence accepts consistent workflow state and transition log evidence", () => {
  const dir = mkdtempSync(join(tmpdir(), "grace-validator-"));
  const { stateFile, logFile } = createEvidence(dir);

  const result = withMutedConsoleError(() =>
    validateTransitionEvidence({
      productId: "grace",
      traceId: "TRACE-GRACE-CORE",
      stateFile,
      transitionLogFile: logFile,
      requiredArtifactRefs: ["docs/grace/RequirementsAnalysis.xml"],
    }),
  );

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.summary.eventCount, 2);
  assert.equal(result.summary.finalState, "BLUEPRINT_DRAFTING");
});

test("FC-grace-validators-validateTransitionEvidence blocks when final state does not match the last transition event", () => {
  const dir = mkdtempSync(join(tmpdir(), "grace-validator-"));
  const { stateFile, logFile } = createEvidence(dir);
  const state = JSON.parse(readFileSync(stateFile, "utf8")) as { currentState: string };
  state.currentState = "HANDOFF_DRAFTING";
  writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const result = withMutedConsoleError(() =>
    validateTransitionEvidence({
      productId: "grace",
      traceId: "TRACE-GRACE-CORE",
      stateFile,
      transitionLogFile: logFile,
    }),
  );

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.equal(result.failures[0]?.code, "FINAL_STATE_MISMATCH");
});

test("FC-grace-validators-validateTransitionEvidence blocks when required artifact refs are missing from evidence", () => {
  const dir = mkdtempSync(join(tmpdir(), "grace-validator-"));
  const { stateFile, logFile } = createEvidence(dir);

  const result = withMutedConsoleError(() =>
    validateTransitionEvidence({
      productId: "grace",
      traceId: "TRACE-GRACE-CORE",
      stateFile,
      transitionLogFile: logFile,
      requiredArtifactRefs: ["docs/grace/approvals.log"],
    }),
  );

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.equal(result.failures[0]?.code, "ARTIFACT_REF_MISSING");
});

test("FC-grace-validators-validateTransitionEvidence blocks approve_handoff evidence that omits approvals.log", () => {
  const dir = mkdtempSync(join(tmpdir(), "grace-validator-"));
  const stateFile = join(dir, "WorkflowState.json");
  const logFile = join(dir, "TransitionLog.jsonl");
  writeFileSync(
    stateFile,
    `${JSON.stringify(
      {
        schemaVersion: "grace-workflow-state-v1",
        productId: "grace",
        traceId: "TRACE-GRACE-CORE",
        currentState: "HANDOFF_APPROVED",
        currentActor: "HUMAN",
        updatedAt: "2026-04-05T08:00:02+03:00",
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
  writeFileSync(
    logFile,
    `${JSON.stringify({
      schemaVersion: "grace-transition-event-v1",
      id: "TRANS-0008",
      traceId: "TRACE-GRACE-CORE",
      productId: "grace",
      transition: "approve_handoff",
      from: "HANDOFF_APPROVAL_PENDING",
      to: "HANDOFF_APPROVED",
      actor: "HUMAN",
      createdAt: "2026-04-05T08:00:02+03:00",
      artifactRefs: ["docs/grace/handoffs/Handoff-20260405-02-GRACE-Artifact-Emitters.xml"],
      notes: [],
    })}\n`,
    "utf8",
  );

  const result = withMutedConsoleError(() =>
    validateTransitionEvidence({
      productId: "grace",
      traceId: "TRACE-GRACE-CORE",
      stateFile,
      transitionLogFile: logFile,
    }),
  );

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.equal(result.failures[0]?.code, "APPROVAL_ARTIFACT_MISSING");
});
