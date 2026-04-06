import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureParentDir } from "../runtime/fs-utils.js";
import { emitGraceRuntimeLog } from "../runtime/runtime-log.js";
import { GRACE_WORKFLOW_STATE_SCHEMA, type WorkflowStateDocument, type WorkflowStateName } from "../state/index.js";
import { buildDefaultLivingDocMarkers } from "../runtime/product-target.js";
import type {
  LivingDocumentFailure,
  LivingDocumentValidationInput,
  LivingDocumentValidationResult,
} from "./index.js";

const MC_GRACE_VALIDATORS = "MC-grace-validators";
const FC_GRACE_VALIDATE_LIVING_DOCS = "FC-grace-validators-validateLivingDocs";
const BA_GRACE_VALIDATE_LIVING_DOCS = "BA-grace-validate-living-docs";
const BA_GRACE_PERSIST_LIVING_DOC_REPORT = "BA-grace-persist-living-doc-report";
const DEFAULT_REPORT_FILE = "docs/grace/reports/living-doc-report.json";

const READY_FOR_HANDOFF_STATES = new Set<WorkflowStateName>([
  "HANDOFF_APPROVAL_PENDING",
  "HANDOFF_APPROVED",
  "CWO_DRAFTING",
  "BRANCHSPEC_ISSUED",
  "CWO_ISSUED",
  "CODER_ACTIVE",
  "CODER_SUBMITTED",
  "VERIFICATION_RUNNING",
  "VERIFICATION_PASSED",
  "TRACEABILITY_PASSED",
  "READY_FOR_RELEASE",
  "DELIVERED",
  "ARCHIVED",
]);

const READY_FOR_TRACEABILITY_STATES = new Set<WorkflowStateName>([
  "VERIFICATION_PASSED",
  "TRACEABILITY_PASSED",
  "READY_FOR_RELEASE",
  "DELIVERED",
  "ARCHIVED",
]);

function graceRuntimeLog(entry: {
  ba: string;
  belief: string;
  fact: Record<string, unknown>;
}): void {
  emitGraceRuntimeLog({
    mc: MC_GRACE_VALIDATORS,
    fc: FC_GRACE_VALIDATE_LIVING_DOCS,
    ...entry,
  });
}

function loadStateName(stateFile: string | undefined): WorkflowStateName | null {
  if (!stateFile || !existsSync(stateFile)) {
    return null;
  }
  const parsed = JSON.parse(readFileSync(stateFile, "utf8")) as WorkflowStateDocument;
  if (parsed.schemaVersion !== GRACE_WORKFLOW_STATE_SCHEMA) {
    throw new Error(`workflow state schema mismatch: expected ${GRACE_WORKFLOW_STATE_SCHEMA}`);
  }
  return parsed.currentState;
}

function requiredMarkers(
  productId: string,
  stateName: WorkflowStateName | null,
  override: LivingDocumentValidationInput["requiredMarkersByDocument"],
): Record<LivingDocumentFailure["document"], string[]> {
  const markers = buildDefaultLivingDocMarkers(productId);

  if (productId === "grace" && stateName !== null && READY_FOR_HANDOFF_STATES.has(stateName)) {
    markers["RequirementsAnalysis.xml"].push("UC-GRACE-HUMAN-APPROVAL");
    markers["DevelopmentPlan.xml"].push("DP-SVC-grace-artifact-adapters");
    markers["DevelopmentExecutionPlan.xml"].push("W5-T1", "W5-T2");
  }
  if (productId === "grace" && stateName !== null && READY_FOR_TRACEABILITY_STATES.has(stateName)) {
    markers["RequirementsAnalysis.xml"].push("UC-GRACE-TRACEABILITY");
    markers["Technology.xml"].push("DEC-GRACE-EVIDENCE-001");
    markers["DevelopmentPlan.xml"].push("DP-SVC-grace-validators");
    markers["DevelopmentExecutionPlan.xml"].push("W5-T3");
  }
  if (override) {
    for (const [document, extra] of Object.entries(override) as Array<[LivingDocumentFailure["document"], string[]]>) {
      markers[document] = extra;
    }
  }
  return markers;
}

