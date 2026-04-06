import { dirname, join } from "node:path";
import { createDeterministicLocalAdapter } from "../agents/external-adapter.js";
import { initializeAgentRun, updateAgentRun } from "../agents/agent-run.js";
import { invokeAgent } from "../agents/invoke-agent.js";
import { loadAgentDescriptor } from "../agents/load-agent-descriptor.js";
import type { AgentRoleName } from "../agents/index.js";
import type { RunAgentRoleResult, RunRoleExecutorInput } from "./index.js";
import { runBoundedRole } from "./run-bounded-role.js";

/**
 * <!-- MODULE_MAP id="MM-grace-agents" -->
 * <Layers>
 *   <Layer name="domain" package="src/agents/index.ts">
 *     Canonical role-descriptor and invocation contracts for GRACE swarm execution.
 *   </Layer>
 *   <Layer name="application" package="src/executors/run-agent-role.ts">
 *     Binds architect, coordinator, and coder roles to bounded executor windows and invocation evidence.
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
 *   <Purpose>Run governed architect, coordinator, and coder roles through bounded executor windows using repository-owned agent descriptors.</Purpose>
 *   <Links>
 *     <Link ref="RequirementsAnalysis.xml#UC-GRACE-BOUNDED-EXECUTION" />
 *     <Link ref="RequirementsAnalysis.xml#NFR-GRACE-AUDITABILITY" />
 *   </Links>
 * </MODULE_CONTRACT>
 */

function uniqueSkillRefs(mandatorySkillRefs: string[], scopedSkillRefs: string[] | undefined, availableSkillRefs: string[]): string[] {
  const refs = new Set<string>();
  for (const skill of mandatorySkillRefs) {
    refs.add(skill);
  }
  for (const skill of scopedSkillRefs ?? []) {
    if (availableSkillRefs.includes(skill)) {
      refs.add(skill);
    }
  }
  return [...refs];
}

