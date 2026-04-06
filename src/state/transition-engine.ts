import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { emitWorkflowOwnedArtifacts } from "../artifacts/process-artifacts.js";
import { emitIssueReport } from "../artifacts/issue-report.js";
import { evaluateGuards } from "../policies/guard-engine.js";
import { ensureParentDir } from "../runtime/fs-utils.js";
import { emitGraceRuntimeLog } from "../runtime/runtime-log.js";
import {
  GRACE_TRANSITION_EVENT_SCHEMA,
  GRACE_WORKFLOW_STATE_SCHEMA,
  type TransitionEventDocument,
  type WorkflowActor,
  type WorkflowStateDocument,
  type WorkflowStateName,
  type WorkflowTransitionName,
} from "./index.js";
import type { WorkflowOwnedArtifactSpec } from "../artifacts/index.js";

/**
 * <!-- MODULE_MAP id="MM-grace-workflow-core" -->
 * <Layers>
 *   <Layer name="domain" package="src/state/index.ts">
 *     Canonical workflow state and transition event definitions for GRACE.
 *   </Layer>
 *   <Layer name="application" package="src/state/transition-engine.ts">
 *     Deterministic state loading, transition application, and persistence for the workflow runtime.
 *   </Layer>
 * </Layers>
 * <Links>
 *   <Link ref="RequirementsAnalysis.xml#UC-GRACE-STATE-MACHINE" />
 *   <Link ref="DevelopmentPlan.xml#DP-SVC-grace-workflow-core" />
 * </Links>
 * <!-- /MODULE_MAP -->
 */

/**
 * <MODULE_CONTRACT id="MC-grace-workflow-core">
 *   <Purpose>Own the canonical workflow state and make transition application the only legal mutation surface.</Purpose>
 *   <Links>
 *     <Link ref="RequirementsAnalysis.xml#UC-GRACE-STATE-MACHINE" />
 *     <Link ref="RequirementsAnalysis.xml#DC-GRACE-WORKFLOW-STATE" />
 *   </Links>
 * </MODULE_CONTRACT>
 */

const MC_GRACE_WORKFLOW_CORE = "MC-grace-workflow-core";
const FC_GRACE_STATE_APPLY_TRANSITION = "FC-grace-state-applyTransition";
const BA_GRACE_LOAD_STATE = "BA-grace-load-state";
const BA_GRACE_EVALUATE_TRANSITION = "BA-grace-evaluate-transition";
const BA_GRACE_PERSIST_TRANSITION = "BA-grace-persist-transition";

const DEFAULT_STATE_FILE = "docs/grace/state/WorkflowState.json";
const DEFAULT_EVENT_LOG = "docs/grace/state/TransitionLog.jsonl";
const DEFAULT_APPROVAL_LOG_FILE = "docs/grace/approvals.log";
const DEFAULT_INITIAL_STATE: WorkflowStateName = "INTAKE_RECEIVED";

const TRANSITION_TARGETS: Record<WorkflowTransitionName, WorkflowStateName> = {
  classify_intake: "INTAKE_CLASSIFIED",
  block_intake: "INTAKE_BLOCKED",
  bootstrap_legacy_overlay: "LEGACY_DISCOVERY_PENDING",
  scan_legacy_repo: "LEGACY_SCAN_READY",
  infer_legacy_contracts: "LEGACY_CONTRACTS_DRAFTED",
  seed_legacy_traceability: "LEGACY_GRAPH_READY",
  propose_legacy_slice: "LEGACY_SLICE_READY",
  start_blueprint: "BLUEPRINT_DRAFTING",
  submit_blueprint_for_review: "BLUEPRINT_REVIEW_PENDING",
  approve_blueprint: "BLUEPRINT_APPROVED",
  reject_blueprint: "BLUEPRINT_REJECTED",
  start_handoff: "HANDOFF_DRAFTING",
  propose_handoff: "HANDOFF_PROPOSED",
  request_handoff_approval: "HANDOFF_APPROVAL_PENDING",
  approve_handoff: "HANDOFF_APPROVED",
  reject_handoff: "HANDOFF_REJECTED",
  draft_cwo: "CWO_DRAFTING",
  issue_branchspec: "BRANCHSPEC_ISSUED",
  issue_cwo: "CWO_ISSUED",
  reject_cwo: "CWO_REJECTED",
  activate_coder: "CODER_ACTIVE",
  pause_coder: "CODER_PAUSED",
  submit_coder_output: "CODER_SUBMITTED",
  reject_coder_output: "CODER_REJECTED",
  split_scope_and_reissue_cwo: "CWO_DRAFTING",
  start_verification: "VERIFICATION_RUNNING",
  record_verification_pass: "VERIFICATION_PASSED",
  record_verification_fail: "VERIFICATION_FAILED",
  record_traceability_pass: "TRACEABILITY_PASSED",
  record_traceability_fail: "TRACEABILITY_FAILED",
  record_living_doc_fail: "LIVING_DOC_OUT_OF_SYNC",
  capture_failure: "FAILURE_CAPTURED",
  append_failure_memory: "FAILURE_MEMORY_UPDATED",
  inject_forced_context: "FORCED_CONTEXT_READY",
  evaluate_loop_guard: "LOOP_GUARD_BLOCKED",
  allow_remediation: "REMEDIATION_READY",
  block_remediation: "BLOCKED",
  mark_ready_for_release: "READY_FOR_RELEASE",
  mark_delivered: "DELIVERED",
  archive_delivery: "ARCHIVED",
  block_workflow: "BLOCKED",
  escalate_to_human: "ESCALATED",
  cancel_workflow: "CANCELLED",
};

