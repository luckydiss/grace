import { Command, END, StateGraph } from "@langchain/langgraph";
import { MemorySaver } from "@langchain/langgraph-checkpoint";
import type { GraceWorkflowInput } from "./index.js";
import { WorkflowAnnotation } from "./workflow-annotation.js";
import { registerEntryWorkflow } from "./workflow-entry.js";
import { registerFailureWorkflow } from "./workflow-failure.js";
import { registerLegacyWorkflow } from "./workflow-legacy.js";
import { registerMainWorkflow } from "./workflow-main.js";
import type { WorkflowGraphState } from "./workflow-runtime.js";
export { resumeGraceWorkflow } from "./workflow-resume.js";

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
export function buildGraceWorkflow(): any {
  /* <BLOCK_ANCHOR id="BA-grace-route-main" purpose="Route the happy-path workflow through canonical transition, approval, execution, verification, and release states" /> */
  const graph = registerFailureWorkflow(
    registerMainWorkflow(
      registerLegacyWorkflow(
        registerEntryWorkflow(new StateGraph(WorkflowAnnotation)),
      ),
    ),
  )
    .addConditionalEdges("legacy_evidence_gate", () => END)
    .addConditionalEdges("verification_flow", (state: WorkflowGraphState) =>
      state.currentState === "VERIFICATION_PASSED" ? "living_doc_gate" : END,
    )
    .addConditionalEdges("living_doc_gate", (state: WorkflowGraphState) =>
      state.currentState === "VERIFICATION_PASSED" ? "traceability_gate" : END,
    )
    .addConditionalEdges("traceability_gate", (state: WorkflowGraphState) =>
      state.currentState === "TRACEABILITY_PASSED" ? "release_ready" : END,
    )
    .addEdge("archive_release", END);

  return graph.compile({ checkpointer: new MemorySaver() });
}

export async function invokeGraceWorkflow(
  graphInput: GraceWorkflowInput,
  options: { threadId: string; resume?: { approved: boolean } },
): Promise<any> {
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
