import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { createGraceRuntimeLogger } from "../runtime/runtime-log.js";
import type { GuardEvaluationInput, GuardEvaluationResult, GuardFailure, TransitionPolicyDocument, TransitionPolicyRule } from "./index.js";

/**
 * <!-- MODULE_MAP id="MM-grace-policy-engine" -->
 * <Layers>
 *   <Layer name="domain" package="src/policies/index.ts">
 *     Machine-readable transition policy and guard result contracts for GRACE.
 *   </Layer>
 *   <Layer name="application" package="src/policies/guard-engine.ts">
 *     Deterministic policy loading and transition guard evaluation.
 *   </Layer>
 * </Layers>
 * <Links>
 *   <Link ref="RequirementsAnalysis.xml#UC-GRACE-POLICY-GUARDS" />
 *   <Link ref="DevelopmentPlan.xml#DP-SVC-grace-policy-engine" />
 * </Links>
 * <!-- /MODULE_MAP -->
 */

/**
 * <MODULE_CONTRACT id="MC-grace-policy-engine">
 *   <Purpose>Load machine-readable transition policy and deterministically block unauthorized workflow moves.</Purpose>
 *   <Links>
 *     <Link ref="RequirementsAnalysis.xml#UC-GRACE-POLICY-GUARDS" />
 *     <Link ref="RequirementsAnalysis.xml#DC-GRACE-TRANSITION-POLICY" />
 *   </Links>
 * </MODULE_CONTRACT>
 */

const MC_GRACE_POLICY_ENGINE = "MC-grace-policy-engine";
const FC_GRACE_POLICY_EVALUATE_GUARDS = "FC-grace-policy-evaluateGuards";
const BA_GRACE_LOAD_POLICY = "BA-grace-load-policy";
const BA_GRACE_EVALUATE_GUARDS = "BA-grace-evaluate-guards";
const BA_GRACE_ISSUE_BLOCK = "BA-grace-issue-block";

const DEFAULT_POLICY_FILE = "docs/grace/policies/transition-policy.json";

const graceRuntimeLog = createGraceRuntimeLogger({
  mc: MC_GRACE_POLICY_ENGINE,
  fc: FC_GRACE_POLICY_EVALUATE_GUARDS,
});

function buildFailure(code: GuardFailure["code"], message: string): GuardFailure {
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

function loadPolicyDocument(policyFile: string, productId: string, traceId: string): { policy: TransitionPolicyDocument | null; failures: GuardFailure[] } {
  if (!existsSync(policyFile)) {
    return {
      policy: null,
      failures: [buildFailure("POLICY_FILE_MISSING", `Policy file does not exist: ${policyFile}`)],
    };
  }

  const raw = JSON.parse(readFileSync(policyFile, "utf8")) as unknown;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {
      policy: null,
      failures: [buildFailure("POLICY_SCHEMA_INVALID", "Policy root must be an object.")],
    };
  }

  const candidate = raw as Record<string, unknown>;
  if (candidate.schemaVersion !== "grace-transition-policy-v1") {
    return {
      policy: null,
      failures: [buildFailure("POLICY_SCHEMA_INVALID", "Policy schemaVersion must equal grace-transition-policy-v1.")],
    };
  }
  if (candidate.productId !== productId) {
    return {
      policy: null,
      failures: [buildFailure("POLICY_SCHEMA_INVALID", `Policy productId must equal ${productId}.`)],
    };
  }
  if (candidate.traceId !== traceId) {
    return {
      policy: null,
      failures: [buildFailure("POLICY_SCHEMA_INVALID", `Policy traceId must equal ${traceId}.`)],
    };
  }
  if (typeof candidate.transitions !== "object" || candidate.transitions === null || Array.isArray(candidate.transitions)) {
    return {
      policy: null,
      failures: [buildFailure("POLICY_SCHEMA_INVALID", "Policy transitions must be an object.")],
    };
  }

  const transitions = candidate.transitions as Record<string, unknown>;
  for (const [transition, rule] of Object.entries(transitions)) {
    if (!isPolicyRule(rule)) {
      return {
        policy: null,
        failures: [buildFailure("POLICY_SCHEMA_INVALID", `Policy rule for ${transition} is malformed.`)],
      };
    }
  }

  return {
    policy: candidate as unknown as TransitionPolicyDocument,
    failures: [],
  };
}

function hasRequiredArtifactRef(artifactRefs: string[], requiredRef: string): boolean {
  return artifactRefs.some((artifactRef) => artifactRef.startsWith(requiredRef));
}

function isPathInsideRoot(candidatePath: string, rootPath: string): boolean {
  const rel = relative(resolve(rootPath), resolve(candidatePath));
  return rel.length === 0 || (!rel.startsWith("..") && rel !== "." && !rel.startsWith(`..\\`) && !rel.startsWith("../"));
}

function isPathInsideAnyRoot(candidatePath: string, roots: string[]): boolean {
  return roots.some((rootPath) => isPathInsideRoot(candidatePath, rootPath));
}