const ALLOWED_TRANSITIONS: Record<WorkflowStateName, WorkflowTransitionName[]> = {
  INTAKE_RECEIVED: ["classify_intake", "block_intake", "bootstrap_legacy_overlay", "cancel_workflow"],
  LEGACY_DISCOVERY_PENDING: ["scan_legacy_repo", "block_workflow", "cancel_workflow"],
  LEGACY_SCAN_READY: ["infer_legacy_contracts", "block_workflow", "cancel_workflow"],
  LEGACY_CONTRACTS_DRAFTED: ["seed_legacy_traceability", "block_workflow", "cancel_workflow"],
  LEGACY_GRAPH_READY: ["propose_legacy_slice", "block_workflow", "cancel_workflow"],
  LEGACY_SLICE_READY: ["start_handoff", "draft_cwo", "block_workflow", "cancel_workflow"],
  INTAKE_CLASSIFIED: ["bootstrap_legacy_overlay", "start_blueprint", "block_workflow", "cancel_workflow"],
  INTAKE_BLOCKED: ["escalate_to_human", "cancel_workflow"],
  BLUEPRINT_MISSING: ["start_blueprint", "cancel_workflow"],
  BLUEPRINT_DRAFTING: ["submit_blueprint_for_review", "block_workflow", "cancel_workflow"],
  BLUEPRINT_REVIEW_PENDING: ["approve_blueprint", "reject_blueprint", "block_workflow"],
  BLUEPRINT_REJECTED: ["start_blueprint", "cancel_workflow"],
  BLUEPRINT_APPROVED: ["start_handoff", "draft_cwo", "cancel_workflow"],
  HANDOFF_DRAFTING: ["propose_handoff", "block_workflow", "cancel_workflow"],
  HANDOFF_PROPOSED: ["request_handoff_approval", "reject_handoff", "block_workflow"],
  HANDOFF_REJECTED: ["start_handoff", "cancel_workflow"],
  HANDOFF_APPROVAL_PENDING: ["approve_handoff", "reject_handoff", "block_workflow"],
  HANDOFF_APPROVED: ["draft_cwo", "issue_branchspec", "cancel_workflow"],
  CWO_DRAFTING: ["issue_branchspec", "issue_cwo", "reject_cwo", "block_workflow"],
  CWO_ISSUED: ["activate_coder", "split_scope_and_reissue_cwo", "cancel_workflow"],
  CWO_REJECTED: ["draft_cwo", "cancel_workflow"],
  BRANCHSPEC_ISSUED: ["issue_cwo", "cancel_workflow"],
  CODER_READY: ["activate_coder", "cancel_workflow"],
  CODER_ACTIVE: ["pause_coder", "submit_coder_output", "block_workflow"],
  CODER_PAUSED: ["activate_coder", "cancel_workflow"],
  CODER_SUBMITTED: ["start_verification", "reject_coder_output", "block_workflow"],
  CODER_REJECTED: ["activate_coder", "split_scope_and_reissue_cwo", "cancel_workflow"],
  VERIFICATION_PENDING: ["start_verification", "cancel_workflow"],
  VERIFICATION_RUNNING: ["record_verification_pass", "record_verification_fail", "block_workflow"],
  VERIFICATION_FAILED: ["capture_failure", "reject_coder_output", "cancel_workflow"],
  VERIFICATION_PASSED: ["record_traceability_pass", "record_traceability_fail", "record_living_doc_fail"],
  TRACEABILITY_PENDING: ["record_traceability_pass", "record_traceability_fail"],
  TRACEABILITY_FAILED: ["reject_coder_output", "capture_failure", "cancel_workflow"],
  TRACEABILITY_PASSED: ["mark_ready_for_release", "cancel_workflow"],
  LIVING_DOC_OUT_OF_SYNC: ["reject_coder_output", "capture_failure", "cancel_workflow"],
  FAILURE_CAPTURED: ["append_failure_memory", "cancel_workflow"],
  FAILURE_MEMORY_UPDATED: ["inject_forced_context", "cancel_workflow"],
  FORCED_CONTEXT_READY: ["evaluate_loop_guard", "cancel_workflow"],
  LOOP_GUARD_BLOCKED: ["allow_remediation", "block_remediation", "escalate_to_human"],
  REMEDIATION_READY: ["activate_coder", "cancel_workflow"],
  READY_FOR_RELEASE: ["mark_delivered", "cancel_workflow"],
  DELIVERED: ["archive_delivery"],
  ARCHIVED: [],
  BLOCKED: ["escalate_to_human", "cancel_workflow"],
  ESCALATED: ["cancel_workflow"],
  CANCELLED: [],
};

