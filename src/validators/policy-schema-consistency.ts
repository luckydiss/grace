import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureParentDir } from "../runtime/fs-utils.js";
import { emitGraceRuntimeLog } from "../runtime/runtime-log.js";
import { TRANSITIONS } from "../state/index.js";
import type { TransitionPolicyDocument, TransitionPolicyRule } from "../policies/index.js";
import type {
  PolicySchemaConsistencyFailure,
  PolicySchemaConsistencyInput,
  PolicySchemaConsistencyResult,
} from "./index.js";

const MC_GRACE_VALIDATORS = "MC-grace-validators";
const FC_GRACE_VALIDATE_POLICY_SCHEMA = "FC-grace-validators-validatePolicySchemaConsistency";
const BA_GRACE_VALIDATE_POLICY_SCHEMA = "BA-grace-validate-policy-schema";
const BA_GRACE_PERSIST_POLICY_SCHEMA_REPORT = "BA-grace-persist-policy-schema-report";
const DEFAULT_REPORT_FILE = "docs/grace/reports/policy-schema-consistency.json";

const REQUIRED_POLICY_TRANSITIONS = [
  "classify_intake",
  "approve_handoff",
  "issue_cwo",
  "record_verification_pass",
  "record_verification_fail",
  "record_living_doc_fail",
  "record_traceability_pass",
  "record_traceability_fail",
  "capture_failure",
  "mark_ready_for_release",
] as const;

const REQUIRED_ACTORS: Partial<Record<(typeof REQUIRED_POLICY_TRANSITIONS)[number], string[]>> = {
  approve_handoff: ["HUMAN"],
  issue_cwo: ["COORDINATOR"],
  record_living_doc_fail: ["COORDINATOR", "SYSTEM"],
};

const REQUIRED_ARTIFACT_REFS: Partial<Record<(typeof REQUIRED_POLICY_TRANSITIONS)[number], string[]>> = {
  approve_handoff: ["docs/grace/handoffs/"],
  issue_cwo: ["docs/grace/approvals.log", "docs/grace/cwo/"],
};

function graceRuntimeLog(entry: {
  ba: string;
  belief: string;
  fact: Record<string, unknown>;
}): void {
  emitGraceRuntimeLog({
    mc: MC_GRACE_VALIDATORS,
    fc: FC_GRACE_VALIDATE_POLICY_SCHEMA,
    ...entry,
  });
}

function buildFailure(code: PolicySchemaConsistencyFailure["code"], message: string): PolicySchemaConsistencyFailure {
  return { code, message };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isPolicyRule(value: unknown): value is TransitionPolicyRule {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return isStringArray(candidate.allowedActors) && isStringArray(candidate.requiredArtifactRefs);
}

function loadPolicy(policyFile: string): TransitionPolicyDocument {
  const raw = JSON.parse(readFileSync(policyFile, "utf8")) as unknown;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("policy root must be an object");
  }
  const candidate = raw as Record<string, unknown>;
  if (candidate.schemaVersion !== "grace-transition-policy-v1") {
    throw new Error("policy schemaVersion must equal grace-transition-policy-v1");
  }
  if (typeof candidate.transitions !== "object" || candidate.transitions === null || Array.isArray(candidate.transitions)) {
    throw new Error("policy transitions must be an object");
  }
  for (const rule of Object.values(candidate.transitions as Record<string, unknown>)) {
    if (!isPolicyRule(rule)) {
      throw new Error("policy contains a malformed transition rule");
    }
  }
  return candidate as unknown as TransitionPolicyDocument;
}

/**
 * <FUNCTION_CONTRACT id="FC-grace-validators-validatePolicySchemaConsistency">
 *   <Intent>Validate that workflow transitions, policy declarations, actor coverage, and key artifact requirements remain consistent.</Intent>
 *   <Inputs>
 *     <Input name="input">Product id, trace id, policy path, and optional report output path.</Input>
 *   </Inputs>
 *   <Outputs>
 *     <Output name="result">Deterministic policy/schema consistency verdict plus a durable report artifact.</Output>
 *   </Outputs>
 *   <BlockAnchors>
 *     <BA ref="BA-grace-validate-policy-schema" />
 *     <BA ref="BA-grace-persist-policy-schema-report" />
 *   </BlockAnchors>
 *   <Links>
 *     <Link ref="RequirementsAnalysis.xml#UC-GRACE-POLICY-GUARDS" />
 *     <Link ref="RequirementsAnalysis.xml#NFR-GRACE-COMPATIBILITY" />
 *   </Links>
 * </FUNCTION_CONTRACT>
 */