/**
 * <FUNCTION_CONTRACT id="FC-grace-policy-evaluateGuards">
 *   <Intent>Load machine-readable transition policy and return a deterministic allow-or-block verdict for one transition.</Intent>
 *   <Inputs>
 *     <Input name="input">Current state, actor, transition, artifact refs, and optional policy path.</Input>
 *   </Inputs>
 *   <Outputs>
 *     <Output name="result">Allow verdict or blocked verdict with deterministic failure codes.</Output>
 *   </Outputs>
 *   <BlockAnchors>
 *     <BA ref="BA-grace-load-policy" />
 *     <BA ref="BA-grace-evaluate-guards" />
 *     <BA ref="BA-grace-issue-block" />
 *   </BlockAnchors>
 *   <Links>
 *     <Link ref="RequirementsAnalysis.xml#UC-GRACE-POLICY-GUARDS" />
 *   </Links>
 * </FUNCTION_CONTRACT>
 */
export function evaluateGuards(input: GuardEvaluationInput): GuardEvaluationResult {
  const policyFilePath = resolve(input.policyFile ?? DEFAULT_POLICY_FILE);

  /* <BLOCK_ANCHOR id="BA-grace-load-policy" purpose="Load the machine-readable transition policy document for the active product trace" /> */
  const loaded = loadPolicyDocument(policyFilePath, input.productId, input.traceId);
  graceRuntimeLog({
    ba: BA_GRACE_LOAD_POLICY,
    belief: "Guard evaluation begins by loading one machine-readable policy document for the active product trace",
    fact: {
      policyFile: policyFilePath,
      failures: loaded.failures.length,
      currentState: input.currentState,
      transition: input.transition,
    },
  });
  if (loaded.policy === null) {
    return {
      ok: false,
      blockedState: "BLOCKED",
      failures: loaded.failures,
    };
  }

  /* <BLOCK_ANCHOR id="BA-grace-evaluate-guards" purpose="Evaluate actor permissions and required artifact refs for the requested transition" /> */
  const failures: GuardFailure[] = [];
  const rule = loaded.policy.transitions[input.transition];
  if (rule === undefined) {
    failures.push(buildFailure("TRANSITION_UNDECLARED", `Transition ${input.transition} is not declared in policy.`));
  } else {
    if (!rule.allowedActors.includes(input.actor)) {
      failures.push(buildFailure("ACTOR_NOT_ALLOWED", `Actor ${input.actor} is not allowed for transition ${input.transition}.`));
    }
    for (const requiredArtifactRef of rule.requiredArtifactRefs) {
      if (!hasRequiredArtifactRef(input.artifactRefs, requiredArtifactRef)) {
        failures.push(buildFailure("ARTIFACT_REF_MISSING", `Missing required artifact ref prefix: ${requiredArtifactRef}`));
      }
    }
  }
  const requestedWritePaths = input.requestedWritePaths ?? [];
  const sourceRepoRoot = input.sourceRepoRoot ? resolve(input.sourceRepoRoot) : null;
  if (sourceRepoRoot !== null && requestedWritePaths.length > 0) {
    const sourceWrites = requestedWritePaths
      .map((filePath) => resolve(filePath))
      .filter((filePath) => isPathInsideRoot(filePath, sourceRepoRoot));
    if (sourceWrites.length > 0 && input.writeModeAuthorized !== true) {
      failures.push(
        buildFailure(
          "LEGACY_WRITE_MODE_REQUIRED",
          `Legacy source writes require explicit write-mode authorization before touching ${sourceWrites.length} source path(s).`,
        ),
      );
      failures.push(
        buildFailure(
          "LEGACY_SOURCE_WRITE_FORBIDDEN",
          `Requested write paths fall inside sourceRepoRoot while onboarding is read-only: ${sourceWrites.join(", ")}`,
        ),
      );
    }
    if (sourceWrites.length > 0 && input.writeModeAuthorized === true) {
      const whitelist = (input.editablePathWhitelist ?? []).map((filePath) => resolve(filePath));
      if (whitelist.length > 0) {
        const disallowed = sourceWrites.filter((filePath) => !isPathInsideAnyRoot(filePath, whitelist));
        if (disallowed.length > 0) {
          failures.push(
            buildFailure(
              "LEGACY_WRITE_PATH_NOT_ALLOWED",
              `Requested write paths are outside the approved editable whitelist: ${disallowed.join(", ")}`,
            ),
          );
        }
      }
    }
  }
  graceRuntimeLog({
    ba: BA_GRACE_EVALUATE_GUARDS,
    belief: "A requested workflow transition is legal only when actor permission and artifact guard checks pass",
    fact: {
      currentState: input.currentState,
      transition: input.transition,
      actor: input.actor,
      failureCount: failures.length,
      requestedWritePathCount: requestedWritePaths.length,
      writeModeAuthorized: input.writeModeAuthorized ?? false,
    },
  });

  if (failures.length > 0) {
    /* <BLOCK_ANCHOR id="BA-grace-issue-block" purpose="Return a deterministic blocked verdict when policy guards fail" /> */
    graceRuntimeLog({
      ba: BA_GRACE_ISSUE_BLOCK,
      belief: "Guard failures deterministically block the workflow transition rather than relying on prompt interpretation",
      fact: {
        transition: input.transition,
        actor: input.actor,
        blockedState: "BLOCKED",
        failureCodes: failures.map((failure) => failure.code),
      },
    });
    return {
      ok: false,
      blockedState: "BLOCKED",
      failures,
    };
  }

  return {
    ok: true,
    blockedState: null,
    failures: [],
  };
}