export interface ApplyTransitionInput {
  productId: string;
  traceId: string;
  actor: WorkflowActor;
  transition: WorkflowTransitionName;
  stateFile?: string;
  transitionLogFile?: string;
  policyFile?: string;
  issueReportFile?: string;
  approvalsRef?: string;
  approvalLogFile?: string;
  artifactRefs?: string[];
  workflowOwnedArtifactSpecs?: WorkflowOwnedArtifactSpec[];
  sourceRepoRoot?: string;
  requestedWritePaths?: string[];
  writeModeAuthorized?: boolean;
  editablePathWhitelist?: string[];
  notes?: string[];
  now?: string;
}

export interface ApplyTransitionResult {
  state: WorkflowStateDocument;
  event: TransitionEventDocument;
}

function graceRuntimeLog(entry: {
  ba: string;
  belief: string;
  fact: Record<string, unknown>;
}): void {
  emitGraceRuntimeLog({
    mc: MC_GRACE_WORKFLOW_CORE,
    fc: FC_GRACE_STATE_APPLY_TRANSITION,
    ...entry,
  });
}

function createInitialState(productId: string, traceId: string, actor: WorkflowActor, now: string): WorkflowStateDocument {
  return {
    schemaVersion: GRACE_WORKFLOW_STATE_SCHEMA,
    productId,
    traceId,
    currentState: DEFAULT_INITIAL_STATE,
    currentActor: actor,
    updatedAt: now,
    activeHandoffRef: null,
    activeCwoRef: null,
    blocked: false,
    blockReasons: [],
  };
}

function loadStateDocument(filePath: string, productId: string, traceId: string, actor: WorkflowActor, now: string): WorkflowStateDocument {
  if (!existsSync(filePath)) {
    return createInitialState(productId, traceId, actor, now);
  }

  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as WorkflowStateDocument;
  if (parsed.schemaVersion !== GRACE_WORKFLOW_STATE_SCHEMA) {
    throw new Error(`workflow state schema mismatch: expected ${GRACE_WORKFLOW_STATE_SCHEMA}`);
  }
  if (parsed.productId !== productId) {
    throw new Error(`workflow state product mismatch: expected ${productId}`);
  }
  if (parsed.traceId !== traceId) {
    throw new Error(`workflow state trace mismatch: expected ${traceId}`);
  }
  return parsed;
}

function validateTransition(currentState: WorkflowStateName, transition: WorkflowTransitionName): WorkflowStateName {
  const allowed = ALLOWED_TRANSITIONS[currentState] ?? [];
  if (!allowed.includes(transition)) {
    throw new Error(`transition ${transition} is not allowed from ${currentState}`);
  }
  return TRANSITION_TARGETS[transition];
}

function nextTransitionId(logFilePath: string): string {
  if (!existsSync(logFilePath)) {
    return "TRANS-0001";
  }

  const lines = readFileSync(logFilePath, "utf8")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return `TRANS-${String(lines.length + 1).padStart(4, "0")}`;
}

function findHandoffRef(currentState: WorkflowStateDocument, artifactRefs: string[]): string | null {
  return (
    artifactRefs.find((artifactRef) => artifactRef.includes("/handoffs/") || artifactRef.includes("Handoff-")) ??
    currentState.activeHandoffRef
  );
}