export function runAgentRole(roleName: AgentRoleName, input: RunRoleExecutorInput): RunAgentRoleResult {
  const descriptor = loadAgentDescriptor({
    repoRoot: input.repoRoot,
    roleName,
  });
  const loadedSkillRefs = uniqueSkillRefs(descriptor.mandatorySkillRefs, input.scopedSkillRefs, descriptor.availableSkillRefs);
  const executionDir = dirname(input.executionFile ?? ".");
  const packetPrefix = `${descriptor.actorRole.slice(0, 1)}${descriptor.actorRole.slice(1).toLowerCase()}`;
  const taskPacketFile = join(executionDir, `${packetPrefix}TaskPacket-Workflow-${String(input.executionSequence).padStart(4, "0")}.json`);
  const invocationFile = join(executionDir, `${packetPrefix}Invocation-Workflow-${String(input.executionSequence).padStart(4, "0")}.json`);
  const agentRunStateFile = join(executionDir, `${packetPrefix}RunState-Workflow-${String(input.executionSequence).padStart(4, "0")}.json`);
  const agentRunLogFile = join(executionDir, `${packetPrefix}RunLog-Workflow-${String(input.executionSequence).padStart(4, "0")}.jsonl`);
  const invoked = invokeAgent({
    repoRoot: input.repoRoot,
    productId: input.productId,
    traceId: input.traceId,
    descriptor,
    executionSequence: input.executionSequence,
    loadedSkillRefs,
    inputRefs: [descriptor.systemRef, ...input.inputRefs],
    allowedStates: input.allowedStates,
    allowedFcIds: input.allowedFcIds,
    allowedBaIds: input.allowedBaIds,
    taskPacketFile,
    invocationFile,
  });
  const runtimeAdapter = input.runtimeAdapter ?? createDeterministicLocalAdapter(input.operation);
  initializeAgentRun({
    runId: `${descriptor.actorRole}-RUN-grace-agent-${String(input.executionSequence).padStart(2, "0")}`,
    traceId: input.traceId,
    productId: input.productId,
    descriptor,
    executionSequence: input.executionSequence,
    adapterKind: runtimeAdapter.kind,
    allowedStates: input.allowedStates,
    inputRefs: [descriptor.systemRef, invoked.taskPacketRef, ...input.inputRefs],
    taskPacketRef: invoked.taskPacketRef,
    invocationRef: invoked.invocationRef,
    stateFile: agentRunStateFile,
    logFile: agentRunLogFile,
    retryBudget: input.agentRetryBudget,
    resumeContextRef: input.resumeContextRef,
    now: input.now,
  });
  const result = runBoundedRole({
    productId: input.productId,
    traceId: input.traceId,
    actorRole: descriptor.actorRole,
    executionId: `${descriptor.actorRole}-EXEC-grace-agent-${String(input.executionSequence).padStart(2, "0")}`,
    executionSequence: input.executionSequence,
    allowedStates: input.allowedStates,
    allowedFcIds: input.allowedFcIds,
    allowedBaIds: input.allowedBaIds,
    requiredSkillRefs: loadedSkillRefs,
    inputRefs: [descriptor.systemRef, invoked.taskPacketRef, ...input.inputRefs],
    stateFile: input.stateFile,
    executionFile: input.executionFile,
    skillTraceFile: input.skillTraceFile,
    now: input.now,
    operation: () => {
      updateAgentRun({
        stateFile: agentRunStateFile,
        logFile: agentRunLogFile,
        status: "ACTIVE",
        notes: ["Bounded role window opened and delegated to the configured runtime adapter."],
        now: input.now,
      });
      try {
        const adapterResult = runtimeAdapter.run({
          productId: input.productId,
          traceId: input.traceId,
          descriptor,
          executionSequence: input.executionSequence,
          loadedSkillRefs,
          inputRefs: [descriptor.systemRef, invoked.taskPacketRef, ...input.inputRefs],
          allowedFcIds: input.allowedFcIds,
          allowedBaIds: input.allowedBaIds,
          allowedStates: input.allowedStates,
        });
        const payload = adapterResult.payload;
        updateAgentRun({
          stateFile: agentRunStateFile,
          logFile: agentRunLogFile,
          status: "SUCCEEDED",
          outputRefs: [...payload.outputRefs, invoked.taskPacketRef, invoked.invocationRef],
          sessionId: adapterResult.sessionId,
          resumeToken: adapterResult.resumeToken,
          notes: adapterResult.notes,
          now: input.now,
        });
        return {
          ...payload,
          outputRefs: [...payload.outputRefs, invoked.taskPacketRef, invoked.invocationRef],
        };
      } catch (error) {
        updateAgentRun({
          stateFile: agentRunStateFile,
          logFile: agentRunLogFile,
          status: "FAILED",
          failureReason: error instanceof Error ? error.message : String(error),
          failureCategory: "TOOL_FAILURE",
          notes: ["Runtime adapter raised an execution failure inside the bounded role window."],
          now: input.now,
        });
        throw error;
      }
    },
  });

  if (result.ok) {
    return {
      ...result,
      descriptor,
      loadedSkillRefs,
      taskPacketFile: invoked.taskPacketFile,
      invocationFile: invoked.invocationFile,
      agentRunStateFile,
      agentRunLogFile,
    };
  }

  updateAgentRun({
    stateFile: agentRunStateFile,
    logFile: agentRunLogFile,
    status: "BLOCKED",
    failureReason: result.violations.map((item) => item.code).join(","),
    failureCategory: "SCOPE_VIOLATION",
    notes: ["Bounded role execution was blocked before successful completion."],
    now: input.now,
  });

  return {
    ...result,
    descriptor,
    loadedSkillRefs,
    taskPacketFile: null,
    invocationFile: null,
    agentRunStateFile,
    agentRunLogFile,
  };
}

/**
 * <FUNCTION_CONTRACT id="FC-grace-agents-runArchitectRole">
 *   <Intent>Run the architect role through a bounded execution window using the canonical architect descriptor and mandatory skills.</Intent>
 * </FUNCTION_CONTRACT>
 */
export function runArchitectRole(input: RunRoleExecutorInput): RunAgentRoleResult {
  return runAgentRole("architect", input);
}

/**
 * <FUNCTION_CONTRACT id="FC-grace-agents-runCoordinatorRole">
 *   <Intent>Run the coordinator role through a bounded execution window using the canonical coordinator descriptor and mandatory skills.</Intent>
 * </FUNCTION_CONTRACT>
 */
export function runCoordinatorRole(input: RunRoleExecutorInput): RunAgentRoleResult {
  return runAgentRole("coordinator", input);
}

/**
 * <FUNCTION_CONTRACT id="FC-grace-agents-runCoderRole">
 *   <Intent>Run the coder role through a bounded execution window using the canonical coder descriptor and mandatory skills.</Intent>
 * </FUNCTION_CONTRACT>
 */
export function runCoderRole(input: RunRoleExecutorInput): RunAgentRoleResult {
  return runAgentRole("coder", input);
}
