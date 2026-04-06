import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { applyTransition } from "../state/transition-engine.js";
import type { WorkflowStateDocument, WorkflowStateName } from "../state/index.js";
import type { WorkflowOwnedArtifactSpec } from "../artifacts/index.js";
import { createGraceRuntimeLogger } from "../runtime/runtime-log.js";
import { toRepoArtifactRef } from "../runtime/product-target.js";
import type { GraceWorkflowInput, GraceWorkflowState } from "./index.js";

const MC_GRACE_WORKFLOW_CORE = "MC-grace-workflow-core";
const FC_GRACE_GRAPH_BUILD_WORKFLOW = "FC-grace-graph-buildWorkflow";
const BA_GRACE_ROUTE_MAIN = "BA-grace-route-main";

export type WorkflowGraphState = GraceWorkflowState;
export type WorkflowGraphUpdate = Partial<GraceWorkflowState>;

export const graceRuntimeLog = createGraceRuntimeLogger({
  mc: MC_GRACE_WORKFLOW_CORE,
  fc: FC_GRACE_GRAPH_BUILD_WORKFLOW,
});

export function transitionUpdate(
  state: WorkflowGraphState,
  actor: Parameters<typeof applyTransition>[0]["actor"],
  transition: Parameters<typeof applyTransition>[0]["transition"],
  artifactRefs: string[],
  workflowOwnedArtifactSpecs: WorkflowOwnedArtifactSpec[] = [],
): WorkflowGraphUpdate {
  const issueReportFile =
    transition === "issue_cwo" || transition === "approve_handoff" || transition === "record_verification_fail"
      ? undefined
      : state.issueReportFile;
  const result = applyTransition({
    productId: state.productId,
    traceId: state.traceId,
    actor,
    transition,
    stateFile: state.stateFile,
    transitionLogFile: state.transitionLogFile,
    policyFile: state.policyFile,
    issueReportFile,
    approvalsRef: state.approvalsRef,
    approvalLogFile: state.approvalLogFile,
    artifactRefs,
    workflowOwnedArtifactSpecs,
  });
  return {
    currentState: result.state.currentState,
    transitionHistory: [result.event.transition],
    artifactHistory: result.event.artifactRefs,
    issueReportRefs: result.event.artifactRefs.filter((ref) => ref.includes("IssueReport-")),
  };
}

export function appendRuntimeTransition(
  state: WorkflowGraphState,
  actor: Parameters<typeof applyTransition>[0]["actor"],
  transition: Parameters<typeof applyTransition>[0]["transition"],
  artifactRefs: string[],
  workflowOwnedArtifactSpecs: WorkflowOwnedArtifactSpec[] = [],
): WorkflowGraphUpdate {
  const update = transitionUpdate(state, actor, transition, artifactRefs, workflowOwnedArtifactSpecs);
  graceRuntimeLog({
    ba: BA_GRACE_ROUTE_MAIN,
    belief: "LangGraph nodes route through the canonical transition engine instead of mutating workflow state directly",
    fact: {
      transition,
      actor,
      currentState: update.currentState,
      artifactRefs,
    },
  });
  return update;
}

export function isLegacyOnboardingState(state: WorkflowStateName | null): boolean {
  return [
    "LEGACY_DISCOVERY_PENDING",
    "LEGACY_SCAN_READY",
    "LEGACY_CONTRACTS_DRAFTED",
    "LEGACY_GRAPH_READY",
    "LEGACY_SLICE_READY",
  ].includes(state ?? "INTAKE_RECEIVED");
}

export function buildLegacyRefs(state: WorkflowGraphState) {
  const root = state.productRoot;
  return {
    legacyWorkspaceFile: join(root, "docs", "grace", "LegacyWorkspace.json"),
    sourceRepoMapFile: join(root, "docs", "grace", "SourceRepoMap.json"),
    scanReportFile: join(root, "docs", "grace", "reports", "LegacyScanReport.json"),
    riskReportFile: join(root, "docs", "grace", "reports", "LegacyRiskReport.json"),
    contractDraftsFile: join(root, "docs", "grace", "reports", "LegacyContractDrafts.json"),
    graphRegistryFile: join(root, "docs", "grace", "reports", "LegacyGraphRegistry.json"),
    slicePlanFile: join(root, "docs", "grace", "reports", "LegacySlicePlan.json"),
    dryRunFile: join(root, "docs", "grace", "reports", "LegacyEditDryRun.json"),
    legacyWorkspaceRef: toRepoArtifactRef(state.repoRoot, join(root, "docs", "grace", "LegacyWorkspace.json")),
    sourceRepoMapRef: toRepoArtifactRef(state.repoRoot, join(root, "docs", "grace", "SourceRepoMap.json")),
    scanReportRef: toRepoArtifactRef(state.repoRoot, join(root, "docs", "grace", "reports", "LegacyScanReport.json")),
    riskReportRef: toRepoArtifactRef(state.repoRoot, join(root, "docs", "grace", "reports", "LegacyRiskReport.json")),
    contractDraftsRef: toRepoArtifactRef(state.repoRoot, join(root, "docs", "grace", "reports", "LegacyContractDrafts.json")),
    graphRegistryRef: toRepoArtifactRef(state.repoRoot, join(root, "docs", "grace", "reports", "LegacyGraphRegistry.json")),
    slicePlanRef: toRepoArtifactRef(state.repoRoot, join(root, "docs", "grace", "reports", "LegacySlicePlan.json")),
    dryRunRef: toRepoArtifactRef(state.repoRoot, join(root, "docs", "grace", "reports", "LegacyEditDryRun.json")),
  };
}

