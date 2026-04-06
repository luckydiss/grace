import type {
  TransitionEventDocument,
  WorkflowActor,
  WorkflowStateDocument,
  WorkflowStateName,
  WorkflowTransitionName,
} from "../state/index.js";

export interface TransitionEvidenceValidationInput {
  productId: string;
  traceId: string;
  stateFile?: string;
  transitionLogFile?: string;
  requiredArtifactRefs?: string[];
  approvalArtifactRef?: string;
}

export interface LivingDocumentValidationInput {
  productId: string;
  traceId: string;
  stateFile?: string;
  requirementsFile: string;
  technologyFile: string;
  developmentPlanFile: string;
  executionPlanFile: string;
  reportFile?: string;
  reportRef?: string;
  requiredMarkersByDocument?: Partial<Record<LivingDocumentFailure["document"], string[]>>;
}

export type TransitionEvidenceFailureCode =
  | "STATE_FILE_MISSING"
  | "STATE_SCHEMA_INVALID"
  | "TRANSITION_LOG_MISSING"
  | "TRANSITION_EVENT_INVALID"
  | "TRACE_MISMATCH"
  | "PRODUCT_MISMATCH"
  | "FINAL_STATE_MISMATCH"
  | "BLOCKED_STATE_INCONSISTENT"
  | "ARTIFACT_REF_MISSING"
  | "APPROVAL_ARTIFACT_MISSING";

export interface TransitionEvidenceFailure {
  code: TransitionEvidenceFailureCode;
  message: string;
}

export interface LivingDocumentFailure {
  code: "LIVING_DOC_FILE_MISSING" | "LIVING_DOC_MARKER_MISSING";
  message: string;
  document: "RequirementsAnalysis.xml" | "Technology.xml" | "DevelopmentPlan.xml" | "DevelopmentExecutionPlan.xml";
}

export interface TransitionEvidenceSummary {
  eventCount: number;
  finalState: WorkflowStateName;
  actors: WorkflowActor[];
  transitions: WorkflowTransitionName[];
}

export interface TransitionEvidenceValidationSuccess {
  ok: true;
  failures: [];
  summary: TransitionEvidenceSummary;
  state: WorkflowStateDocument;
  events: TransitionEventDocument[];
}

export interface TransitionEvidenceValidationBlocked {
  ok: false;
  failures: TransitionEvidenceFailure[];
  summary: TransitionEvidenceSummary | null;
  state: WorkflowStateDocument | null;
  events: TransitionEventDocument[];
}

export type TransitionEvidenceValidationResult =
  | TransitionEvidenceValidationSuccess
  | TransitionEvidenceValidationBlocked;

export interface LivingDocumentValidationResult {
  ok: boolean;
  currentState: WorkflowStateName | null;
  failures: LivingDocumentFailure[];
  artifactRef: string | null;
  reportFile: string | null;
}

export interface PolicySchemaConsistencyInput {
  productId: string;
  traceId: string;
  policyFile: string;
  reportFile?: string;
  reportRef?: string;
}

export interface PolicySchemaConsistencyFailure {
  code:
    | "POLICY_FILE_MISSING"
    | "POLICY_PRODUCT_MISMATCH"
    | "POLICY_TRACE_MISMATCH"
    | "TRANSITION_MISSING_IN_POLICY"
    | "UNDECLARED_POLICY_TRANSITION"
    | "KEY_TRANSITION_ARTIFACT_MISSING"
    | "KEY_TRANSITION_ACTOR_MISSING";
  message: string;
}

export interface PolicySchemaConsistencyResult {
  ok: boolean;
  failures: PolicySchemaConsistencyFailure[];
  artifactRef: string | null;
  reportFile: string | null;
}

export interface AgentEvidenceValidationInput {
  repoRoot: string;
  productId: string;
  traceId: string;
  executionDir: string;
  requiredRoles: Array<"ARCHITECT" | "COORDINATOR" | "CODER">;
}

export interface AgentEvidenceFailure {
  code: "AGENT_ARTIFACT_MISSING" | "AGENT_ARTIFACT_INVALID";
  message: string;
}

export interface AgentEvidenceValidationResult {
  ok: boolean;
  failures: AgentEvidenceFailure[];
  artifactRefs: string[];
}

export interface AgentRunEvidenceValidationInput {
  repoRoot: string;
  productId: string;
  traceId: string;
  executionDir: string;
  requiredRoles: Array<"ARCHITECT" | "COORDINATOR" | "CODER">;
}

export interface AgentRunEvidenceFailure {
  code:
    | "AGENT_RUN_STATE_MISSING"
    | "AGENT_RUN_STATE_INVALID"
    | "AGENT_RUN_LOG_MISSING"
    | "AGENT_RUN_LOG_INVALID"
    | "AGENT_RUN_TRANSITION_INVALID"
    | "AGENT_RUN_RETRY_BUDGET_EXCEEDED";
  message: string;
}

export interface AgentRunEvidenceValidationResult {
  ok: boolean;
  failures: AgentRunEvidenceFailure[];
  artifactRefs: string[];
}
