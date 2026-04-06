import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { executeRecoveryBridge } from "./recovery-bridge.js";

function withMutedConsoleError<T>(fn: () => T): T {
  const original = console.error;
  console.error = () => undefined;
  try {
    return fn();
  } finally {
    console.error = original;
  }
}

function writeState(dir: string): string {
  const filePath = join(dir, "WorkflowState.json");
  writeFileSync(
    filePath,
    `${JSON.stringify(
      {
        schemaVersion: "grace-workflow-state-v1",
        productId: "grace",
        traceId: "TRACE-GRACE-CORE",
        currentState: "FAILURE_CAPTURED",
        currentActor: "COORDINATOR",
        updatedAt: "2026-04-05T11:00:00+03:00",
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
  return filePath;
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
        append_failure_memory: { allowedActors: ["COORDINATOR"], requiredArtifactRefs: ["docs/grace/reports/failure-memory.json"] },
        inject_forced_context: { allowedActors: ["COORDINATOR"], requiredArtifactRefs: ["docs/grace/reports/failure-memory.json", "docs/grace/reports/forced-context.json"] },
        evaluate_loop_guard: { allowedActors: ["COORDINATOR"], requiredArtifactRefs: ["docs/grace/reports/loop-guard.json"] },
        allow_remediation: { allowedActors: ["COORDINATOR"], requiredArtifactRefs: ["docs/grace/reports/loop-guard.json"] },
        block_remediation: { allowedActors: ["COORDINATOR"], requiredArtifactRefs: ["docs/grace/reports/loop-guard.json"] },
      },
    }),
    "utf8",
  );
  return filePath;
}

test("FC-grace-autonomy-executeRecovery reopens remediation when loop guard allows another attempt", () => {
  const dir = mkdtempSync(join(tmpdir(), "grace-autonomy-"));
  const result = withMutedConsoleError(() =>
    executeRecoveryBridge({
      productId: "grace",
      traceId: "TRACE-GRACE-CORE",
      stateFile: writeState(dir),
      transitionLogFile: join(dir, "TransitionLog.jsonl"),
      policyFile: writePolicy(dir),
      failureMemoryFile: join(dir, "failure-memory.json"),
      forcedContextFile: join(dir, "forced-context.json"),
      loopGuardFile: join(dir, "loop-guard.json"),
      scope: "FC-grace-graph-buildWorkflow",
      testId: "TC-GRACE-FAIL-01",
      errorSignature: "verification failed",
      retryCount: 1,
      retryBudget: 2,
      evidenceRefs: ["docs/grace/reports/verification-results.json"],
    }),
  );

  assert.equal(result.currentState, "REMEDIATION_READY");
  assert.equal(result.loopGuardStatus, "ALLOW");
  assert.match(readFileSync(join(dir, "forced-context.json"), "utf8"), /CONTEXT_BUNDLE_READY/u);
});

test("FC-grace-autonomy-executeRecovery blocks remediation when retry budget is exhausted and rejected fix repeats", () => {
  const dir = mkdtempSync(join(tmpdir(), "grace-autonomy-"));
  const memoryFile = join(dir, "failure-memory.json");
  writeFileSync(
    memoryFile,
    `${JSON.stringify(
      {
        schemaVersion: "grace-failure-memory-v1",
        generatedAt: "2026-04-05T11:00:00+03:00",
        records: [
          {
            id: "FM-1",
            traceId: "TRACE-GRACE-CORE",
            semanticScope: "FC-grace-graph-buildWorkflow",
            testId: "TC-GRACE-FAIL-01",
            errorSignature: "verification failed",
            rejectedFixPattern: "repeat-fix",
            evidenceRefs: [],
            createdAt: "2026-04-05T11:00:00+03:00",
            firstSeen: "2026-04-05T11:00:00+03:00",
            lastSeen: "2026-04-05T11:00:00+03:00",
            occurrenceCount: 1,
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const result = withMutedConsoleError(() =>
    executeRecoveryBridge({
      productId: "grace",
      traceId: "TRACE-GRACE-CORE",
      stateFile: writeState(dir),
      transitionLogFile: join(dir, "TransitionLog.jsonl"),
      policyFile: writePolicy(dir),
      failureMemoryFile: memoryFile,
      forcedContextFile: join(dir, "forced-context.json"),
      loopGuardFile: join(dir, "loop-guard.json"),
      scope: "FC-grace-graph-buildWorkflow",
      testId: "TC-GRACE-FAIL-01",
      errorSignature: "verification failed",
      retryCount: 3,
      retryBudget: 2,
      proposedFix: "repeat-fix",
      evidenceRefs: ["docs/grace/reports/verification-results.json"],
    }),
  );

  assert.equal(result.currentState, "BLOCKED");
  assert.equal(result.loopGuardStatus, "BLOCK");
  assert.match(result.blockReasons.join(" "), /REJECTED_FIX_PATTERN_REPEATED|RETRY_BUDGET_EXHAUSTED/u);
});
