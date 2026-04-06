import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { evaluateGuards } from "./guard-engine.js";

function withMutedConsoleError<T>(fn: () => T): T {
  const original = console.error;
  console.error = () => undefined;
  try {
    return fn();
  } finally {
    console.error = original;
  }
}

function writePolicy(dir: string, content: string): string {
  const filePath = join(dir, "transition-policy.json");
  writeFileSync(filePath, content, "utf8");
  return filePath;
}

test("FC-grace-policy-evaluateGuards allows declared actor and artifact refs", () => {
  const dir = mkdtempSync(join(tmpdir(), "grace-policy-"));
  const policyFile = writePolicy(
    dir,
    JSON.stringify({
      schemaVersion: "grace-transition-policy-v1",
      productId: "grace",
      traceId: "TRACE-GRACE-CORE",
      transitions: {
        start_blueprint: {
          allowedActors: ["ARCHITECT", "COORDINATOR"],
          requiredArtifactRefs: ["docs/grace/RequirementsAnalysis.xml"],
        },
      },
    }),
  );

  const result = withMutedConsoleError(() =>
    evaluateGuards({
      productId: "grace",
      traceId: "TRACE-GRACE-CORE",
      currentState: "INTAKE_CLASSIFIED",
      actor: "ARCHITECT",
      transition: "start_blueprint",
      artifactRefs: ["docs/grace/RequirementsAnalysis.xml"],
      policyFile,
    }),
  );

  assert.equal(result.ok, true);
});

test("FC-grace-policy-evaluateGuards blocks undeclared actor and missing artifacts deterministically", () => {
  const dir = mkdtempSync(join(tmpdir(), "grace-policy-"));
  const policyFile = writePolicy(
    dir,
    JSON.stringify({
      schemaVersion: "grace-transition-policy-v1",
      productId: "grace",
      traceId: "TRACE-GRACE-CORE",
      transitions: {
        issue_cwo: {
          allowedActors: ["COORDINATOR"],
          requiredArtifactRefs: ["docs/grace/approvals.log"],
        },
      },
    }),
  );

  const result = withMutedConsoleError(() =>
    evaluateGuards({
      productId: "grace",
      traceId: "TRACE-GRACE-CORE",
      currentState: "CWO_DRAFTING",
      actor: "CODER",
      transition: "issue_cwo",
      artifactRefs: [],
      policyFile,
    }),
  );

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.equal(result.blockedState, "BLOCKED");
  assert.deepEqual(
    result.failures.map((failure) => failure.code),
    ["ACTOR_NOT_ALLOWED", "ARTIFACT_REF_MISSING"],
  );
});

test("FC-grace-policy-evaluateGuards blocks when the policy file is missing", () => {
  const result = withMutedConsoleError(() =>
    evaluateGuards({
      productId: "grace",
      traceId: "TRACE-GRACE-CORE",
      currentState: "INTAKE_CLASSIFIED",
      actor: "ARCHITECT",
      transition: "start_blueprint",
      artifactRefs: [],
      policyFile: join(tmpdir(), "missing-grace-policy.json"),
    }),
  );

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.equal(result.failures[0]?.code, "POLICY_FILE_MISSING");
});

test("FC-grace-policy-evaluateGuards blocks legacy source writes when write mode is not authorized", () => {
  const dir = mkdtempSync(join(tmpdir(), "grace-policy-"));
  const policyFile = writePolicy(
    dir,
    JSON.stringify({
      schemaVersion: "grace-transition-policy-v1",
      productId: "legacy-overlay",
      traceId: "TRACE-LEGACY-OVERLAY-CORE",
      transitions: {
        start_blueprint: {
          allowedActors: ["ARCHITECT", "COORDINATOR"],
          requiredArtifactRefs: [],
        },
      },
    }),
  );

  const result = withMutedConsoleError(() =>
    evaluateGuards({
      productId: "legacy-overlay",
      traceId: "TRACE-LEGACY-OVERLAY-CORE",
      currentState: "INTAKE_CLASSIFIED",
      actor: "ARCHITECT",
      transition: "start_blueprint",
      artifactRefs: [],
      policyFile,
      sourceRepoRoot: "C:/repo/legacy-source",
      requestedWritePaths: ["C:/repo/legacy-source/src/app.ts"],
      writeModeAuthorized: false,
    }),
  );

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.deepEqual(
    result.failures.map((failure) => failure.code),
    ["LEGACY_WRITE_MODE_REQUIRED", "LEGACY_SOURCE_WRITE_FORBIDDEN"],
  );
});

