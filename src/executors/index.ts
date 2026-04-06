import type { WorkflowActor, WorkflowStateName } from "../state/index.js";
import type { AgentDescriptor, AgentRoleName, AgentRuntimeAdapter } from "../agents/index.js";

export type BoundedRoleActor = Exclude<WorkflowActor, "HUMAN" | "SYSTEM">;

export interface BoundedRoleExecutionPayload {
  outputRefs: string[];
  touchedFcIds: string[];
  touchedBaIds: string[];
  notes?: string[];
}

export interface RunBoundedRoleInput {
  productId: string;
  traceId: string;
  actorRole: BoundedRoleActor;
  executionId: string;
  executionSequence: number;
  allowedStates: WorkflowStateName[];
  allowedFcIds: string[];
  allowedBaIds: string[];
  requiredSkillRefs: string[];
  inputRefs: string[];
  stateFile?: string;
  executionFile?: string;
  skillTraceFile?: string;
  now?: string;
  operation: () => BoundedRoleExecutionPayload;
}

export type BoundedRoleViolationCode =
  | "STATE_FILE_MISSING"
  | "STATE_SCHEMA_INVALID"
  | "WORKFLOW_BLOCKED"
  | "WORKFLOW_STATE_NOT_ALLOWED"
  | "FC_SCOPE_VIOLATION"
  | "BA_SCOPE_VIOLATION";

export interface BoundedRoleViolation {
  code: BoundedRoleViolationCode;
  message: string;
}

export interface RunBoundedRoleSuccess {
  ok: true;
  actorRole: BoundedRoleActor;
  currentState: WorkflowStateName;
  executionFile: string;
  skillTraceFile: string;
  violations: [];
  outputRefs: string[];
}

export interface RunBoundedRoleBlocked {
  ok: false;
  actorRole: BoundedRoleActor;
  currentState: WorkflowStateName | null;
  executionFile: string | null;
  skillTraceFile: string | null;
  violations: BoundedRoleViolation[];
  outputRefs: string[];
}

export type RunBoundedRoleResult = RunBoundedRoleSuccess | RunBoundedRoleBlocked;

export interface RunRoleExecutorInput {
  repoRoot: string;
  productId: string;
  traceId: string;
  executionSequence: number;
  allowedStates: WorkflowStateName[];
  allowedFcIds: string[];
  allowedBaIds: string[];
  inputRefs: string[];
  scopedSkillRefs?: string[];
  stateFile?: string;
  executionFile?: string;
  skillTraceFile?: string;
  runtimeAdapter?: AgentRuntimeAdapter;
  agentRetryBudget?: number;
  resumeContextRef?: string;
  now?: string;
  operation: () => BoundedRoleExecutionPayload;
}

export interface RunAgentRoleSuccess extends RunBoundedRoleSuccess {
  descriptor: AgentDescriptor;
  loadedSkillRefs: string[];
  taskPacketFile: string;
  invocationFile: string;
  agentRunStateFile: string;
  agentRunLogFile: string;
}

export interface RunAgentRoleBlocked extends RunBoundedRoleBlocked {
  descriptor: AgentDescriptor;
  loadedSkillRefs: string[]; 
  taskPacketFile: string | null;
  invocationFile: string | null;
  agentRunStateFile: string | null;
  agentRunLogFile: string | null;
}

export type RunAgentRoleResult = RunAgentRoleSuccess | RunAgentRoleBlocked;
