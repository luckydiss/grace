import type { WorkflowActor, WorkflowStateName, WorkflowTransitionName } from "../state/index.js";

export interface TransitionPolicyRule {
  allowedActors: WorkflowActor[];
  requiredArtifactRefs: string[];
}

export interface TransitionPolicyDocument {
  schemaVersion: "grace-transition-policy-v1";
  productId: string;
  traceId: string;
  transitions: Partial<Record<WorkflowTransitionName, TransitionPolicyRule>>;
}

export interface GuardEvaluationInput {
  productId: string;
  traceId: string;
  currentState: WorkflowStateName;
  actor: WorkflowActor;
  transition: WorkflowTransitionName;
  artifactRefs: string[];
  policyFile?: string;
  sourceRepoRoot?: string;
  requestedWritePaths?: string[];
  writeModeAuthorized?: boolean;
  editablePathWhitelist?: string[];
}

export interface GuardFailure {
  code:
    | "POLICY_FILE_MISSING"
    | "POLICY_SCHEMA_INVALID"
    | "TRANSITION_UNDECLARED"
    | "ACTOR_NOT_ALLOWED"
    | "ARTIFACT_REF_MISSING"
    | "LEGACY_WRITE_MODE_REQUIRED"
    | "LEGACY_SOURCE_WRITE_FORBIDDEN"
    | "LEGACY_WRITE_PATH_NOT_ALLOWED";
  message: string;
}

export interface GuardEvaluationSuccess {
  ok: true;
  blockedState: null;
  failures: [];
}

export interface GuardEvaluationBlocked {
  ok: false;
  blockedState: "BLOCKED";
  failures: GuardFailure[];
}

export type GuardEvaluationResult = GuardEvaluationSuccess | GuardEvaluationBlocked;
