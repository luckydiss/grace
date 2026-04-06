import type { WorkflowActor, WorkflowStateName, WorkflowTransitionName } from "../state/index.js";

export interface IssueReportFailure {
  code: string;
  message: string;
}

export interface EmitIssueReportInput {
  productId: string;
  traceId: string;
  transitionId: string;
  actor: WorkflowActor;
  transition: WorkflowTransitionName;
  fromState: WorkflowStateName;
  toState: WorkflowStateName;
  createdAt: string;
  failures: IssueReportFailure[];
  artifactRefs: string[];
  reportFile?: string;
}

export interface EmitIssueReportResult {
  issueReportId: string;
  reportFile: string;
  artifactRef: string;
}

export type WorkflowOwnedArtifactKind = "handoff" | "branchspec" | "cwo" | "approval-log";

export interface WorkflowOwnedArtifactSpec {
  kind: WorkflowOwnedArtifactKind;
  outputFile: string;
  ref: string;
  sourceTransition: WorkflowTransitionName;
  title?: string;
  handoffRef?: string;
  cwoRef?: string;
  branchSpecRef?: string;
}

export interface EmitWorkflowOwnedArtifactsInput {
  productId: string;
  traceId: string;
  actor: WorkflowActor;
  transition: WorkflowTransitionName;
  transitionId: string;
  createdAt: string;
  specs: WorkflowOwnedArtifactSpec[];
}

export interface EmittedWorkflowOwnedArtifact {
  kind: WorkflowOwnedArtifactKind;
  outputFile: string;
  artifactRef: string;
}

export interface EmitWorkflowOwnedArtifactsResult {
  emitted: EmittedWorkflowOwnedArtifact[];
}
