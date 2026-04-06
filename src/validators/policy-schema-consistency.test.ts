import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { validatePolicySchemaConsistency } from "./policy-schema-consistency.js";

function withMutedConsoleError<T>(fn: () => T): T {
  const original = console.error;
  console.error = () => undefined;
  try {
    return fn();
  } finally {
    console.error = original;
  }
}

function makePolicyFile(dir: string, overrides?: (policy: Record<string, unknown>) => void): { policyFile: string; reportFile: string } {
  const policyFile = join(dir, "transition-policy.json");
  const reportFile = join(dir, "policy-schema-consistency.json");
  const policy = JSON.parse(readFileSync(resolve(process.cwd(), "docs", "grace", "policies", "transition-policy.json"), "utf8")) as Record<string, unknown>;
  overrides?.(policy);
  writeFileSync(policyFile, `${JSON.stringify(policy, null, 2)}\n`, "utf8");
  return { policyFile, reportFile };
}

test("FC-grace-validators-validatePolicySchemaConsistency accepts aligned workflow and policy contracts", () => {
  const dir = mkdtempSync(join(tmpdir(), "grace-policy-schema-"));
  const files = makePolicyFile(dir);

  const result = withMutedConsoleError(() =>
    validatePolicySchemaConsistency({
      productId: "grace",
      traceId: "TRACE-GRACE-CORE",
      policyFile: files.policyFile,
      reportFile: files.reportFile,
      reportRef: "docs/grace/reports/policy-schema-consistency.json",
    }),
  );

  assert.equal(result.ok, true);
  assert.match(readFileSync(files.reportFile, "utf8"), /grace-policy-schema-consistency-v1/u);
});

test("FC-grace-validators-validatePolicySchemaConsistency blocks when required transitions or artifact rules drift", () => {
  const dir = mkdtempSync(join(tmpdir(), "grace-policy-schema-"));
  const files = makePolicyFile(dir, (policy) => {
    const transitions = policy.transitions as Record<string, unknown>;
    delete transitions.record_living_doc_fail;
    const issueCwo = transitions.issue_cwo as { allowedActors: string[]; requiredArtifactRefs: string[] };
    issueCwo.requiredArtifactRefs = ["docs/grace/cwo/"];
  });

  const result = withMutedConsoleError(() =>
    validatePolicySchemaConsistency({
      productId: "grace",
      traceId: "TRACE-GRACE-CORE",
      policyFile: files.policyFile,
      reportFile: files.reportFile,
      reportRef: "docs/grace/reports/policy-schema-consistency.json",
    }),
  );

  assert.equal(result.ok, false);
  assert.match(result.failures.map((item) => item.code).join(" "), /TRANSITION_MISSING_IN_POLICY|KEY_TRANSITION_ARTIFACT_MISSING/u);
});