/**
 * <FUNCTION_CONTRACT id="FC-grace-validators-validateLivingDocs">
 *   <Intent>Validate that core GRACE documents still describe the active workflow state so the process cannot advance on stale planning artifacts.</Intent>
 *   <Inputs>
 *     <Input name="input">Workflow state path plus the four core GRACE document paths and an optional report output path.</Input>
 *   </Inputs>
 *   <Outputs>
 *     <Output name="result">Deterministic living-document verdict plus a durable report artifact.</Output>
 *   </Outputs>
 *   <BlockAnchors>
 *     <BA ref="BA-grace-validate-living-docs" />
 *     <BA ref="BA-grace-persist-living-doc-report" />
 *   </BlockAnchors>
 *   <Links>
 *     <Link ref="RequirementsAnalysis.xml#UC-GRACE-TRACEABILITY" />
 *     <Link ref="RequirementsAnalysis.xml#NFR-GRACE-AUDITABILITY" />
 *   </Links>
 * </FUNCTION_CONTRACT>
 */
export function validateLivingDocuments(input: LivingDocumentValidationInput): LivingDocumentValidationResult {
  const currentState = loadStateName(input.stateFile ? resolve(input.stateFile) : undefined);
  const markers = requiredMarkers(input.productId, currentState, input.requiredMarkersByDocument);
  const docs: Array<[LivingDocumentFailure["document"], string]> = [
    ["RequirementsAnalysis.xml", resolve(input.requirementsFile)],
    ["Technology.xml", resolve(input.technologyFile)],
    ["DevelopmentPlan.xml", resolve(input.developmentPlanFile)],
    ["DevelopmentExecutionPlan.xml", resolve(input.executionPlanFile)],
  ];
  const failures: LivingDocumentFailure[] = [];

  /* <BLOCK_ANCHOR id="BA-grace-validate-living-docs" purpose="Validate state-dependent living-document markers across the core GRACE docs" /> */
  for (const [document, filePath] of docs) {
    if (!existsSync(filePath)) {
      failures.push({
        code: "LIVING_DOC_FILE_MISSING",
        document,
        message: `${document} does not exist: ${filePath}`,
      });
      continue;
    }
    const content = readFileSync(filePath, "utf8");
    for (const marker of markers[document]) {
      if (!content.includes(marker)) {
        failures.push({
          code: "LIVING_DOC_MARKER_MISSING",
          document,
          message: `${document} must contain marker ${marker} for workflow state ${currentState ?? "UNKNOWN"}.`,
        });
      }
    }
  }
  graceRuntimeLog({
    ba: BA_GRACE_VALIDATE_LIVING_DOCS,
    belief: "Living-document synchronization is valid only when core GRACE docs contain the markers required by the active workflow state",
    fact: {
      currentState,
      failureCount: failures.length,
      documents: docs.map(([document]) => document),
    },
  });

  const reportFile = resolve(input.reportFile ?? DEFAULT_REPORT_FILE);
  const artifactRef = input.reportRef ?? `${input.productId}/docs/grace/reports/living-doc-report.json`;
  const report = {
    schemaVersion: "grace-living-doc-report-v1",
    productId: input.productId,
    traceId: input.traceId,
    currentState,
    ok: failures.length === 0,
    failures,
  };

  /* <BLOCK_ANCHOR id="BA-grace-persist-living-doc-report" purpose="Persist a durable living-document report for later audit and gating" /> */
  ensureParentDir(reportFile);
  writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  graceRuntimeLog({
    ba: BA_GRACE_PERSIST_LIVING_DOC_REPORT,
    belief: "Living-document validation must leave a durable report artifact for audit and blocking decisions",
    fact: {
      reportFile,
      artifactRef,
      ok: failures.length === 0,
    },
  });

  return {
    ok: failures.length === 0,
    currentState,
    failures,
    artifactRef,
    reportFile,
  };
}
