import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Annotation, Command, END, START, StateGraph, interrupt } from "@langchain/langgraph";
import { MemorySaver } from "@langchain/langgraph-checkpoint";
import { executeRecoveryBridge } from "../autonomy/recovery-bridge.js";
import { runArchitectRole, runCoderRole, runCoordinatorRole } from "../executors/run-agent-role.js";
import { toRepoArtifactRef } from "../runtime/product-target.js";
import { inferLegacyContracts } from "../legacy/infer-contracts.js";
import { scanLegacyRepository } from "../legacy/scan.js";
import { proposeLegacyDryRunEdit, proposeLegacySlice } from "../legacy/slice-propose.js";
import { seedLegacyTraceability } from "../legacy/trace-seed.js";
import { applyTransition } from "../state/transition-engine.js";
import type { WorkflowStateDocument, WorkflowStateName } from "../state/index.js";
import type { WorkflowOwnedArtifactSpec } from "../artifacts/index.js";
import { validateAgentEvidence } from "../validators/agent-evidence.js";
import { validateLivingDocuments } from "../validators/living-doc.js";
import { validateTransitionEvidence } from "../validators/transition-evidence.js";
import type { GraceWorkflowInput } from "./index.js";

/**
 * <!-- MODULE_MAP id="MM-grace-workflow-core" -->
 * <Layers>
 *   <Layer name="application" package="src/graph/workflow.ts">
 *     LangGraph orchestration layer that routes approval interrupts and failure branches through the canonical transition engine.
 *   </Layer>
 * </Layers>
 * <Links>
 *   <Link ref="RequirementsAnalysis.xml#UC-GRACE-STATE-MACHINE" />
 *   <Link ref="RequirementsAnalysis.xml#UC-GRACE-HUMAN-APPROVAL" />
 *   <Link ref="RequirementsAnalysis.xml#UC-GRACE-FAILURE-RECOVERY" />
 *   <Link ref="Technology.xml#DEC-GRACE-LANGGRAPH-001" />
 * </Links>
 * <!-- /MODULE_MAP -->
 */

const MC_GRACE_WORKFLOW_CORE = "MC-grace-workflow-core";
const FC_GRACE_GRAPH_BUILD_WORKFLOW = "FC-grace-graph-buildWorkflow";
const BA_GRACE_ROUTE_MAIN = "BA-grace-route-main";
const BA_GRACE_ROUTE_APPROVAL = "BA-grace-route-approval";
const BA_GRACE_ROUTE_FAILURE = "BA-grace-route-failure";

const WorkflowAnnotation = Annotation.Root({
  repoRoot: Annotation<string>,
  productRoot: Annotation<string>,
  sourceRepoRoot: Annotation<string>,
  productId: Annotation<string>,
  traceId: Annotation<string>,
  stateFile: Annotation<string>,
  transitionLogFile: Annotation<string>,
  policyFile: Annotation<string | undefined>,
  issueReportFile: Annotation<string | undefined>,
  executionDir: Annotation<string>,
  verificationMode: Annotation<"pass" | "fail">,
  handoffRef: Annotation<string>,
  requirementsRef: Annotation<string>,
  technologyRef: Annotation<string>,
  developmentPlanRef: Annotation<string>,
  executionPlanRef: Annotation<string>,
  approvalsRef: Annotation<string>,
  approvalLogFile: Annotation<string>,
  requirementsFile: Annotation<string>,
  technologyFile: Annotation<string>,
  developmentPlanFile: Annotation<string>,
  executionPlanFile: Annotation<string>,
  livingDocReportFile: Annotation<string>,
  livingDocReportRef: Annotation<string>,
  policySchemaReportFile: Annotation<string>,
  policySchemaReportRef: Annotation<string>,
  branchSpecRef: Annotation<string>,
  cwoRef: Annotation<string>,
  failureMemoryFile: Annotation<string>,
  forcedContextFile: Annotation<string>,
  loopGuardFile: Annotation<string>,
  failureScope: Annotation<string>,
  failureTestId: Annotation<string>,
  failureErrorSignature: Annotation<string>,
  retryCount: Annotation<number>,
  retryBudget: Annotation<number>,
  proposedFix: Annotation<string>,
  currentState: Annotation<WorkflowStateName | null>,
  approvalDecision: Annotation<"APPROVE" | "REJECT" | null>,
  transitionHistory: Annotation<string[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  artifactHistory: Annotation<string[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  issueReportRefs: Annotation<string[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
});

function graceRuntimeLog(entry: {
  ba: string;
  belief: string;
  fact: Record<string, unknown>;
}): void {
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      layer: "runtime",
      mc: MC_GRACE_WORKFLOW_CORE,
      fc: FC_GRACE_GRAPH_BUILD_WORKFLOW,
      ...entry,
    }),
  );
}

