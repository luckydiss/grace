import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { validateLivingDocuments } from "./living-doc.js";

function withMutedConsoleError<T>(fn: () => T): T {
  const original = console.error;
  console.error = () => undefined;
  try {
    return fn();
  } finally {
    console.error = original;
  }
}

function createDocs(dir: string): Record<string, string> {
  const stateFile = join(dir, "WorkflowState.json");
  const requirementsFile = join(dir, "RequirementsAnalysis.xml");
  const technologyFile = join(dir, "Technology.xml");
  const developmentPlanFile = join(dir, "DevelopmentPlan.xml");
  const executionPlanFile = join(dir, "DevelopmentExecutionPlan.xml");
  const reportFile = join(dir, "living-doc-report.json");

  writeFileSync(
    stateFile,
    `${JSON.stringify(
      {
        schemaVersion: "grace-workflow-state-v1",
        productId: "grace",
        traceId: "TRACE-GRACE-CORE",
        currentState: "READY_FOR_RELEASE",
        currentActor: "COORDINATOR",
        updatedAt: "2026-04-05T12:00:00+03:00",
        activeHandoffRef: "docs/grace/handoffs/Handoff-20260405-02-GRACE-Artifact-Emitters.xml",
        activeCwoRef: "docs/grace/cwo/CWO-20260405-02-GRACE-Artifact-Emitters.xml",
        blocked: false,
        blockReasons: [],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  writeFileSync(requirementsFile, "UC-GRACE-STATE-MACHINE\nUC-GRACE-POLICY-GUARDS\nUC-GRACE-HUMAN-APPROVAL\nUC-GRACE-TRACEABILITY\n", "utf8");
  writeFileSync(technologyFile, "DEC-GRACE-ENGINE-001\nDEC-GRACE-POLICY-001\nDEC-GRACE-EVIDENCE-001\n", "utf8");
  writeFileSync(developmentPlanFile, "DP-SVC-grace-workflow-core\nDP-SVC-grace-policy-engine\nDP-SVC-grace-artifact-adapters\nDP-SVC-grace-validators\n", "utf8");
  writeFileSync(executionPlanFile, "W1-T1\nW2-T1\nW5-T1\nW5-T2\nW5-T3\n", "utf8");

  return {
    stateFile,
    requirementsFile,
    technologyFile,
    developmentPlanFile,
    executionPlanFile,
    reportFile,
  };
}

test("FC-grace-validators-validateLivingDocs accepts state-aligned docs and writes a report", () => {
  const dir = mkdtempSync(join(tmpdir(), "grace-living-docs-"));
  const docs = createDocs(dir);

  const result = withMutedConsoleError(() =>
    validateLivingDocuments({
      productId: "grace",
      traceId: "TRACE-GRACE-CORE",
      stateFile: docs.stateFile,
      requirementsFile: docs.requirementsFile,
      technologyFile: docs.technologyFile,
      developmentPlanFile: docs.developmentPlanFile,
      executionPlanFile: docs.executionPlanFile,
      reportFile: docs.reportFile,
      reportRef: "docs/grace/reports/living-doc-report.json",
    }),
  );

  assert.equal(result.ok, true);
  assert.match(readFileSync(docs.reportFile, "utf8"), /grace-living-doc-report-v1/u);
});

test("FC-grace-validators-validateLivingDocs blocks when state-required markers are missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "grace-living-docs-"));
  const docs = createDocs(dir);
  writeFileSync(docs.executionPlanFile, "W1-T1\nW2-T1\nW5-T1\nW5-T2\n", "utf8");

  const result = withMutedConsoleError(() =>
    validateLivingDocuments({
      productId: "grace",
      traceId: "TRACE-GRACE-CORE",
      stateFile: docs.stateFile,
      requirementsFile: docs.requirementsFile,
      technologyFile: docs.technologyFile,
      developmentPlanFile: docs.developmentPlanFile,
      executionPlanFile: docs.executionPlanFile,
      reportFile: docs.reportFile,
      reportRef: "docs/grace/reports/living-doc-report.json",
    }),
  );

  assert.equal(result.ok, false);
  assert.equal(result.failures[0]?.code, "LIVING_DOC_MARKER_MISSING");
  assert.match(result.failures[0]?.message ?? "", /W5-T3/u);
});
