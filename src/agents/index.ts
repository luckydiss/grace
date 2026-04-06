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
