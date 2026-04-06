import { START } from "@langchain/langgraph";
import type { WorkflowGraphState } from "./workflow-runtime.js";

export function registerEntryWorkflow(graph: any) {
  return graph
    .addNode("route_entry", (state: WorkflowGraphState) => ({ currentState: state.currentState }))
    .addEdge(START, "route_entry")
    .addConditionalEdges("route_entry", (state: WorkflowGraphState) =>
      state.sourceRepoRoot !== state.productRoot ? "legacy_bootstrap" : "classify_intake",
    );
}
