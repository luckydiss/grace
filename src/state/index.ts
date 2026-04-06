export const GRACE_WORKFLOW_STATE_SCHEMA = "grace-workflow-state-v1";
export const GRACE_TRANSITION_EVENT_SCHEMA = "grace-transition-event-v1";

export const WORKFLOW_STATES = [
  "INTAKE_RECEIVED",
  "INTAKE_CLASSIFIED",
  "INTAKE_BLOCKED",
  "LEGACY_DISCOVERY_PENDING",
  "LEGACY_SCAN_READY",
  "LEGACY_CONTRACTS_DRAFTED",
  "LEGACY_GRAPH_READY",
  "LEGACY_SLICE_READY",
  "BLUEPRINT_MISSING",
  "BLUEPRINT_DRAFTING",
  "BLUEPRINT_REVIEW_PENDING",
  "BLUEPRINT_REJECTED",
  "BLUEPRINT_APPROVED",
  "HANDOFF_DRAFTING",
  "HANDOFF_PROPOSED",
  "HANDOFF_REJECTED",
  "HANDOFF_APPROVAL_PENDING",
  "HANDOFF_APPROVED",
  "CWO_DRAFTING",
  "CWO_ISSUED",
  "CWO_REJECTED",
  "BRANCHSPEC_ISSUED",
  "CODER_READY",
  "CODER_ACTIVE",
  "CODER_PAUSED",
  "CODER_SUBMITTED",
  "CODER_REJECTED",
  "VERIFICATION_PENDING",
  "VERIFICATION_RUNNING",
  "VERIFICATION_FAILED",
  "VERIFICATION_PASSED",
  "TRACEABILITY_PENDING",
  "TRACEABILITY_FAILED",
  "TRACEABILITY_PASSED",
  "LIVING_DOC_OUT_OF_SYNC",
  "FAILURE_CAPTURED",
  "FAILURE_MEMORY_UPDATED",
  "FORCED_CONTEXT_READY",
  "LOOP_GUARD_BLOCKED",
  "REMEDIATION_READY",
  "READY_FOR_RELEASE",
  "DELIVERED",
  "ARCHIVED",
  "BLOCKED",
  "ESCALATED",
  "CANCELLED",
] as const;

export const TRANSITIONS = [
  "classify_intake",
  "block_intake",
  "bootstrap_legacy_overlay",
  "scan_legacy_repo",
  "infer_legacy_contracts",
  "seed_legacy_traceability",
  "propose_legacy_slice",
  "start_blueprint",
  "submit_blueprint_for_review",
  "approve_blueprint",
  "reject_blueprint",
  "start_handoff",
  "propose_handoff",
  "request_handoff_approval",
  "approve_handoff",
  "reject_handoff",
  "draft_cwo",
  "issue_branchspec",
  "issue_cwo",
  "reject_cwo",
  "activate_coder",
  "pause_coder",
  "submit_coder_output",
  "reject_coder_output",
  "split_scope_and_reissue_cwo",
  "start_verification",
  "record_verification_pass",
  "record_verification_fail",
  "record_traceability_pass",
  "record_traceability_fail",
  "record_living_doc_fail",
  "capture_failure",
  "append_failure_memory",
  "inject_forced_context",
  "evaluate_loop_guard",
  "allow_remediation",
  "block_remediation",
  "mark_ready_for_release",
  "mark_delivered",
  "archive_delivery",
  "block_workflow",
  "escalate_to_human",
  "cancel_workflow",
] as const;

export type WorkflowStateName = (typeof WORKFLOW_STATES)[number];
export type WorkflowTransitionName = (typeof TRANSITIONS)[number];
export type WorkflowActor = "HUMAN" | "ARCHITECT" | "COORDINATOR" | "CODER" | "SYSTEM";

export interface WorkflowStateDocument {
  schemaVersion: typeof GRACE_WORKFLOW_STATE_SCHEMA;
  productId: string;
  traceId: string;
  currentState: WorkflowStateName;
  currentActor: WorkflowActor;
  updatedAt: string;
  activeHandoffRef: string | null;
  activeCwoRef: string | null;
  blocked: boolean;
  blockReasons: string[];
}

export interface TransitionEventDocument {
  schemaVersion: typeof GRACE_TRANSITION_EVENT_SCHEMA;
  id: string;
  traceId: string;
  productId: string;
  transition: WorkflowTransitionName;
  from: WorkflowStateName;
  to: WorkflowStateName;
  actor: WorkflowActor;
  createdAt: string;
  artifactRefs: string[];
  notes: string[];
}