export function validatePolicySchemaConsistency(input: PolicySchemaConsistencyInput): PolicySchemaConsistencyResult {
  const policyFile = resolve(input.policyFile);
  const failures: PolicySchemaConsistencyFailure[] = [];

  /* <BLOCK_ANCHOR id="BA-grace-validate-policy-schema" purpose="Validate transition coverage, actor permissions, and key artifact expectations between workflow state enums and policy rules" /> */
  if (!existsSync(policyFile)) {
    failures.push(buildFailure("POLICY_FILE_MISSING", `Policy file does not exist: ${policyFile}`));
  } else {
    const policy = loadPolicy(policyFile);
    if (policy.productId !== input.productId) {
      failures.push(buildFailure("POLICY_PRODUCT_MISMATCH", `Policy productId must equal ${input.productId}.`));
    }
    if (policy.traceId !== input.traceId) {
      failures.push(buildFailure("POLICY_TRACE_MISMATCH", `Policy traceId must equal ${input.traceId}.`));
    }

    const declaredTransitions = new Set(Object.keys(policy.transitions));
    for (const transition of TRANSITIONS) {
      if (!declaredTransitions.has(transition)) {
        failures.push(buildFailure("TRANSITION_MISSING_IN_POLICY", `Workflow transition ${transition} is not declared in policy.`));
      }
    }
    for (const transition of declaredTransitions) {
      if (!TRANSITIONS.includes(transition as (typeof TRANSITIONS)[number])) {
        failures.push(buildFailure("UNDECLARED_POLICY_TRANSITION", `Policy declares unknown transition ${transition}.`));
      }
    }

    for (const transition of REQUIRED_POLICY_TRANSITIONS) {
      const rule = policy.transitions[transition];
      if (!rule) {
        continue;
      }
      for (const actor of REQUIRED_ACTORS[transition] ?? []) {
        if (!rule.allowedActors.includes(actor as never)) {
          failures.push(buildFailure("KEY_TRANSITION_ACTOR_MISSING", `${transition} must allow actor ${actor}.`));
        }
      }
      for (const artifactRef of REQUIRED_ARTIFACT_REFS[transition] ?? []) {
        if (!rule.requiredArtifactRefs.includes(artifactRef)) {
          failures.push(buildFailure("KEY_TRANSITION_ARTIFACT_MISSING", `${transition} must require artifact ref ${artifactRef}.`));
        }
      }
    }
  }

  graceRuntimeLog({
    ba: BA_GRACE_VALIDATE_POLICY_SCHEMA,
    belief: "Workflow state enums, transition policy, and key governance expectations must remain mutually consistent to keep v2 deterministic",
    fact: {
      policyFile,
      failureCount: failures.length,
      transitionCount: TRANSITIONS.length,
    },
  });

  const reportFile = resolve(input.reportFile ?? DEFAULT_REPORT_FILE);
  const artifactRef = input.reportRef ?? `${input.productId}/docs/grace/reports/policy-schema-consistency.json`;
  const report = {
    schemaVersion: "grace-policy-schema-consistency-v1",
    productId: input.productId,
    traceId: input.traceId,
    ok: failures.length === 0,
    failures,
  };

  /* <BLOCK_ANCHOR id="BA-grace-persist-policy-schema-report" purpose="Persist one durable policy/schema consistency report for audit and verification gates" /> */
  ensureParentDir(reportFile);
  writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  graceRuntimeLog({
    ba: BA_GRACE_PERSIST_POLICY_SCHEMA_REPORT,
    belief: "Policy/schema consistency validation must leave a durable report so framework verify can audit governance drift",
    fact: {
      reportFile,
      artifactRef,
      ok: failures.length === 0,
    },
  });

  return {
    ok: failures.length === 0,
    failures,
    artifactRef,
    reportFile,
  };
}