function transitionUpdate(
  state: typeof WorkflowAnnotation.State,
  actor: Parameters<typeof applyTransition>[0]["actor"],
  transition: Parameters<typeof applyTransition>[0]["transition"],
  artifactRefs: string[],
  workflowOwnedArtifactSpecs: WorkflowOwnedArtifactSpec[] = [],
): Partial<typeof WorkflowAnnotation.State> {
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

function appendRuntimeTransition(
  state: typeof WorkflowAnnotation.State,
  actor: Parameters<typeof applyTransition>[0]["actor"],
  transition: Parameters<typeof applyTransition>[0]["transition"],
  artifactRefs: string[],
  workflowOwnedArtifactSpecs: WorkflowOwnedArtifactSpec[] = [],
): Partial<typeof WorkflowAnnotation.State> {
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

function isLegacyOnboardingState(state: WorkflowStateName | null): boolean {
  return [
    "LEGACY_DISCOVERY_PENDING",
    "LEGACY_SCAN_READY",
    "LEGACY_CONTRACTS_DRAFTED",
    "LEGACY_GRAPH_READY",
    "LEGACY_SLICE_READY",
  ].includes(state ?? "INTAKE_RECEIVED");
}

function buildLegacyRefs(state: typeof WorkflowAnnotation.State) {
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

function buildProcessArtifactSpec(
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

function buildCoderArtifacts(state: typeof WorkflowAnnotation.State): {
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

function buildCoordinatorArtifacts(state: typeof WorkflowAnnotation.State): {
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

function loadPersistedState(stateFile: string): WorkflowStateDocument {
  return JSON.parse(readFileSync(stateFile, "utf8")) as WorkflowStateDocument;
}

function makePlainState(input: GraceWorkflowInput, currentState: WorkflowStateName) {
  return {
    ...input,
    currentState,
    approvalDecision: null as "APPROVE" | "REJECT" | null,
    transitionHistory: [] as string[],
    artifactHistory: [] as string[],
    issueReportRefs: [] as string[],
  };
}

/**
 * <FUNCTION_CONTRACT id="FC-grace-graph-buildWorkflow">
 *   <Intent>Materialize the GRACE LangGraph workflow so approval interrupts and verification failure branches are routed through the canonical state machine.</Intent>
 *   <Inputs>
 *     <Input name="input">Workflow file paths, canonical artifact refs, and a verification mode that selects the success or failure branch.</Input>
 *   </Inputs>
 *   <Outputs>
 *     <Output name="graph">Compiled LangGraph workflow backed by a durable MemorySaver checkpointer.</Output>
 *   </Outputs>
 *   <BlockAnchors>
 *     <BA ref="BA-grace-route-main" />
 *     <BA ref="BA-grace-route-approval" />
 *     <BA ref="BA-grace-route-failure" />
 *   </BlockAnchors>
 *   <Links>
 *     <Link ref="RequirementsAnalysis.xml#UC-GRACE-HUMAN-APPROVAL" />
 *     <Link ref="Technology.xml#DEC-GRACE-LANGGRAPH-001" />
 *   </Links>
 * </FUNCTION_CONTRACT>
 */
export function buildGraceWorkflow() {
  /* <BLOCK_ANCHOR id="BA-grace-route-main" purpose="Route the happy-path workflow through canonical transition, approval, execution, verification, and release states" /> */
  const graph = new StateGraph(WorkflowAnnotation)
    .addNode("route_entry", (state) => ({ currentState: state.currentState }))
    .addNode("classify_intake", (state) => appendRuntimeTransition(state, "COORDINATOR", "classify_intake", []))
    .addNode("legacy_bootstrap", (state) => {
      const refs = buildLegacyRefs(state);
      const coordinator = runCoordinatorRole({
        repoRoot: state.repoRoot,
        productId: state.productId,
        traceId: state.traceId,
        executionSequence: 1,
        allowedStates: ["INTAKE_RECEIVED", "INTAKE_CLASSIFIED"],
        allowedFcIds: ["FC-grace-agents-runCoordinatorRole"],
        allowedBaIds: ["BA-grace-run-coordinator-role"],
        scopedSkillRefs: ["coordinator-work-orders"],
        inputRefs: [refs.legacyWorkspaceRef, refs.sourceRepoMapRef],
        stateFile: state.stateFile,
        executionFile: join(state.executionDir, "CoordinatorExecution-Workflow-0001.xml"),
        skillTraceFile: join(state.executionDir, "CoordinatorSkillTrace-Workflow-0001.json"),
        operation: () => ({
          outputRefs: [refs.legacyWorkspaceRef, refs.sourceRepoMapRef],
          touchedFcIds: ["FC-grace-agents-runCoordinatorRole"],
          touchedBaIds: ["BA-grace-run-coordinator-role"],
          notes: ["Coordinator role validated legacy overlay metadata before onboarding."],
        }),
      });
      if (!coordinator.ok) {
        throw new Error(`legacy bootstrap coordinator role failed: ${coordinator.violations.map((item) => item.code).join(",")}`);
      }
      return appendRuntimeTransition(state, "COORDINATOR", "bootstrap_legacy_overlay", [
        refs.legacyWorkspaceRef,
        refs.sourceRepoMapRef,
      ]);
    })
    .addNode("legacy_scan", (state) => {
      const refs = buildLegacyRefs(state);
      const coordinator = runCoordinatorRole({
        repoRoot: state.repoRoot,
        productId: state.productId,
        traceId: state.traceId,
        executionSequence: 2,
        allowedStates: ["LEGACY_DISCOVERY_PENDING"],
        allowedFcIds: ["FC-grace-agents-runCoordinatorRole"],
        allowedBaIds: ["BA-grace-run-coordinator-role"],
        inputRefs: [refs.legacyWorkspaceRef, refs.sourceRepoMapRef],
        stateFile: state.stateFile,
        executionFile: join(state.executionDir, "CoordinatorExecution-Workflow-0002.xml"),
        skillTraceFile: join(state.executionDir, "CoordinatorSkillTrace-Workflow-0002.json"),
        operation: () => {
          scanLegacyRepository({
            target: {
              repoRoot: state.repoRoot,
              productRoot: state.productRoot,
              productId: state.productId,
              traceId: state.traceId,
              mode: "legacy-overlay",
              sourceRepoRoot: state.sourceRepoRoot,
            },
            reportFile: refs.scanReportFile,
            riskReportFile: refs.riskReportFile,
          });
          return {
            outputRefs: [refs.scanReportRef, refs.riskReportRef],
            touchedFcIds: ["FC-grace-agents-runCoordinatorRole"],
            touchedBaIds: ["BA-grace-run-coordinator-role"],
            notes: ["Coordinator role materialized legacy scan and risk reports."],
          };
        },
      });
      if (!coordinator.ok) {
        throw new Error(`legacy scan coordinator role failed: ${coordinator.violations.map((item) => item.code).join(",")}`);
      }
      return appendRuntimeTransition(state, "COORDINATOR", "scan_legacy_repo", [
        refs.scanReportRef,
        refs.riskReportRef,
      ]);
    })
    .addNode("legacy_contracts", (state) => {
      const refs = buildLegacyRefs(state);
      const architect = runArchitectRole({
        repoRoot: state.repoRoot,
        productId: state.productId,
        traceId: state.traceId,
        executionSequence: 1,
        allowedStates: ["LEGACY_SCAN_READY"],
        allowedFcIds: ["FC-grace-agents-runArchitectRole"],
        allowedBaIds: ["BA-grace-run-architect-role"],
        inputRefs: [refs.scanReportRef, refs.riskReportRef],
        stateFile: state.stateFile,
        executionFile: join(state.executionDir, "ArchitectExecution-Workflow-0001.xml"),
        skillTraceFile: join(state.executionDir, "ArchitectSkillTrace-Workflow-0001.json"),
        operation: () => {
          inferLegacyContracts({
            target: {
              repoRoot: state.repoRoot,
              productRoot: state.productRoot,
              productId: state.productId,
              traceId: state.traceId,
              mode: "legacy-overlay",
              sourceRepoRoot: state.sourceRepoRoot,
            },
            scanReportFile: refs.scanReportFile,
            riskReportFile: refs.riskReportFile,
            draftsFile: refs.contractDraftsFile,
          });
          return {
            outputRefs: [refs.contractDraftsRef],
            touchedFcIds: ["FC-grace-agents-runArchitectRole"],
            touchedBaIds: ["BA-grace-run-architect-role"],
            notes: ["Architect role inferred legacy contracts from scan artifacts."],
          };
        },
      });
      if (!architect.ok) {
        throw new Error(`legacy contracts architect role failed: ${architect.violations.map((item) => item.code).join(",")}`);
      }
      return appendRuntimeTransition(state, "ARCHITECT", "infer_legacy_contracts", [refs.contractDraftsRef]);
    })
    .addNode("legacy_trace_seed", (state) => {
      const refs = buildLegacyRefs(state);
      const architect = runArchitectRole({
        repoRoot: state.repoRoot,
        productId: state.productId,
        traceId: state.traceId,
        executionSequence: 2,
        allowedStates: ["LEGACY_CONTRACTS_DRAFTED"],
        allowedFcIds: ["FC-grace-agents-runArchitectRole"],
        allowedBaIds: ["BA-grace-run-architect-role"],
        inputRefs: [refs.contractDraftsRef],
        stateFile: state.stateFile,
        executionFile: join(state.executionDir, "ArchitectExecution-Workflow-0002.xml"),
        skillTraceFile: join(state.executionDir, "ArchitectSkillTrace-Workflow-0002.json"),
        operation: () => {
          seedLegacyTraceability({
            target: {
              repoRoot: state.repoRoot,
              productRoot: state.productRoot,
              productId: state.productId,
              traceId: state.traceId,
              mode: "legacy-overlay",
              sourceRepoRoot: state.sourceRepoRoot,
            },
            draftsFile: refs.contractDraftsFile,
            registryFile: refs.graphRegistryFile,
          });
          return {
            outputRefs: [refs.graphRegistryRef],
            touchedFcIds: ["FC-grace-agents-runArchitectRole"],
            touchedBaIds: ["BA-grace-run-architect-role"],
            notes: ["Architect role seeded legacy graph registry from contract drafts."],
          };
        },
      });
      if (!architect.ok) {
        throw new Error(`legacy trace architect role failed: ${architect.violations.map((item) => item.code).join(",")}`);
      }
      return appendRuntimeTransition(state, "ARCHITECT", "seed_legacy_traceability", [refs.graphRegistryRef]);
    })
    .addNode("legacy_slice_proposal", (state) => {
      const refs = buildLegacyRefs(state);
      const coder = runCoderRole({
        repoRoot: state.repoRoot,
        productId: state.productId,
        traceId: state.traceId,
        executionSequence: 1,
        allowedStates: ["LEGACY_GRAPH_READY"],
        allowedFcIds: ["FC-grace-agents-runCoderRole"],
        allowedBaIds: ["BA-grace-run-coder-role"],
        inputRefs: [refs.graphRegistryRef],
        stateFile: state.stateFile,
        executionFile: join(state.executionDir, "CoderExecution-Workflow-0001.xml"),
        skillTraceFile: join(state.executionDir, "CoderSkillTrace-Workflow-0001.json"),
        operation: () => {
          proposeLegacySlice({
            target: {
              repoRoot: state.repoRoot,
              productRoot: state.productRoot,
              productId: state.productId,
              traceId: state.traceId,
              mode: "legacy-overlay",
              sourceRepoRoot: state.sourceRepoRoot,
            },
            scanReportFile: refs.scanReportFile,
            riskReportFile: refs.riskReportFile,
            draftsFile: refs.contractDraftsFile,
            registryFile: refs.graphRegistryFile,
            planFile: refs.slicePlanFile,
          });
          return {
            outputRefs: [refs.slicePlanRef],
            touchedFcIds: ["FC-grace-agents-runCoderRole"],
            touchedBaIds: ["BA-grace-run-coder-role"],
            notes: ["Coder role proposed bounded first legacy slices without source writes."],
          };
        },
      });
      if (!coder.ok) {
        throw new Error(`legacy slice coder role failed: ${coder.violations.map((item) => item.code).join(",")}`);
      }
      return appendRuntimeTransition(state, "CODER", "propose_legacy_slice", [refs.slicePlanRef]);
    })
    .addNode("legacy_evidence_gate", (state) => {
      const refs = buildLegacyRefs(state);
      const agentEvidence = validateAgentEvidence({
        repoRoot: state.repoRoot,
        productId: state.productId,
        traceId: state.traceId,
        executionDir: state.executionDir,
        requiredRoles: ["ARCHITECT", "COORDINATOR", "CODER"],
      });
      const transitionEvidence = validateTransitionEvidence({
        productId: state.productId,
        traceId: state.traceId,
        stateFile: state.stateFile,
        transitionLogFile: state.transitionLogFile,
        requiredArtifactRefs: [
          refs.legacyWorkspaceRef,
          refs.sourceRepoMapRef,
          refs.scanReportRef,
          refs.riskReportRef,
          refs.contractDraftsRef,
          refs.graphRegistryRef,
          refs.slicePlanRef,
        ],
      });
      if (!agentEvidence.ok || !transitionEvidence.ok) {
        return appendRuntimeTransition(
          state,
          "COORDINATOR",
          "block_workflow",
          [...agentEvidence.artifactRefs, refs.slicePlanRef],
        );
      }
      return {
        currentState: state.currentState,
        transitionHistory: [],
        artifactHistory: [...agentEvidence.artifactRefs, refs.slicePlanRef],
        issueReportRefs: [],
      };
    })
    .addNode("blueprint_flow", (state) => {
      const architect = runArchitectRole({
        repoRoot: state.repoRoot,
        productId: state.productId,
        traceId: state.traceId,
        executionSequence: 1,
        allowedStates: ["INTAKE_CLASSIFIED"],
        allowedFcIds: ["FC-grace-agents-runArchitectRole"],
        allowedBaIds: ["BA-grace-run-architect-role"],
        inputRefs: [state.requirementsRef, state.technologyRef, state.developmentPlanRef, state.executionPlanRef],
        stateFile: state.stateFile,
        executionFile: join(state.executionDir, "ArchitectExecution-Workflow-0001.xml"),
        skillTraceFile: join(state.executionDir, "ArchitectSkillTrace-Workflow-0001.json"),
        operation: () => ({
          outputRefs: [state.requirementsRef, state.technologyRef, state.developmentPlanRef, state.executionPlanRef],
          touchedFcIds: ["FC-grace-agents-runArchitectRole"],
          touchedBaIds: ["BA-grace-run-architect-role"],
          notes: ["Architect role materialized the blueprint stage inside LangGraph."],
        }),
      });
      if (!architect.ok) {
        throw new Error(`architect role execution failed: ${architect.violations.map((item) => item.code).join(",")}`);
      }
      const start = appendRuntimeTransition(state, "ARCHITECT", "start_blueprint", [
        state.requirementsRef,
        state.technologyRef,
      ]);
      const review = transitionUpdate({ ...state, ...start }, "ARCHITECT", "submit_blueprint_for_review", [
        state.developmentPlanRef,
        state.executionPlanRef,
      ]);
      const approve = transitionUpdate({ ...state, ...start, ...review }, "COORDINATOR", "approve_blueprint", [
        state.developmentPlanRef,
      ]);
      return {
        ...start,
        transitionHistory: [...(start.transitionHistory ?? []), ...(review.transitionHistory ?? []), ...(approve.transitionHistory ?? [])],
        artifactHistory: [...(start.artifactHistory ?? []), ...(review.artifactHistory ?? []), ...(approve.artifactHistory ?? [])],
        currentState: approve.currentState,
      };
    })
    .addNode("handoff_flow", (state) => {
      const start = transitionUpdate(
        state,
        "COORDINATOR",
        "start_handoff",
        [state.handoffRef],
        [
          buildProcessArtifactSpec(
            state.repoRoot,
            "handoff",
            state.handoffRef,
            "start_handoff",
            "Workflow bootstrap handoff",
          ),
        ],
      );
      const propose = transitionUpdate({ ...state, ...start }, "COORDINATOR", "propose_handoff", [state.handoffRef]);
      const request = transitionUpdate({ ...state, ...start, ...propose }, "COORDINATOR", "request_handoff_approval", [state.handoffRef]);
      return {
        currentState: request.currentState,
        transitionHistory: [...(start.transitionHistory ?? []), ...(propose.transitionHistory ?? []), ...(request.transitionHistory ?? [])],
        artifactHistory: [...(start.artifactHistory ?? []), ...(propose.artifactHistory ?? []), ...(request.artifactHistory ?? [])],
      };
    })
    .addNode("await_human_approval", (state) => {
      /* <BLOCK_ANCHOR id="BA-grace-route-approval" purpose="Pause the workflow at the handoff approval boundary and resume only with an explicit human decision" /> */
      graceRuntimeLog({
        ba: BA_GRACE_ROUTE_APPROVAL,
        belief: "Approval routing must interrupt the workflow and resume only when a human decision is provided",
        fact: {
          currentState: state.currentState,
          handoffRef: state.handoffRef,
        },
      });
      const decision = interrupt<{ handoffRef: string; traceId: string }, { approved: boolean }>({
        handoffRef: state.handoffRef,
        traceId: state.traceId,
      });
      return {
        approvalDecision: decision.approved ? "APPROVE" : "REJECT",
      };
    })
    .addNode("resolve_approval", (state) => {
      if (state.approvalDecision === "APPROVE") {
        return appendRuntimeTransition(state, "HUMAN", "approve_handoff", [state.handoffRef]);
      }
      return appendRuntimeTransition(state, "HUMAN", "reject_handoff", [state.handoffRef]);
    })
    .addNode("authorize_work", (state) => {
      const coordinatorArtifacts = buildCoordinatorArtifacts(state);
      const coordinator = runCoordinatorRole({
        repoRoot: state.repoRoot,
        productId: state.productId,
        traceId: state.traceId,
        executionSequence: 1,
        allowedStates: ["HANDOFF_APPROVED"],
        allowedFcIds: ["FC-grace-agents-runCoordinatorRole"],
        allowedBaIds: ["BA-grace-run-coordinator-role"],
        scopedSkillRefs: ["coordinator-work-orders", "coordinator-branchspec-gitflow"],
        inputRefs: [state.handoffRef],
        stateFile: state.stateFile,
        executionFile: coordinatorArtifacts.executionFile,
        skillTraceFile: coordinatorArtifacts.skillTraceFile,
        operation: () => ({
          outputRefs: [
            state.branchSpecRef,
            state.cwoRef,
            coordinatorArtifacts.executionRef,
            coordinatorArtifacts.skillTraceRef,
          ],
          touchedFcIds: ["FC-grace-agents-runCoordinatorRole"],
          touchedBaIds: ["BA-grace-run-coordinator-role"],
          notes: ["Coordinator role issued branch and work authorization inside LangGraph."],
        }),
      });
      if (!coordinator.ok) {
        throw new Error(`coordinator role execution failed: ${coordinator.violations.map((item) => item.code).join(",")}`);
      }
      const draft = transitionUpdate(state, "COORDINATOR", "draft_cwo", [state.handoffRef]);
      const branch = transitionUpdate(
        { ...state, ...draft },
        "COORDINATOR",
        "issue_branchspec",
        [state.branchSpecRef],
        [
          buildProcessArtifactSpec(
            state.repoRoot,
            "branchspec",
            state.branchSpecRef,
            "issue_branchspec",
            "Workflow bootstrap branch specification",
          ),
        ],
      );
      const issued = transitionUpdate({ ...state, ...draft, ...branch }, "COORDINATOR", "issue_cwo", [
        state.approvalsRef,
        state.cwoRef,
      ], [
        buildProcessArtifactSpec(
          state.repoRoot,
          "cwo",
          state.cwoRef,
          "issue_cwo",
          "Workflow bootstrap coder work order",
          { handoffRef: state.handoffRef },
        ),
      ]);
      return {
        currentState: issued.currentState,
        transitionHistory: [...(draft.transitionHistory ?? []), ...(branch.transitionHistory ?? []), ...(issued.transitionHistory ?? [])],
        artifactHistory: [...(draft.artifactHistory ?? []), ...(branch.artifactHistory ?? []), ...(issued.artifactHistory ?? [])],
        issueReportRefs: [...(issued.issueReportRefs ?? [])],
      };
    })
    .addNode("coder_flow", (state) => {
      const activate = transitionUpdate(state, "COORDINATOR", "activate_coder", [state.cwoRef]);
      const activatedState = { ...state, ...activate, currentState: activate.currentState ?? state.currentState };
      const coderArtifacts = buildCoderArtifacts(activatedState);
      const bounded = runCoderRole({
        repoRoot: state.repoRoot,
        productId: state.productId,
        traceId: state.traceId,
        executionSequence: 1,
        allowedStates: ["CODER_ACTIVE"],
        allowedFcIds: ["FC-grace-agents-runCoderRole"],
        allowedBaIds: ["BA-grace-run-coder-role"],
        inputRefs: [state.cwoRef],
        stateFile: state.stateFile,
        executionFile: coderArtifacts.executionFile,
        skillTraceFile: coderArtifacts.skillTraceFile,
        operation: () => ({
          outputRefs: [coderArtifacts.executionRef, coderArtifacts.skillTraceRef],
          touchedFcIds: ["FC-grace-agents-runCoderRole"],
          touchedBaIds: ["BA-grace-run-coder-role"],
          notes: ["Coder role executed inside the compiled LangGraph workflow."],
        }),
      });
      if (!bounded.ok) {
        throw new Error(`bounded coder execution failed: ${bounded.violations.map((item) => item.code).join(",")}`);
      }
      const submit = transitionUpdate(activatedState, "CODER", "submit_coder_output", [
        coderArtifacts.executionRef,
        coderArtifacts.skillTraceRef,
      ]);
      return {
        currentState: submit.currentState,
        transitionHistory: [...(activate.transitionHistory ?? []), ...(submit.transitionHistory ?? [])],
        artifactHistory: [...(activate.artifactHistory ?? []), ...(submit.artifactHistory ?? [])],
      };
    })
    .addNode("verification_flow", (state) => {
      const start = transitionUpdate(state, "COORDINATOR", "start_verification", []);
      if (state.verificationMode === "fail") {
        /* <BLOCK_ANCHOR id="BA-grace-route-failure" purpose="Route verification failure into the governed failure branch instead of allowing silent retries" /> */
        graceRuntimeLog({
          ba: BA_GRACE_ROUTE_FAILURE,
          belief: "Verification failures must branch into governed failure states instead of continuing silently",
          fact: {
            currentState: start.currentState,
            verificationMode: state.verificationMode,
          },
        });
        const fail = transitionUpdate({ ...state, ...start }, "COORDINATOR", "record_verification_fail", []);
        const capture = transitionUpdate({ ...state, ...start, ...fail }, "COORDINATOR", "capture_failure", []);
        const reportsDir = dirname(state.stateFile);
        const recovery = executeRecoveryBridge({
          productId: state.productId,
          traceId: state.traceId,
          stateFile: state.stateFile,
          transitionLogFile: state.transitionLogFile,
          policyFile: state.policyFile,
          issueReportFile: state.issueReportFile,
          failureMemoryFile: state.failureMemoryFile ?? join(reportsDir, "failure-memory.json"),
          forcedContextFile: state.forcedContextFile ?? join(reportsDir, "forced-context.json"),
          loopGuardFile: state.loopGuardFile ?? join(reportsDir, "loop-guard.json"),
          scope: state.failureScope ?? "FC-grace-graph-buildWorkflow",
          testId: state.failureTestId ?? "TC-GRACE-FAIL-01",
          errorSignature: state.failureErrorSignature ?? "verification failed",
          retryCount: state.retryCount ?? 1,
          retryBudget: state.retryBudget ?? 2,
          proposedFix: state.proposedFix,
          evidenceRefs: [state.policySchemaReportRef],
        });
        return {
          currentState: recovery.currentState,
          transitionHistory: [...(start.transitionHistory ?? []), ...(fail.transitionHistory ?? []), ...(capture.transitionHistory ?? []), ...recovery.transitionHistory],
          artifactHistory: [...(start.artifactHistory ?? []), ...(fail.artifactHistory ?? []), ...(capture.artifactHistory ?? []), ...recovery.artifactRefs],
          issueReportRefs: [...(fail.issueReportRefs ?? []), ...(capture.issueReportRefs ?? [])],
        };
      }
      const pass = transitionUpdate({ ...state, ...start }, "COORDINATOR", "record_verification_pass", []);
      return {
        currentState: pass.currentState,
        transitionHistory: [...(start.transitionHistory ?? []), ...(pass.transitionHistory ?? [])],
        artifactHistory: [...(start.artifactHistory ?? []), ...(pass.artifactHistory ?? [])],
      };
    })
    .addNode("living_doc_gate", (state) => {
      const validation = validateLivingDocuments({
        productId: state.productId,
        traceId: state.traceId,
        stateFile: state.stateFile,
        requirementsFile: state.requirementsFile,
        technologyFile: state.technologyFile,
        developmentPlanFile: state.developmentPlanFile,
        executionPlanFile: state.executionPlanFile,
        reportFile: state.livingDocReportFile,
        reportRef: state.livingDocReportRef,
      });
      if (!validation.ok) {
        const fail = transitionUpdate(state, "COORDINATOR", "record_living_doc_fail", [validation.artifactRef ?? state.livingDocReportRef]);
        const capture = transitionUpdate({ ...state, ...fail }, "COORDINATOR", "capture_failure", [validation.artifactRef ?? state.livingDocReportRef]);
        return {
          currentState: capture.currentState,
          transitionHistory: [...(fail.transitionHistory ?? []), ...(capture.transitionHistory ?? [])],
          artifactHistory: [...(fail.artifactHistory ?? []), ...(capture.artifactHistory ?? [])],
          issueReportRefs: [...(fail.issueReportRefs ?? []), ...(capture.issueReportRefs ?? [])],
        };
      }
      return {
        currentState: state.currentState,
        transitionHistory: [],
        artifactHistory: validation.artifactRef ? [validation.artifactRef] : [],
        issueReportRefs: [],
      };
    })
    .addNode("traceability_gate", (state) => {
      const agentEvidence = validateAgentEvidence({
        repoRoot: state.repoRoot,
        productId: state.productId,
        traceId: state.traceId,
        executionDir: state.executionDir,
        requiredRoles: ["ARCHITECT", "COORDINATOR", "CODER"],
      });
      if (!agentEvidence.ok) {
        const fail = transitionUpdate(state, "COORDINATOR", "record_traceability_fail", agentEvidence.artifactRefs);
        const capture = transitionUpdate({ ...state, ...fail }, "COORDINATOR", "capture_failure", agentEvidence.artifactRefs);
        return {
          currentState: capture.currentState,
          transitionHistory: [...(fail.transitionHistory ?? []), ...(capture.transitionHistory ?? [])],
          artifactHistory: [...agentEvidence.artifactRefs, ...(fail.artifactHistory ?? []), ...(capture.artifactHistory ?? [])],
          issueReportRefs: [...(fail.issueReportRefs ?? []), ...(capture.issueReportRefs ?? [])],
        };
      }
      const validation = validateTransitionEvidence({
        productId: state.productId,
        traceId: state.traceId,
        stateFile: state.stateFile,
        transitionLogFile: state.transitionLogFile,
        approvalArtifactRef: state.approvalsRef,
        requiredArtifactRefs: [state.handoffRef, state.cwoRef],
      });
      if (!validation.ok) {
        const fail = transitionUpdate(state, "COORDINATOR", "record_traceability_fail", []);
        const capture = transitionUpdate({ ...state, ...fail }, "COORDINATOR", "capture_failure", []);
        return {
          currentState: capture.currentState,
          transitionHistory: [...(fail.transitionHistory ?? []), ...(capture.transitionHistory ?? [])],
          artifactHistory: [...(fail.artifactHistory ?? []), ...(capture.artifactHistory ?? [])],
          issueReportRefs: [...(fail.issueReportRefs ?? []), ...(capture.issueReportRefs ?? [])],
        };
      }
      return appendRuntimeTransition(state, "COORDINATOR", "record_traceability_pass", []);
    })
    .addNode("release_ready", (state) => appendRuntimeTransition(state, "COORDINATOR", "mark_ready_for_release", []))
    .addEdge(START, "route_entry")
    .addConditionalEdges("route_entry", (state) =>
      state.sourceRepoRoot !== state.productRoot ? "legacy_bootstrap" : "classify_intake",
    )
    .addEdge("legacy_bootstrap", "legacy_scan")
    .addEdge("legacy_scan", "legacy_contracts")
    .addEdge("legacy_contracts", "legacy_trace_seed")
    .addEdge("legacy_trace_seed", "legacy_slice_proposal")
    .addEdge("legacy_slice_proposal", "legacy_evidence_gate")
    .addConditionalEdges("legacy_evidence_gate", (state) =>
      state.currentState === "LEGACY_SLICE_READY" ? END : END,
    )
    .addEdge("classify_intake", "blueprint_flow")
    .addEdge("blueprint_flow", "handoff_flow")
    .addEdge("handoff_flow", "await_human_approval")
    .addEdge("await_human_approval", "resolve_approval")
    .addConditionalEdges("resolve_approval", (state) =>
      state.currentState === "HANDOFF_APPROVED" ? "authorize_work" : END,
    )
    .addEdge("authorize_work", "coder_flow")
    .addEdge("coder_flow", "verification_flow")
    .addConditionalEdges("verification_flow", (state) =>
      state.currentState === "VERIFICATION_PASSED" ? "living_doc_gate" : END,
    )
    .addConditionalEdges("living_doc_gate", (state) =>
      state.currentState === "VERIFICATION_PASSED" ? "traceability_gate" : END,
    )
    .addConditionalEdges("traceability_gate", (state) =>
      state.currentState === "TRACEABILITY_PASSED" ? "release_ready" : END,
    )
    .addEdge("release_ready", END);

  return graph.compile({ checkpointer: new MemorySaver() });
}

export async function invokeGraceWorkflow(
  graphInput: GraceWorkflowInput,
  options: { threadId: string; resume?: { approved: boolean } } ,
) {
  const graph = buildGraceWorkflow();
  if (options.resume !== undefined) {
    return graph.invoke(new Command({ resume: options.resume }), {
      configurable: {
        thread_id: options.threadId,
      },
    });
  }
  return graph.invoke({
    ...graphInput,
    currentState: null,
    approvalDecision: null,
    transitionHistory: [],
    artifactHistory: [],
    issueReportRefs: [],
  }, {
    configurable: {
      thread_id: options.threadId,
    },
  });
}

export function resumeGraceWorkflow(
  graphInput: GraceWorkflowInput,
  options: { approvalDecision: "approve" | "reject" },
) {
  const persisted = loadPersistedState(graphInput.stateFile);
  const state = makePlainState(graphInput, persisted.currentState);

  if (persisted.currentState !== "HANDOFF_APPROVAL_PENDING") {
    return {
      currentState: persisted.currentState,
      transitionHistory: [],
      artifactHistory: [],
      issueReportRefs: [],
    };
  }

  if (options.approvalDecision === "reject") {
    return appendRuntimeTransition(state, "HUMAN", "reject_handoff", [graphInput.handoffRef]);
  }

  const approve = appendRuntimeTransition(state, "HUMAN", "approve_handoff", [graphInput.handoffRef]);
  const approvedState = { ...state, ...approve, currentState: approve.currentState ?? state.currentState };

  const coordinatorArtifacts = buildCoordinatorArtifacts(approvedState);
  const coordinator = runCoordinatorRole({
    repoRoot: graphInput.repoRoot,
    productId: graphInput.productId,
    traceId: graphInput.traceId,
    executionSequence: 1,
    allowedStates: ["HANDOFF_APPROVED"],
    allowedFcIds: ["FC-grace-agents-runCoordinatorRole"],
    allowedBaIds: ["BA-grace-run-coordinator-role"],
    scopedSkillRefs: ["coordinator-work-orders", "coordinator-branchspec-gitflow"],
    inputRefs: [graphInput.handoffRef],
    stateFile: graphInput.stateFile,
    executionFile: coordinatorArtifacts.executionFile,
    skillTraceFile: coordinatorArtifacts.skillTraceFile,
    operation: () => ({
      outputRefs: [
        graphInput.branchSpecRef,
        graphInput.cwoRef,
        coordinatorArtifacts.executionRef,
        coordinatorArtifacts.skillTraceRef,
      ],
      touchedFcIds: ["FC-grace-agents-runCoordinatorRole"],
      touchedBaIds: ["BA-grace-run-coordinator-role"],
      notes: ["Coordinator role executed inside CLI resume path."],
    }),
  });
  if (!coordinator.ok) {
    throw new Error(`coordinator role execution failed: ${coordinator.violations.map((item) => item.code).join(",")}`);
  }

  const draft = transitionUpdate(approvedState, "COORDINATOR", "draft_cwo", [graphInput.handoffRef]);
  const branch = transitionUpdate(
    { ...approvedState, ...draft },
    "COORDINATOR",
    "issue_branchspec",
    [graphInput.branchSpecRef],
    [
      buildProcessArtifactSpec(
        graphInput.repoRoot,
        "branchspec",
        graphInput.branchSpecRef,
        "issue_branchspec",
        "Workflow bootstrap branch specification",
      ),
    ],
  );
  const issued = transitionUpdate({ ...approvedState, ...draft, ...branch }, "COORDINATOR", "issue_cwo", [
    graphInput.approvalsRef,
    graphInput.cwoRef,
  ], [
    buildProcessArtifactSpec(
      graphInput.repoRoot,
      "cwo",
      graphInput.cwoRef,
      "issue_cwo",
      "Workflow bootstrap coder work order",
      { handoffRef: graphInput.handoffRef },
    ),
  ]);

  const authorizeState = { ...approvedState, ...issued, currentState: issued.currentState ?? approvedState.currentState };
  const activate = transitionUpdate(authorizeState, "COORDINATOR", "activate_coder", [graphInput.cwoRef]);
  const activatedState = { ...authorizeState, ...activate, currentState: activate.currentState ?? authorizeState.currentState };
  const coderArtifacts = buildCoderArtifacts(activatedState);
  const bounded = runCoderRole({
    repoRoot: graphInput.repoRoot,
    productId: graphInput.productId,
    traceId: graphInput.traceId,
    executionSequence: 1,
    allowedStates: ["CODER_ACTIVE"],
    allowedFcIds: ["FC-grace-agents-runCoderRole"],
    allowedBaIds: ["BA-grace-run-coder-role"],
    inputRefs: [graphInput.cwoRef],
    stateFile: graphInput.stateFile,
    executionFile: coderArtifacts.executionFile,
    skillTraceFile: coderArtifacts.skillTraceFile,
    operation: () => ({
      outputRefs: [coderArtifacts.executionRef, coderArtifacts.skillTraceRef],
      touchedFcIds: ["FC-grace-agents-runCoderRole"],
      touchedBaIds: ["BA-grace-run-coder-role"],
      notes: ["Coder role executed inside CLI resume path."],
    }),
  });
  if (!bounded.ok) {
    throw new Error(`bounded coder execution failed: ${bounded.violations.map((item) => item.code).join(",")}`);
  }
  const submit = transitionUpdate(activatedState, "CODER", "submit_coder_output", [
    coderArtifacts.executionRef,
    coderArtifacts.skillTraceRef,
  ]);
  const submittedState = { ...activatedState, ...submit, currentState: submit.currentState ?? activatedState.currentState };
  const startVerification = transitionUpdate(submittedState, "COORDINATOR", "start_verification", []);

  if (graphInput.verificationMode === "fail") {
    const failureState = { ...submittedState, ...startVerification, currentState: startVerification.currentState ?? submittedState.currentState };
    const fail = transitionUpdate(failureState, "COORDINATOR", "record_verification_fail", []);
    const capture = transitionUpdate({ ...failureState, ...fail }, "COORDINATOR", "capture_failure", []);
    const recovery = executeRecoveryBridge({
      productId: graphInput.productId,
      traceId: graphInput.traceId,
      stateFile: graphInput.stateFile,
      transitionLogFile: graphInput.transitionLogFile,
      policyFile: graphInput.policyFile,
      issueReportFile: graphInput.issueReportFile,
      failureMemoryFile: graphInput.failureMemoryFile,
      forcedContextFile: graphInput.forcedContextFile,
      loopGuardFile: graphInput.loopGuardFile,
      scope: graphInput.failureScope,
      testId: graphInput.failureTestId,
      errorSignature: graphInput.failureErrorSignature,
      retryCount: graphInput.retryCount,
      retryBudget: graphInput.retryBudget,
      proposedFix: graphInput.proposedFix,
      evidenceRefs: [graphInput.policySchemaReportRef],
    });
    return {
      currentState: recovery.currentState,
      transitionHistory: [
        ...(approve.transitionHistory ?? []),
        ...(draft.transitionHistory ?? []),
        ...(branch.transitionHistory ?? []),
        ...(issued.transitionHistory ?? []),
        ...(activate.transitionHistory ?? []),
        ...(submit.transitionHistory ?? []),
        ...(startVerification.transitionHistory ?? []),
        ...(fail.transitionHistory ?? []),
        ...(capture.transitionHistory ?? []),
        ...recovery.transitionHistory,
      ],
      artifactHistory: [
        ...(approve.artifactHistory ?? []),
        ...(draft.artifactHistory ?? []),
        ...(branch.artifactHistory ?? []),
        ...(issued.artifactHistory ?? []),
        ...(activate.artifactHistory ?? []),
        ...(submit.artifactHistory ?? []),
        ...(startVerification.artifactHistory ?? []),
        ...(fail.artifactHistory ?? []),
        ...(capture.artifactHistory ?? []),
        ...recovery.artifactRefs,
      ],
      issueReportRefs: [
        ...(approve.issueReportRefs ?? []),
        ...(issued.issueReportRefs ?? []),
        ...(fail.issueReportRefs ?? []),
        ...(capture.issueReportRefs ?? []),
      ],
    };
  }

  const pass = transitionUpdate({ ...submittedState, ...startVerification }, "COORDINATOR", "record_verification_pass", []);
  const livingDocValidation = validateLivingDocuments({
    productId: graphInput.productId,
    traceId: graphInput.traceId,
    stateFile: graphInput.stateFile,
    requirementsFile: graphInput.requirementsFile,
    technologyFile: graphInput.technologyFile,
    developmentPlanFile: graphInput.developmentPlanFile,
    executionPlanFile: graphInput.executionPlanFile,
    reportFile: graphInput.livingDocReportFile,
    reportRef: graphInput.livingDocReportRef,
  });
  if (!livingDocValidation.ok) {
    const fail = transitionUpdate({ ...submittedState, ...startVerification, ...pass }, "COORDINATOR", "record_living_doc_fail", [
      livingDocValidation.artifactRef ?? graphInput.livingDocReportRef,
    ]);
    const capture = transitionUpdate({ ...submittedState, ...startVerification, ...pass, ...fail }, "COORDINATOR", "capture_failure", [
      livingDocValidation.artifactRef ?? graphInput.livingDocReportRef,
    ]);
    return {
      currentState: capture.currentState,
      transitionHistory: [
        ...(approve.transitionHistory ?? []),
        ...(draft.transitionHistory ?? []),
        ...(branch.transitionHistory ?? []),
        ...(issued.transitionHistory ?? []),
        ...(activate.transitionHistory ?? []),
        ...(submit.transitionHistory ?? []),
        ...(startVerification.transitionHistory ?? []),
        ...(pass.transitionHistory ?? []),
        ...(fail.transitionHistory ?? []),
        ...(capture.transitionHistory ?? []),
      ],
      artifactHistory: [
        ...(approve.artifactHistory ?? []),
        ...(draft.artifactHistory ?? []),
        ...(branch.artifactHistory ?? []),
        ...(issued.artifactHistory ?? []),
        ...(activate.artifactHistory ?? []),
        ...(submit.artifactHistory ?? []),
        ...(startVerification.artifactHistory ?? []),
        ...(pass.artifactHistory ?? []),
        ...(fail.artifactHistory ?? []),
        ...(capture.artifactHistory ?? []),
      ],
      issueReportRefs: [...(fail.issueReportRefs ?? []), ...(capture.issueReportRefs ?? [])],
    };
  }
  const validation = validateTransitionEvidence({
    productId: graphInput.productId,
    traceId: graphInput.traceId,
    stateFile: graphInput.stateFile,
    transitionLogFile: graphInput.transitionLogFile,
    approvalArtifactRef: graphInput.approvalsRef,
    requiredArtifactRefs: [graphInput.handoffRef, graphInput.cwoRef],
  });
  if (!validation.ok) {
    const fail = transitionUpdate({ ...submittedState, ...startVerification, ...pass }, "COORDINATOR", "record_traceability_fail", []);
    const capture = transitionUpdate({ ...submittedState, ...startVerification, ...pass, ...fail }, "COORDINATOR", "capture_failure", []);
    return {
      currentState: capture.currentState,
      transitionHistory: [
        ...(approve.transitionHistory ?? []),
        ...(draft.transitionHistory ?? []),
        ...(branch.transitionHistory ?? []),
        ...(issued.transitionHistory ?? []),
        ...(activate.transitionHistory ?? []),
        ...(submit.transitionHistory ?? []),
        ...(startVerification.transitionHistory ?? []),
        ...(pass.transitionHistory ?? []),
        ...(fail.transitionHistory ?? []),
        ...(capture.transitionHistory ?? []),
      ],
      artifactHistory: [
        ...(approve.artifactHistory ?? []),
        ...(draft.artifactHistory ?? []),
        ...(branch.artifactHistory ?? []),
        ...(issued.artifactHistory ?? []),
        ...(activate.artifactHistory ?? []),
        ...(submit.artifactHistory ?? []),
        ...(startVerification.artifactHistory ?? []),
        ...(pass.artifactHistory ?? []),
        ...(fail.artifactHistory ?? []),
        ...(capture.artifactHistory ?? []),
      ],
      issueReportRefs: [...(fail.issueReportRefs ?? []), ...(capture.issueReportRefs ?? [])],
    };
  }

  const agentEvidence = validateAgentEvidence({
    repoRoot: graphInput.repoRoot,
    productId: graphInput.productId,
    traceId: graphInput.traceId,
    executionDir: graphInput.executionDir,
    requiredRoles: ["ARCHITECT", "COORDINATOR", "CODER"],
  });
  if (!agentEvidence.ok) {
    const fail = transitionUpdate({ ...submittedState, ...startVerification, ...pass }, "COORDINATOR", "record_traceability_fail", agentEvidence.artifactRefs);
    const capture = transitionUpdate({ ...submittedState, ...startVerification, ...pass, ...fail }, "COORDINATOR", "capture_failure", agentEvidence.artifactRefs);
    return {
      currentState: capture.currentState,
      transitionHistory: [
        ...(approve.transitionHistory ?? []),
        ...(draft.transitionHistory ?? []),
        ...(branch.transitionHistory ?? []),
        ...(issued.transitionHistory ?? []),
        ...(activate.transitionHistory ?? []),
        ...(submit.transitionHistory ?? []),
        ...(startVerification.transitionHistory ?? []),
        ...(pass.transitionHistory ?? []),
        ...(fail.transitionHistory ?? []),
        ...(capture.transitionHistory ?? []),
      ],
      artifactHistory: [
        ...(approve.artifactHistory ?? []),
        ...(draft.artifactHistory ?? []),
        ...(branch.artifactHistory ?? []),
        ...(issued.artifactHistory ?? []),
        ...(activate.artifactHistory ?? []),
        ...(submit.artifactHistory ?? []),
        ...(startVerification.artifactHistory ?? []),
        ...(pass.artifactHistory ?? []),
        ...agentEvidence.artifactRefs,
        ...(fail.artifactHistory ?? []),
        ...(capture.artifactHistory ?? []),
      ],
      issueReportRefs: [...(fail.issueReportRefs ?? []), ...(capture.issueReportRefs ?? [])],
    };
  }

  const tracePass = transitionUpdate({ ...submittedState, ...startVerification, ...pass }, "COORDINATOR", "record_traceability_pass", []);
  const release = transitionUpdate({ ...submittedState, ...startVerification, ...pass, ...tracePass }, "COORDINATOR", "mark_ready_for_release", []);
  return {
    currentState: release.currentState,
    transitionHistory: [
      ...(approve.transitionHistory ?? []),
      ...(draft.transitionHistory ?? []),
      ...(branch.transitionHistory ?? []),
      ...(issued.transitionHistory ?? []),
      ...(activate.transitionHistory ?? []),
      ...(submit.transitionHistory ?? []),
      ...(startVerification.transitionHistory ?? []),
      ...(pass.transitionHistory ?? []),
      ...(tracePass.transitionHistory ?? []),
      ...(release.transitionHistory ?? []),
    ],
    artifactHistory: [
      ...(approve.artifactHistory ?? []),
      ...(draft.artifactHistory ?? []),
      ...(branch.artifactHistory ?? []),
      ...(issued.artifactHistory ?? []),
      ...(activate.artifactHistory ?? []),
      ...(submit.artifactHistory ?? []),
      ...(startVerification.artifactHistory ?? []),
      ...(pass.artifactHistory ?? []),
      ...(livingDocValidation.artifactRef ? [livingDocValidation.artifactRef] : []),
      ...(tracePass.artifactHistory ?? []),
      ...(release.artifactHistory ?? []),
    ],
    issueReportRefs: [...(approve.issueReportRefs ?? []), ...(issued.issueReportRefs ?? [])],
  };
}
