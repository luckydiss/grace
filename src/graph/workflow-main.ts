import { join } from "node:path";
import { END, interrupt } from "@langchain/langgraph";
import { runArchitectRole, runCoderRole, runCoordinatorRole } from "../executors/run-agent-role.js";
import {
  appendRuntimeTransition,
  applyGraphUpdateToState,
  buildCoderArtifacts,
  buildCoordinatorArtifacts,
  buildProcessArtifactSpec,
  graceRuntimeLog,
  mergeGraphUpdates,
  transitionUpdate,
  type WorkflowGraphState,
} from "./workflow-runtime.js";

const BA_GRACE_ROUTE_APPROVAL = "BA-grace-route-approval";

export function registerMainWorkflow(graph: any) {
  return graph
    .addNode("classify_intake", (state: WorkflowGraphState) => appendRuntimeTransition(state, "COORDINATOR", "classify_intake", []))
    .addNode("blueprint_flow", (state: WorkflowGraphState) => {
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
      const startedState = applyGraphUpdateToState(state, start);
      const review = transitionUpdate(startedState, "ARCHITECT", "submit_blueprint_for_review", [
        state.developmentPlanRef,
        state.executionPlanRef,
      ]);
      const reviewedState = applyGraphUpdateToState(startedState, review);
      const approve = transitionUpdate(reviewedState, "COORDINATOR", "approve_blueprint", [
        state.developmentPlanRef,
      ]);
      return mergeGraphUpdates(start, review, approve);
    })
    .addNode("handoff_flow", (state: WorkflowGraphState) => {
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
      const startedState = applyGraphUpdateToState(state, start);
      const propose = transitionUpdate(startedState, "COORDINATOR", "propose_handoff", [state.handoffRef]);
      const proposedState = applyGraphUpdateToState(startedState, propose);
      const request = transitionUpdate(proposedState, "COORDINATOR", "request_handoff_approval", [state.handoffRef]);
      return mergeGraphUpdates(start, propose, request);
    })
    .addNode("await_human_approval", (state: WorkflowGraphState) => {
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
    .addNode("resolve_approval", (state: WorkflowGraphState) => {
      if (state.approvalDecision === "APPROVE") {
        return appendRuntimeTransition(state, "HUMAN", "approve_handoff", [state.handoffRef]);
      }
      return appendRuntimeTransition(state, "HUMAN", "reject_handoff", [state.handoffRef]);
    })
    .addNode("authorize_work", (state: WorkflowGraphState) => {
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
      const draftedState = applyGraphUpdateToState(state, draft);
      const branch = transitionUpdate(
        draftedState,
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
      const branchedState = applyGraphUpdateToState(draftedState, branch);
      const issued = transitionUpdate(branchedState, "COORDINATOR", "issue_cwo", [
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
      return mergeGraphUpdates(draft, branch, issued);
    })
    .addNode("coder_flow", (state: WorkflowGraphState) => {
      const activate = transitionUpdate(state, "COORDINATOR", "activate_coder", [state.cwoRef]);
      const activatedState = applyGraphUpdateToState(state, activate);
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
      return mergeGraphUpdates(activate, submit);
    })
    .addNode("release_ready", (state: WorkflowGraphState) => appendRuntimeTransition(state, "COORDINATOR", "mark_ready_for_release", []))
    .addNode("deliver_release", (state: WorkflowGraphState) => appendRuntimeTransition(state, "COORDINATOR", "mark_delivered", []))
    .addNode("archive_release", (state: WorkflowGraphState) => appendRuntimeTransition(state, "COORDINATOR", "archive_delivery", []))
    .addEdge("classify_intake", "blueprint_flow")
    .addEdge("blueprint_flow", "handoff_flow")
    .addEdge("handoff_flow", "await_human_approval")
    .addEdge("await_human_approval", "resolve_approval")
    .addConditionalEdges("resolve_approval", (state: WorkflowGraphState) =>
      state.currentState === "HANDOFF_APPROVED" ? "authorize_work" : END,
    )
    .addEdge("authorize_work", "coder_flow")
    .addEdge("coder_flow", "verification_flow")
    .addEdge("release_ready", "deliver_release")
    .addEdge("deliver_release", "archive_release");
}
