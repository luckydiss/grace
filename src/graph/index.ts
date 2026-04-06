import type { WorkflowStateName } from "../state/index.js";

export interface GraceWorkflowInput {
  repoRoot: string;
  productRoot: string;
  sourceRepoRoot: string;
  productId: string;
  traceId: string;
  stateFile: string;
  transitionLogFile: string;
  policyFile: string;
  issueReportFile: string;
  executionDir: string;
  verificationMode: "pass" | "fail";
  handoffRef: string;
  requirementsRef: string;
  technologyRef: string;
  developmentPlanRef: string;
  executionPlanRef: string;
  approvalsRef: string;
  approvalLogFile: string;
  requirementsFile: string;
  technologyFile: string;
  developmentPlanFile: string;
  executionPlanFile: string;
  livingDocReportFile: string;
  livingDocReportRef: string;
  policySchemaReportFile: string;
  policySchemaReportRef: string;
  branchSpecRef: string;
  cwoRef: string;
  failureMemoryFile: string;
  forcedContextFile: string;
  loopGuardFile: string;
  failureScope: string;
  failureTestId: string;
  failureErrorSignature: string;
  retryCount: number;
  retryBudget: number;
  proposedFix: string;
}

export interface GraceWorkflowState extends GraceWorkflowInput {
  currentState: WorkflowStateName | null;
  approvalDecision: "APPROVE" | "REJECT" | null;
  transitionHistory: string[];
  artifactHistory: string[];
  issueReportRefs: string[];
}
