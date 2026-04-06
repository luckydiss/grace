import type { BoundedRoleExecutionPayload } from "../executors/index.js";
import type { AgentRuntimeKind } from "./agent-run.js";
import type { AgentDescriptor } from "./index.js";

export interface AgentRuntimeContext {
  productId: string;
  traceId: string;
  descriptor: AgentDescriptor;
  executionSequence: number;
  loadedSkillRefs: string[];
  inputRefs: string[];
  allowedFcIds: string[];
  allowedBaIds: string[];
  allowedStates: string[];
}

export interface AgentRuntimeAdapterResult {
  payload: BoundedRoleExecutionPayload;
  sessionId?: string | null;
  resumeToken?: string | null;
  notes?: string[];
}

export interface AgentRuntimeAdapter {
  kind: AgentRuntimeKind;
  run(context: AgentRuntimeContext): AgentRuntimeAdapterResult;
}

export function createDeterministicLocalAdapter(
  operation: () => BoundedRoleExecutionPayload,
): AgentRuntimeAdapter {
  return {
    kind: "deterministic-local",
    run() {
      return {
        payload: operation(),
        notes: ["Deterministic local adapter executed the bounded role payload callback."],
      };
    },
  };
}