function repoArtifactRefToFile(repoRoot: string, artifactRef: string): string {
  return resolve(repoRoot, ...artifactRef.split("/"));
}

export function buildProcessArtifactSpec(
  repoRoot: string,
  kind: WorkflowOwnedArtifactSpec["kind"],
  artifactRef: string,
  sourceTransition: WorkflowOwnedArtifactSpec["sourceTransition"],
  title: string,
  overrides: Partial<WorkflowOwnedArtifactSpec> = {},
): WorkflowOwnedArtifactSpec {
  return {
    kind,
    ref: artifactRef,
    outputFile: repoArtifactRefToFile(repoRoot, artifactRef),
    sourceTransition,
    title,
    ...overrides,
  };
}

export function buildCoderArtifacts(state: WorkflowGraphState): {
  executionFile: string;
  skillTraceFile: string;
  executionRef: string;
  skillTraceRef: string;
} {
  const executionFile = join(state.executionDir, "CoderExecution-Workflow-0001.xml");
  const skillTraceFile = join(state.executionDir, "CoderSkillTrace-Workflow-0001.json");
  return {
    executionFile,
    skillTraceFile,
    executionRef: toRepoArtifactRef(state.repoRoot, executionFile),
    skillTraceRef: toRepoArtifactRef(state.repoRoot, skillTraceFile),
  };
}

export function buildCoordinatorArtifacts(state: WorkflowGraphState): {
  executionFile: string;
  skillTraceFile: string;
  executionRef: string;
  skillTraceRef: string;
} {
  const executionFile = join(state.executionDir, "CoordinatorExecution-Workflow-0001.xml");
  const skillTraceFile = join(state.executionDir, "CoordinatorSkillTrace-Workflow-0001.json");
  return {
    executionFile,
    skillTraceFile,
    executionRef: toRepoArtifactRef(state.repoRoot, executionFile),
    skillTraceRef: toRepoArtifactRef(state.repoRoot, skillTraceFile),
  };
}

export function loadPersistedState(stateFile: string): WorkflowStateDocument {
  return JSON.parse(readFileSync(stateFile, "utf8")) as WorkflowStateDocument;
}

export function makePlainState(input: GraceWorkflowInput, currentState: WorkflowStateName): WorkflowGraphState {
  return {
    ...input,
    currentState,
    approvalDecision: null,
    transitionHistory: [],
    artifactHistory: [],
    issueReportRefs: [],
  };
}

export function mergeGraphUpdates(
  ...updates: WorkflowGraphUpdate[]
): WorkflowGraphUpdate {
  let currentState: WorkflowStateName | null | undefined;
  const transitionHistory: string[] = [];
  const artifactHistory: string[] = [];
  const issueReportRefs: string[] = [];

  for (const update of updates) {
    if (update.currentState !== undefined) {
      currentState = update.currentState;
    }
    transitionHistory.push(...(update.transitionHistory ?? []));
    artifactHistory.push(...(update.artifactHistory ?? []));
    issueReportRefs.push(...(update.issueReportRefs ?? []));
  }

  return {
    currentState,
    transitionHistory,
    artifactHistory,
    issueReportRefs,
  };
}

export function applyGraphUpdateToState(
  state: WorkflowGraphState,
  update: WorkflowGraphUpdate,
): WorkflowGraphState {
  return {
    ...state,
    ...update,
    currentState: update.currentState ?? state.currentState,
    approvalDecision: update.approvalDecision ?? state.approvalDecision,
    transitionHistory: update.transitionHistory ?? state.transitionHistory,
    artifactHistory: update.artifactHistory ?? state.artifactHistory,
    issueReportRefs: update.issueReportRefs ?? state.issueReportRefs,
  };
}

export function legacyDryRunReady(dryRunFile: string): boolean {
  return existsSync(dryRunFile);
}