test("FC-grace-policy-evaluateGuards allows overlay writes and authorized source writes", () => {
  const dir = mkdtempSync(join(tmpdir(), "grace-policy-"));
  const policyFile = writePolicy(
    dir,
    JSON.stringify({
      schemaVersion: "grace-transition-policy-v1",
      productId: "legacy-overlay",
      traceId: "TRACE-LEGACY-OVERLAY-CORE",
      transitions: {
        start_blueprint: {
          allowedActors: ["ARCHITECT", "COORDINATOR"],
          requiredArtifactRefs: [],
        },
      },
    }),
  );

  const overlayWriteResult = withMutedConsoleError(() =>
    evaluateGuards({
      productId: "legacy-overlay",
      traceId: "TRACE-LEGACY-OVERLAY-CORE",
      currentState: "INTAKE_CLASSIFIED",
      actor: "ARCHITECT",
      transition: "start_blueprint",
      artifactRefs: [],
      policyFile,
      sourceRepoRoot: "C:/repo/legacy-source",
      requestedWritePaths: ["C:/repo/grace/overlay/docs/grace/LegacyWorkspace.json"],
      writeModeAuthorized: false,
    }),
  );
  assert.equal(overlayWriteResult.ok, true);

  const sourceWriteAuthorizedResult = withMutedConsoleError(() =>
    evaluateGuards({
      productId: "legacy-overlay",
      traceId: "TRACE-LEGACY-OVERLAY-CORE",
      currentState: "INTAKE_CLASSIFIED",
      actor: "ARCHITECT",
      transition: "start_blueprint",
      artifactRefs: [],
      policyFile,
      sourceRepoRoot: "C:/repo/legacy-source",
      requestedWritePaths: ["C:/repo/legacy-source/src/app.ts"],
      writeModeAuthorized: true,
    }),
  );
  assert.equal(sourceWriteAuthorizedResult.ok, true);
});

test("FC-grace-policy-evaluateGuards blocks authorized source writes outside the editable whitelist", () => {
  const dir = mkdtempSync(join(tmpdir(), "grace-policy-"));
  const policyFile = writePolicy(
    dir,
    JSON.stringify({
      schemaVersion: "grace-transition-policy-v1",
      productId: "legacy-overlay",
      traceId: "TRACE-LEGACY-OVERLAY-CORE",
      transitions: {
        block_workflow: {
          allowedActors: ["COORDINATOR"],
          requiredArtifactRefs: [],
        },
      },
    }),
  );

  const result = withMutedConsoleError(() =>
    evaluateGuards({
      productId: "legacy-overlay",
      traceId: "TRACE-LEGACY-OVERLAY-CORE",
      currentState: "LEGACY_SLICE_READY",
      actor: "COORDINATOR",
      transition: "block_workflow",
      artifactRefs: [],
      policyFile,
      sourceRepoRoot: "C:/repo/legacy-source",
      requestedWritePaths: ["C:/repo/legacy-source/src/disallowed.ts"],
      writeModeAuthorized: true,
      editablePathWhitelist: ["C:/repo/legacy-source/src/allowed.ts"],
    }),
  );

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.deepEqual(
    result.failures.map((failure) => failure.code),
    ["LEGACY_WRITE_PATH_NOT_ALLOWED"],
  );
});
