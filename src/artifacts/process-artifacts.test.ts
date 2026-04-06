import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { emitWorkflowOwnedArtifacts } from "./process-artifacts.js";

function withMutedConsoleError<T>(fn: () => T): T {
  const original = console.error;
  console.error = () => undefined;
  try {
    return fn();
  } finally {
    console.error = original;
  }
}

test("FC-grace-artifacts-emitWorkflowOwnedArtifacts persists deterministic workflow-owned XML artifacts", () => {
  const dir = mkdtempSync(join(tmpdir(), "grace-process-artifacts-"));
  const handoffFile = join(dir, "WorkflowOwnedHandoff.xml");
  const cwoFile = join(dir, "WorkflowOwnedCWO.xml");

  const result = withMutedConsoleError(() =>
    emitWorkflowOwnedArtifacts({
      productId: "grace",
      traceId: "TRACE-GRACE-CORE",
      actor: "COORDINATOR",
      transition: "propose_handoff",
      transitionId: "TRANS-0006",
      createdAt: "2026-04-05T11:00:00+03:00",
      specs: [
        {
          kind: "handoff",
          outputFile: handoffFile,
          ref: "docs/grace/handoffs/WorkflowOwnedHandoff.xml",
          sourceTransition: "propose_handoff",
          title: "Workflow-owned handoff",
        },
        {
          kind: "cwo",
          outputFile: cwoFile,
          ref: "docs/grace/cwo/WorkflowOwnedCWO.xml",
          sourceTransition: "propose_handoff",
          title: "Workflow-owned cwo",
        },
      ],
    }),
  );

  assert.equal(result.emitted.length, 2);
  assert.match(readFileSync(handoffFile, "utf8"), /<GRACE_HANDOFF\b/u);
  assert.match(readFileSync(cwoFile, "utf8"), /<CODER_WORK_ORDER\b/u);
});

test("FC-grace-artifacts-emitWorkflowOwnedArtifacts appends approval entries without destroying existing log contents", () => {
  const dir = mkdtempSync(join(tmpdir(), "grace-approval-log-"));
  const approvalLog = join(dir, "approvals.log");

  withMutedConsoleError(() =>
    emitWorkflowOwnedArtifacts({
      productId: "grace",
      traceId: "TRACE-GRACE-CORE",
      actor: "HUMAN",
      transition: "approve_handoff",
      transitionId: "TRANS-0008",
      createdAt: "2026-04-05T11:01:00+03:00",
      specs: [
        {
          kind: "approval-log",
          outputFile: approvalLog,
          ref: "docs/grace/approvals.log",
          sourceTransition: "approve_handoff",
          handoffRef: "Handoff-20260405-02-GRACE-Artifact-Emitters",
        },
      ],
    }),
  );
  withMutedConsoleError(() =>
    emitWorkflowOwnedArtifacts({
      productId: "grace",
      traceId: "TRACE-GRACE-CORE",
      actor: "HUMAN",
      transition: "approve_handoff",
      transitionId: "TRANS-0009",
      createdAt: "2026-04-05T11:02:00+03:00",
      specs: [
        {
          kind: "approval-log",
          outputFile: approvalLog,
          ref: "docs/grace/approvals.log",
          sourceTransition: "approve_handoff",
          handoffRef: "Handoff-20260405-03-GRACE-Other",
        },
      ],
    }),
  );

  const log = readFileSync(approvalLog, "utf8");
  assert.match(log, /Handoff-20260405-02-GRACE-Artifact-Emitters/u);
  assert.match(log, /Handoff-20260405-03-GRACE-Other/u);
});
