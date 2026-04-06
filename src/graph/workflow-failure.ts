import { dirname, join } from "node:path";
import { executeRecoveryBridge } from "../autonomy/recovery-bridge.js";
import { validateAgentEvidence } from "../validators/agent-evidence.js";
import { validateLivingDocuments } from "../validators/living-doc.js";
import { validateTransitionEvidence } from "../validators/transition-evidence.js";
import {
  appendRuntimeTransition,
  applyGraphUpdateToState,
  graceRuntimeLog,
  mergeGraphUpdates,
  transitionUpdate,
  type WorkflowGraphState,
} from "./workflow-runtime.js";

const BA_GRACE_ROUTE_FAILURE = "BA-grace-route-failure";

function buildReissueUpdate(
  state: Parameters<typeof transitionUpdate>[0],
  artifactRefs: string[],
  failTransition: "record_living_doc_fail" | "record_traceability_fail",
) {
  const fail = transitionUpdate(state, "COORDINATOR", failTransition, artifactRefs);
  const failedState = applyGraphUpdateToState(state, fail);
  const reject = transitionUpdate(
    failedState,
    "COORDINATOR",
    "reject_coder_output",
    [state.cwoRef, ...artifactRefs],
  );
  const rejectedState = applyGraphUpdateToState(failedState, reject);
  const reissue = transitionUpdate(
    rejectedState,
    "COORDINATOR",
    "split_scope_and_reissue_cwo",
    [state.cwoRef, ...artifactRefs],
  );
  return mergeGraphUpdates(fail, reject, reissue);
}

export function registerFailureWorkflow(graph: any) {
  return graph
    .addNode("verification_flow", (state: WorkflowGraphState) => {
      const start = transitionUpdate(state, "COORDINATOR", "start_verification", []);
      if (state.verificationMode === "fail") {
        graceRuntimeLog({
          ba: BA_GRACE_ROUTE_FAILURE,
          belief: "Verification failures must branch into governed failure states instead of continuing silently",
          fact: {
            currentState: start.currentState,
            verificationMode: state.verificationMode,
          },
        });
        const startedState = applyGraphUpdateToState(state, start);
        const fail = transitionUpdate(startedState, "COORDINATOR", "record_verification_fail", []);
        const failedState = applyGraphUpdateToState(startedState, fail);
        const capture = transitionUpdate(failedState, "COORDINATOR", "capture_failure", []);
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
        return mergeGraphUpdates(
          start,
          fail,
          capture,
          {
            currentState: recovery.currentState,
            transitionHistory: recovery.transitionHistory,
            artifactHistory: recovery.artifactRefs,
            issueReportRefs: [...(fail.issueReportRefs ?? []), ...(capture.issueReportRefs ?? [])],
          },
        );
      }
      const startedState = applyGraphUpdateToState(state, start);
      const pass = transitionUpdate(startedState, "COORDINATOR", "record_verification_pass", []);
      return mergeGraphUpdates(start, pass);
    })
    .addNode("living_doc_gate", (state: WorkflowGraphState) => {
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
        return buildReissueUpdate(state, [validation.artifactRef ?? state.livingDocReportRef], "record_living_doc_fail");
      }
      return {
        currentState: state.currentState,
        transitionHistory: [],
        artifactHistory: validation.artifactRef ? [validation.artifactRef] : [],
        issueReportRefs: [],
      };
    })
    .addNode("traceability_gate", (state: WorkflowGraphState) => {
      const agentEvidence = validateAgentEvidence({
        repoRoot: state.repoRoot,
        productId: state.productId,
        traceId: state.traceId,
        executionDir: state.executionDir,
        requiredRoles: ["ARCHITECT", "COORDINATOR", "CODER"],
      });
      if (!agentEvidence.ok) {
        return buildReissueUpdate(state, agentEvidence.artifactRefs, "record_traceability_fail");
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
        return buildReissueUpdate(state, [], "record_traceability_fail");
      }
      return appendRuntimeTransition(state, "COORDINATOR", "record_traceability_pass", []);
    });
}
