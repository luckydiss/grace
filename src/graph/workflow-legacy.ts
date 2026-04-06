import { join } from "node:path";
import { runArchitectRole, runCoderRole, runCoordinatorRole } from "../executors/run-agent-role.js";
import { inferLegacyContracts } from "../legacy/infer-contracts.js";
import { scanLegacyRepository } from "../legacy/scan.js";
import { proposeLegacyDryRunEdit, proposeLegacySlice } from "../legacy/slice-propose.js";
import { seedLegacyTraceability } from "../legacy/trace-seed.js";
import { validateAgentEvidence } from "../validators/agent-evidence.js";
import { validateTransitionEvidence } from "../validators/transition-evidence.js";
import {
  appendRuntimeTransition,
  buildLegacyRefs,
  legacyDryRunReady,
  type WorkflowGraphState,
} from "./workflow-runtime.js";

export function registerLegacyWorkflow(graph: any) {
  return graph
    .addNode("legacy_bootstrap", (state: WorkflowGraphState) => {
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
    .addNode("legacy_scan", (state: WorkflowGraphState) => {
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
      return appendRuntimeTransition(state, "COORDINATOR", "scan_legacy_repo", [refs.scanReportRef, refs.riskReportRef]);
    })
    .addNode("legacy_contracts", (state: WorkflowGraphState) => {
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
    .addNode("legacy_trace_seed", (state: WorkflowGraphState) => {
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
    .addNode("legacy_slice_proposal", (state: WorkflowGraphState) => {
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
    .addNode("legacy_dry_run", (state: WorkflowGraphState) => {
      const refs = buildLegacyRefs(state);
      const plan = proposeLegacySlice({
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
      const candidate = plan.plan.candidates[0];
      if (!candidate) {
        throw new Error("legacy dry-run requires at least one proposed legacy slice candidate");
      }
      proposeLegacyDryRunEdit({
        target: {
          repoRoot: state.repoRoot,
          productRoot: state.productRoot,
          productId: state.productId,
          traceId: state.traceId,
          mode: "legacy-overlay",
          sourceRepoRoot: state.sourceRepoRoot,
        },
        planFile: refs.slicePlanFile,
        policyFile: state.policyFile,
        dryRunFile: refs.dryRunFile,
        sliceId: candidate.id,
        requestedWritePaths: candidate.writablePathHints.map((filePath) => join(state.sourceRepoRoot, filePath)),
        writeModeAuthorized: true,
      });
      return {
        currentState: state.currentState,
        transitionHistory: [],
        artifactHistory: [refs.dryRunRef],
        issueReportRefs: [],
      };
    })
    .addNode("legacy_evidence_gate", (state: WorkflowGraphState) => {
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
      const dryRunReady = legacyDryRunReady(refs.dryRunFile);
      if (!agentEvidence.ok || !transitionEvidence.ok || !dryRunReady) {
        return appendRuntimeTransition(state, "COORDINATOR", "block_workflow", [...agentEvidence.artifactRefs, refs.slicePlanRef]);
      }
      return {
        currentState: state.currentState,
        transitionHistory: [],
        artifactHistory: [...agentEvidence.artifactRefs, refs.slicePlanRef, refs.dryRunRef],
        issueReportRefs: [],
      };
    })
    .addEdge("legacy_bootstrap", "legacy_scan")
    .addEdge("legacy_scan", "legacy_contracts")
    .addEdge("legacy_contracts", "legacy_trace_seed")
    .addEdge("legacy_trace_seed", "legacy_slice_proposal")
    .addEdge("legacy_slice_proposal", "legacy_dry_run")
    .addEdge("legacy_dry_run", "legacy_evidence_gate");
}
