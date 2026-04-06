import { executeRecoveryBridge } from "../autonomy/recovery-bridge.js";
import { runCoderRole, runCoordinatorRole } from "../executors/run-agent-role.js";
import { validateAgentEvidence } from "../validators/agent-evidence.js";
import { validateLivingDocuments } from "../validators/living-doc.js";
import { validateTransitionEvidence } from "../validators/transition-evidence.js";
import type { GraceWorkflowInput } from "./index.js";
import {
  appendRuntimeTransition,
  buildCoderArtifacts,
  buildCoordinatorArtifacts,
  buildProcessArtifactSpec,
  loadPersistedState,
  makePlainState,
  mergeGraphUpdates,
  transitionUpdate,
} from "./workflow-runtime.js";

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
      ...mergeGraphUpdates(
        approve,
        draft,
        branch,
        issued,
        activate,
        submit,
        startVerification,
        fail,
        capture,
        {
          currentState: recovery.currentState,
          transitionHistory: recovery.transitionHistory,
          artifactHistory: recovery.artifactRefs,
          issueReportRefs: [
            ...(approve.issueReportRefs ?? []),
            ...(issued.issueReportRefs ?? []),
            ...(fail.issueReportRefs ?? []),
            ...(capture.issueReportRefs ?? []),
          ],
        },
      ),
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
    const reject = transitionUpdate(
      { ...submittedState, ...startVerification, ...pass, ...fail },
      "COORDINATOR",
      "reject_coder_output",
      [graphInput.cwoRef, livingDocValidation.artifactRef ?? graphInput.livingDocReportRef],
    );
    const reissue = transitionUpdate(
      { ...submittedState, ...startVerification, ...pass, ...fail, ...reject },
      "COORDINATOR",
      "split_scope_and_reissue_cwo",
      [graphInput.cwoRef, livingDocValidation.artifactRef ?? graphInput.livingDocReportRef],
    );
    return mergeGraphUpdates(approve, draft, branch, issued, activate, submit, startVerification, pass, fail, reject, reissue);
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
    const reject = transitionUpdate(
      { ...submittedState, ...startVerification, ...pass, ...fail },
      "COORDINATOR",
      "reject_coder_output",
      [graphInput.cwoRef],
    );
    const reissue = transitionUpdate(
      { ...submittedState, ...startVerification, ...pass, ...fail, ...reject },
      "COORDINATOR",
      "split_scope_and_reissue_cwo",
      [graphInput.cwoRef],
    );
    return mergeGraphUpdates(approve, draft, branch, issued, activate, submit, startVerification, pass, fail, reject, reissue);
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
    const reject = transitionUpdate(
      { ...submittedState, ...startVerification, ...pass, ...fail },
      "COORDINATOR",
      "reject_coder_output",
      [graphInput.cwoRef, ...agentEvidence.artifactRefs],
    );
    const reissue = transitionUpdate(
      { ...submittedState, ...startVerification, ...pass, ...fail, ...reject },
      "COORDINATOR",
      "split_scope_and_reissue_cwo",
      [graphInput.cwoRef, ...agentEvidence.artifactRefs],
    );
    return mergeGraphUpdates(approve, draft, branch, issued, activate, submit, startVerification, pass, fail, reject, reissue);
  }

  const tracePass = transitionUpdate({ ...submittedState, ...startVerification, ...pass }, "COORDINATOR", "record_traceability_pass", []);
  const release = transitionUpdate({ ...submittedState, ...startVerification, ...pass, ...tracePass }, "COORDINATOR", "mark_ready_for_release", []);
  const delivered = transitionUpdate({ ...submittedState, ...startVerification, ...pass, ...tracePass, ...release }, "COORDINATOR", "mark_delivered", []);
  const archived = transitionUpdate(
    { ...submittedState, ...startVerification, ...pass, ...tracePass, ...release, ...delivered },
    "COORDINATOR",
    "archive_delivery",
    [],
  );
  return mergeGraphUpdates(
    approve,
    draft,
    branch,
    issued,
    activate,
    submit,
    startVerification,
    pass,
    {
      artifactHistory: livingDocValidation.artifactRef ? [livingDocValidation.artifactRef] : [],
    },
    tracePass,
    release,
    delivered,
    archived,
    {
      issueReportRefs: [...(approve.issueReportRefs ?? []), ...(issued.issueReportRefs ?? [])],
    },
  );
}
