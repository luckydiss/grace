import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureParentDir } from "../runtime/fs-utils.js";
import { toRepoArtifactRef } from "../runtime/product-target.js";
import type { WorkflowStateName } from "../state/index.js";
import type { AgentDescriptor } from "./index.js";

/**
 * <!-- MODULE_MAP id="MM-grace-agents" -->
 * <Layers>
 *   <Layer name="domain" package="src/agents/index.ts">
 *     Canonical role-descriptor and invocation contracts for GRACE swarm execution.
 *   </Layer>
 *   <Layer name="application" package="src/agents/invoke-agent.ts">
 *     Materializes bounded task packets and invocation records before role execution starts.
 *   </Layer>
 * </Layers>
 * <Links>
 *   <Link ref="RequirementsAnalysis.xml#UC-GRACE-BOUNDED-EXECUTION" />
 *   <Link ref="DevelopmentPlan.xml#DP-SVC-grace-executor-runtime" />
 * </Links>
 * <!-- /MODULE_MAP -->
 */

/**
 * <MODULE_CONTRACT id="MC-grace-agents">
 *   <Purpose>Materialize governed swarm-role descriptors, task packets, and invocations before bounded execution begins.</Purpose>
 *   <Links>
 *     <Link ref="RequirementsAnalysis.xml#UC-GRACE-BOUNDED-EXECUTION" />
 *     <Link ref="RequirementsAnalysis.xml#NFR-GRACE-AUDITABILITY" />
 *   </Links>
 * </MODULE_CONTRACT>
 */

export interface AgentTaskPacket {
  schemaVersion: "grace-agent-task-packet-v1";
  traceId: string;
  productId: string;
  roleName: AgentDescriptor["roleName"];
  actorRole: AgentDescriptor["actorRole"];
  systemRef: string;
  mandatorySkillRefs: string[];
  loadedSkillRefs: string[];
  inputRefs: string[];
  allowedStates: WorkflowStateName[];
  allowedFcIds: string[];
  allowedBaIds: string[];
  issuedAt: string;
}

export interface InvokeAgentInput {
  repoRoot: string;
  productId: string;
  traceId: string;
  descriptor: AgentDescriptor;
  executionSequence: number;
  loadedSkillRefs: string[];
  inputRefs: string[];
  allowedStates: WorkflowStateName[];
  allowedFcIds: string[];
  allowedBaIds: string[];
  taskPacketFile: string;
  invocationFile: string;
}

export interface InvokeAgentResult {
  taskPacketFile: string;
  invocationFile: string;
  taskPacketRef: string;
  invocationRef: string;
}

/**
 * <FUNCTION_CONTRACT id="FC-grace-agents-invokeAgent">
 *   <Intent>Materialize a bounded agent task packet and durable invocation record so each swarm role run is auditable before execution evidence is emitted.</Intent>
 * </FUNCTION_CONTRACT>
 */
export function invokeAgent(input: InvokeAgentInput): InvokeAgentResult {
  const now = new Date().toISOString();
  const taskPacketFile = resolve(input.taskPacketFile);
  const invocationFile = resolve(input.invocationFile);
  const taskPacketRef = toRepoArtifactRef(input.repoRoot, taskPacketFile);
  const invocationRef = toRepoArtifactRef(input.repoRoot, invocationFile);

  const taskPacket: AgentTaskPacket = {
    schemaVersion: "grace-agent-task-packet-v1",
    traceId: input.traceId,
    productId: input.productId,
    roleName: input.descriptor.roleName,
    actorRole: input.descriptor.actorRole,
    systemRef: input.descriptor.systemRef,
    mandatorySkillRefs: input.descriptor.mandatorySkillRefs,
    loadedSkillRefs: input.loadedSkillRefs,
    inputRefs: input.inputRefs,
    allowedStates: input.allowedStates,
    allowedFcIds: input.allowedFcIds,
    allowedBaIds: input.allowedBaIds,
    issuedAt: now,
  };

  const invocation = {
    schemaVersion: "grace-agent-invocation-v1",
    traceId: input.traceId,
    productId: input.productId,
    roleName: input.descriptor.roleName,
    actorRole: input.descriptor.actorRole,
    executionSequence: input.executionSequence,
    invokedAt: now,
    taskPacketRef,
    systemRef: input.descriptor.systemRef,
    loadedSkillRefs: input.loadedSkillRefs,
    status: "DISPATCHED",
  };

  ensureParentDir(taskPacketFile);
  ensureParentDir(invocationFile);
  writeFileSync(taskPacketFile, `${JSON.stringify(taskPacket, null, 2)}\n`, "utf8");
  writeFileSync(invocationFile, `${JSON.stringify(invocation, null, 2)}\n`, "utf8");

  return {
    taskPacketFile,
    invocationFile,
    taskPacketRef,
    invocationRef,
  };
}
