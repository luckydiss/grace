export interface AutonomyRecoveryInput {
  productId: string;
  traceId: string;
  stateFile: string;
  transitionLogFile: string;
  policyFile?: string;
  issueReportFile?: string;
  failureMemoryFile: string;
  forcedContextFile: string;
  loopGuardFile: string;
  scope: string;
  testId: string;
  errorSignature: string;
  failedHypothesis?: string;
  rejectedFixPattern?: string;
  verifiedRecovery?: string;
  retryCount: number;
  retryBudget: number;
  proposedFix?: string;
  evidenceRefs: string[];
}

export interface AutonomyRecoveryResult {
  currentState: "REMEDIATION_READY" | "BLOCKED";
  transitionHistory: string[];
  artifactRefs: string[];
  forcedContextCount: number;
  loopGuardStatus: "ALLOW" | "ESCALATE_WITH_CONTEXT" | "BLOCK";
  blockReasons: string[];
}