function buildNextState(
  currentState: WorkflowStateDocument,
  actor: WorkflowActor,
  nextStateName: WorkflowStateName,
  now: string,
  artifactRefs: string[],
  notes: string[],
): WorkflowStateDocument {
  const activeHandoffRef =
    artifactRefs.find((artifactRef) => artifactRef.includes("/handoffs/") || artifactRef.includes("Handoff-")) ??
    currentState.activeHandoffRef;
  const activeCwoRef =
    artifactRefs.find((artifactRef) => artifactRef.includes("/cwo/") || artifactRef.includes("CWO-")) ??
    currentState.activeCwoRef;

  return {
    ...currentState,
    currentState: nextStateName,
    currentActor: actor,
    updatedAt: now,
    activeHandoffRef,
    activeCwoRef,
    blocked: nextStateName === "BLOCKED",
    blockReasons: nextStateName === "BLOCKED" ? [...notes, ...(currentState.blockReasons ?? [])] : [],
  };
}

/**
 * <FUNCTION_CONTRACT id="FC-grace-state-applyTransition">
 *   <Intent>Apply one legal workflow transition, persist the updated state, and append one transition event.</Intent>
 *   <Inputs>
 *     <Input name="input">Product id, trace id, actor, transition, and optional persistence paths.</Input>
 *   </Inputs>
 *   <Outputs>
 *     <Output name="result">Updated workflow state and the appended transition event.</Output>
 *   </Outputs>
 *   <BlockAnchors>
 *     <BA ref="BA-grace-load-state" />
 *     <BA ref="BA-grace-evaluate-transition" />
 *     <BA ref="BA-grace-persist-transition" />
 *   </BlockAnchors>
 *   <Links>
 *     <Link ref="RequirementsAnalysis.xml#UC-GRACE-STATE-MACHINE" />
 *     <Link ref="DevelopmentPlan.xml#Flow-GRACE-MainWorkflow" />
 *   </Links>
 * </FUNCTION_CONTRACT>
 */
