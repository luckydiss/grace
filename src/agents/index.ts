export type AgentRoleName = "architect" | "coordinator" | "coder";

export interface AgentDescriptor {
  roleName: AgentRoleName;
  actorRole: "ARCHITECT" | "COORDINATOR" | "CODER";
  systemFile: string;
  systemRef: string;
  mandatorySkillRefs: string[];
  availableSkillRefs: string[];
}

export interface LoadAgentDescriptorInput {
  repoRoot: string;
  roleName: AgentRoleName;
}

export type { AgentRuntimeAdapter, AgentRuntimeAdapterResult, AgentRuntimeContext } from "./external-adapter.js";
export type {
  AgentRunEventDocument,
  AgentRunFailureCategory,
  AgentRunNextAction,
  AgentRunStateDocument,
  AgentRunStatus,
  AgentRuntimeKind,
} from "./agent-run.js";
