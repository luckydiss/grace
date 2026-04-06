import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runBoundedRole } from "./run-bounded-role.js";

function withMutedConsoleError<T>(fn: () => T): T {
  const original = console.error;
  console.error = () => undefined;
  try {
    return fn();
  } finally {
    console.error = original;
  }
}

function writeState(dir: string, overrides?: Partial<{ currentState: string; blocked: boolean }>): string {
  const filePath = join(dir, "WorkflowState.json");
  writeFileSync(
    filePath,
    `${JSON.stringify(
      {
        schemaVersion: "grace-workflow-state-v1",
        productId: "grace",
        traceId: "TRACE-GRACE-CORE",
        currentState: overrides?.currentState ?? "CODER_ACTIVE",
        currentActor: "CODER",
        updatedAt: "2026-04-05T09:00:00+03:00",
        activeHandoffRef: null,
        activeCwoRef: "docs/grace/cwo/CWO-20260405-01-GRACE-Foundation.xml#CWO-20260405-01",
        blocked: overrides?.blocked ?? false,
        blockReasons: [],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return filePath;
}

test("FC-grace-executors-runBoundedRole emits execution and skill trace evidence for an allowed bounded window", () => {
  const dir = mkdtempSync(join(tmpdir(), "grace-executor-"));
  const stateFile = writeState(dir);
  const executionFile = join(dir, "CoderExecution-0001.xml");
  const skillTraceFile = join(dir, "CoderSkillTrace-0001.json");

  const result = withMutedConsoleError(() =>
    runBoundedRole({
      productId: "grace",
      traceId: "TRACE-GRACE-CORE",
      actorRole: "CODER",
      executionId: "CODER-EXEC-grace-01",
      executionSequence: 1,
      allowedStates: ["CODER_ACTIVE"],
      allowedFcIds: ["FC-grace-executors-runBoundedRole"],
      allowedBaIds: ["BA-grace-run-role"],
      requiredSkillRefs: ["mode-coder", "protocol-grace-patch-safety"],
      inputRefs: ["docs/grace/cwo/CWO-20260405-01-GRACE-Foundation.xml#CWO-20260405-01"],
      stateFile,
      executionFile,
      skillTraceFile,
      now: "2026-04-05T09:00:01+03:00",
      operation: () => ({
        outputRefs: ["src/executors/run-bounded-role.ts#FC-grace-executors-runBoundedRole"],
        touchedFcIds: ["FC-grace-executors-runBoundedRole"],
        touchedBaIds: ["BA-grace-run-role"],
        notes: ["Bounded executor completed inside the declared semantic slice."],
      }),
    }),
  );

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.match(readFileSync(executionFile, "utf8"), /<CoderExecution/u);
  assert.match(readFileSync(executionFile, "utf8"), /FC-grace-executors-runBoundedRole/u);
  assert.match(readFileSync(skillTraceFile, "utf8"), /mode-coder/u);
});

test("FC-grace-executors-runBoundedRole blocks when workflow state is outside the allowed window", () => {
  const dir = mkdtempSync(join(tmpdir(), "grace-executor-"));
  const stateFile = writeState(dir, { currentState: "VERIFICATION_RUNNING" });

  const result = withMutedConsoleError(() =>
    runBoundedRole({
      productId: "grace",
      traceId: "TRACE-GRACE-CORE",
      actorRole: "CODER",
      executionId: "CODER-EXEC-grace-02",
      executionSequence: 2,
      allowedStates: ["CODER_ACTIVE"],
      allowedFcIds: ["FC-grace-executors-runBoundedRole"],
      allowedBaIds: ["BA-grace-run-role"],
      requiredSkillRefs: ["mode-coder"],
      inputRefs: [],
      stateFile,
      operation: () => ({
        outputRefs: [],
        touchedFcIds: ["FC-grace-executors-runBoundedRole"],
        touchedBaIds: ["BA-grace-run-role"],
      }),
    }),
  );

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.equal(result.violations[0]?.code, "WORKFLOW_STATE_NOT_ALLOWED");
});

test("FC-grace-executors-runBoundedRole blocks when touched scope escapes the declared FC or BA window", () => {
  const dir = mkdtempSync(join(tmpdir(), "grace-executor-"));
  const stateFile = writeState(dir);

  const result = withMutedConsoleError(() =>
    runBoundedRole({
      productId: "grace",
      traceId: "TRACE-GRACE-CORE",
      actorRole: "CODER",
      executionId: "CODER-EXEC-grace-03",
      executionSequence: 3,
      allowedStates: ["CODER_ACTIVE"],
      allowedFcIds: ["FC-grace-executors-runBoundedRole"],
      allowedBaIds: ["BA-grace-run-role"],
      requiredSkillRefs: ["mode-coder"],
      inputRefs: [],
      stateFile,
      operation: () => ({
        outputRefs: ["src/policies/guard-engine.ts#FC-grace-policy-evaluateGuards"],
        touchedFcIds: ["FC-grace-policy-evaluateGuards"],
        touchedBaIds: ["BA-grace-issue-block"],
      }),
    }),
  );

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.deepEqual(
    result.violations.map((violation) => violation.code),
    ["FC_SCOPE_VIOLATION", "BA_SCOPE_VIOLATION"],
  );
});