export function applyTransition(input: ApplyTransitionInput): ApplyTransitionResult {
  const now = input.now ?? new Date().toISOString();
  const stateFilePath = resolve(input.stateFile ?? DEFAULT_STATE_FILE);
  const transitionLogPath = resolve(input.transitionLogFile ?? DEFAULT_EVENT_LOG);

  /* <BLOCK_ANCHOR id="BA-grace-load-state" purpose="Load the canonical workflow state or initialize it deterministically" /> */
  const currentState = loadStateDocument(stateFilePath, input.productId, input.traceId, input.actor, now);
  graceRuntimeLog({
    ba: BA_GRACE_LOAD_STATE,
    belief: "Workflow mutation begins by loading one canonical persisted state document",
    fact: {
      currentState: currentState.currentState,
      stateFile: stateFilePath,
      initialized: !existsSync(stateFilePath),
    },
  });

  const transitionId = nextTransitionId(transitionLogPath);
  const incomingArtifactRefs = input.artifactRefs ?? [];
  const handoffRef = findHandoffRef(currentState, incomingArtifactRefs);
  const workflowOwnedArtifactSpecs = [...(input.workflowOwnedArtifactSpecs ?? [])];
  const localEffectFailures: { code: string; message: string }[] = [];
  if (input.transition === "approve_handoff") {
    if (handoffRef === null) {
      localEffectFailures.push({
        code: "APPROVAL_HANDOFF_REF_MISSING",
        message: "approve_handoff requires a handoff artifact ref before durable approval evidence can be emitted.",
      });
    } else {
      workflowOwnedArtifactSpecs.push({
        kind: "approval-log",
        outputFile: input.approvalLogFile ?? DEFAULT_APPROVAL_LOG_FILE,
        ref: input.approvalsRef ?? "docs/grace/approvals.log",
        sourceTransition: "approve_handoff",
        handoffRef,
      });
    }
  }
  const declaredWorkflowOwnedArtifactRefs = workflowOwnedArtifactSpecs.map((spec) => spec.ref);

  /* <BLOCK_ANCHOR id="BA-grace-evaluate-transition" purpose="Evaluate one explicit transition against the named workflow state graph" /> */
  const guardResult = evaluateGuards({
    productId: input.productId,
    traceId: input.traceId,
    currentState: currentState.currentState,
    actor: input.actor,
    transition: input.transition,
    artifactRefs: [...(input.artifactRefs ?? []), ...declaredWorkflowOwnedArtifactRefs],
    policyFile: input.policyFile,
    sourceRepoRoot: input.sourceRepoRoot,
    requestedWritePaths: input.requestedWritePaths,
    writeModeAuthorized: input.writeModeAuthorized,
    editablePathWhitelist: input.editablePathWhitelist,
  });
  const blockingFailures = [...guardResult.failures, ...localEffectFailures];
  if (blockingFailures.length > 0) {
    const issueReport = emitIssueReport({
      productId: input.productId,
      traceId: input.traceId,
      transitionId,
      actor: input.actor,
      transition: input.transition,
      fromState: currentState.currentState,
      toState: "BLOCKED",
      createdAt: now,
      failures: blockingFailures,
      artifactRefs: input.artifactRefs ?? [],
      reportFile: input.issueReportFile,
    });
    const blockedState: WorkflowStateDocument = {
      ...currentState,
      currentState: "BLOCKED",
      currentActor: input.actor,
      updatedAt: now,
      blocked: true,
      blockReasons: blockingFailures.map((failure) => `${failure.code}: ${failure.message}`),
    };
    const blockedEvent: TransitionEventDocument = {
      schemaVersion: GRACE_TRANSITION_EVENT_SCHEMA,
      id: transitionId,
      traceId: input.traceId,
      productId: input.productId,
      transition: input.transition,
      from: currentState.currentState,
      to: "BLOCKED",
      actor: input.actor,
      createdAt: now,
      artifactRefs: [...(input.artifactRefs ?? []), issueReport.artifactRef],
      notes: blockingFailures.map((failure) => `${failure.code}: ${failure.message}`),
    };
    graceRuntimeLog({
      ba: BA_GRACE_EVALUATE_TRANSITION,
      belief: "Policy verdict must be satisfied before any workflow transition can proceed",
      fact: {
        from: currentState.currentState,
        transition: input.transition,
        to: "BLOCKED",
        actor: input.actor,
        failureCodes: blockingFailures.map((failure) => failure.code),
      },
    });

    ensureParentDir(stateFilePath);
    ensureParentDir(transitionLogPath);
    writeFileSync(stateFilePath, `${JSON.stringify(blockedState, null, 2)}\n`, "utf8");
    writeFileSync(transitionLogPath, `${JSON.stringify(blockedEvent)}\n`, { encoding: "utf8", flag: "a" });
    graceRuntimeLog({
      ba: BA_GRACE_PERSIST_TRANSITION,
      belief: "A blocked policy verdict must still persist durable workflow and transition evidence",
      fact: {
        stateFile: stateFilePath,
        transitionLog: transitionLogPath,
        transitionId: blockedEvent.id,
        nextState: blockedState.currentState,
      },
    });

    return { state: blockedState, event: blockedEvent };
  }

  const nextStateName = validateTransition(currentState.currentState, input.transition);
  const emittedArtifacts =
    workflowOwnedArtifactSpecs.length > 0
      ? emitWorkflowOwnedArtifacts({
          productId: input.productId,
          traceId: input.traceId,
          actor: input.actor,
          transition: input.transition,
          transitionId,
          createdAt: now,
          specs: workflowOwnedArtifactSpecs,
        }).emitted
      : [];
  const combinedArtifactRefs = [...(input.artifactRefs ?? []), ...emittedArtifacts.map((item) => item.artifactRef)];
  const nextState = buildNextState(currentState, input.actor, nextStateName, now, combinedArtifactRefs, input.notes ?? []);
  const event: TransitionEventDocument = {
    schemaVersion: GRACE_TRANSITION_EVENT_SCHEMA,
    id: transitionId,
    traceId: input.traceId,
    productId: input.productId,
    transition: input.transition,
    from: currentState.currentState,
    to: nextStateName,
    actor: input.actor,
    createdAt: now,
    artifactRefs: combinedArtifactRefs,
    notes: input.notes ?? [],
  };
  graceRuntimeLog({
    ba: BA_GRACE_EVALUATE_TRANSITION,
    belief: "A transition is legal only if the current named workflow state permits it",
    fact: {
      from: currentState.currentState,
      transition: input.transition,
      to: nextStateName,
      actor: input.actor,
      guardVerdict: "ALLOW",
    },
  });

  /* <BLOCK_ANCHOR id="BA-grace-persist-transition" purpose="Persist the updated state and append one transition event to the durable log" /> */
  ensureParentDir(stateFilePath);
  ensureParentDir(transitionLogPath);
  writeFileSync(stateFilePath, `${JSON.stringify(nextState, null, 2)}\n`, "utf8");
  writeFileSync(transitionLogPath, `${JSON.stringify(event)}\n`, { encoding: "utf8", flag: "a" });
  graceRuntimeLog({
    ba: BA_GRACE_PERSIST_TRANSITION,
    belief: "Every legal workflow mutation must leave durable state and append-only transition evidence",
    fact: {
      stateFile: stateFilePath,
      transitionLog: transitionLogPath,
      transitionId: event.id,
      nextState: nextState.currentState,
    },
  });

  return { state: nextState, event };
}
