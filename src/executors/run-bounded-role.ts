import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureParentDir } from "../runtime/fs-utils.js";
import { emitGraceRuntimeLog } from "../runtime/runtime-log.js";
import {
  GRACE_WORKFLOW_STATE_SCHEMA,
  type WorkflowStateDocument,
  type WorkflowStateName,
} from "../state/index.js";
import type {
  BoundedRoleExecutionPayload,
  BoundedRoleViolation,
  RunBoundedRoleInput,
  RunBoundedRoleResult,
} from "./index.js";

/**
 * <!-- MODULE_MAP id="MM-grace-executors" -->
 * <Layers>
 *   <Layer name="domain" package="src/executors/index.ts">
 *     Contracts for bounded architect, coordinator, and coder execution windows.
 *   </Layer>
 *   <Layer name="application" package="src/executors/run-bounded-role.ts">
 *     Opens one bounded role window, enforces semantic scope, and emits durable execution evidence.
 *   </Layer>
 * </Layers>
 * <Links>
 *   <Link ref="RequirementsAnalysis.xml#UC-GRACE-BOUNDED-EXECUTION" />
 *   <Link ref="DevelopmentPlan.xml#DP-SVC-grace-executor-runtime" />
 * </Links>
 * <!-- /MODULE_MAP -->
 */

/**
 * <MODULE_CONTRACT id="MC-grace-executors">
 *   <Purpose>Run architect, coordinator, and coder only inside explicit workflow windows with bounded semantic scope.</Purpose>
 *   <Links>
 *     <Link ref="RequirementsAnalysis.xml#UC-GRACE-BOUNDED-EXECUTION" />
 *     <Link ref="RequirementsAnalysis.xml#NFR-GRACE-ROLE-BOUNDARY" />
 *   </Links>
 * </MODULE_CONTRACT>
 */

const MC_GRACE_EXECUTORS = "MC-grace-executors";
const FC_GRACE_EXECUTORS_RUN_BOUNDED_ROLE = "FC-grace-executors-runBoundedRole";
const BA_GRACE_OPEN_WINDOW = "BA-grace-open-window";
const BA_GRACE_RUN_ROLE = "BA-grace-run-role";
const BA_GRACE_CLOSE_WINDOW = "BA-grace-close-window";

const DEFAULT_STATE_FILE = "docs/grace/state/WorkflowState.json";

function graceRuntimeLog(entry: {
  ba: string;
  belief: string;
  fact: Record<string, unknown>;
}): void {
  emitGraceRuntimeLog({
    mc: MC_GRACE_EXECUTORS,
    fc: FC_GRACE_EXECUTORS_RUN_BOUNDED_ROLE,
    ...entry,
  });
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function titleCaseRole(actorRole: RunBoundedRoleInput["actorRole"]): string {
  return `${actorRole.slice(0, 1)}${actorRole.slice(1).toLowerCase()}`;
}

function defaultExecutionFile(actorRole: RunBoundedRoleInput["actorRole"], executionSequence: number): string {
  return `docs/grace/executions/${titleCaseRole(actorRole)}Execution-${String(executionSequence).padStart(4, "0")}.xml`;
}

function defaultSkillTraceFile(actorRole: RunBoundedRoleInput["actorRole"], executionSequence: number): string {
  return `docs/grace/executions/${titleCaseRole(actorRole)}SkillTrace-${String(executionSequence).padStart(4, "0")}.json`;
}

function loadWorkflowState(stateFilePath: string): { state: WorkflowStateDocument | null; violations: BoundedRoleViolation[] } {
  if (!existsSync(stateFilePath)) {
    return {
      state: null,
      violations: [{ code: "STATE_FILE_MISSING", message: `Workflow state file does not exist: ${stateFilePath}` }],
    };
  }

  const parsed = JSON.parse(readFileSync(stateFilePath, "utf8")) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      state: null,
      violations: [{ code: "STATE_SCHEMA_INVALID", message: "Workflow state document must be an object." }],
    };
  }

  const candidate = parsed as Record<string, unknown>;
  if (
    candidate.schemaVersion !== GRACE_WORKFLOW_STATE_SCHEMA ||
    typeof candidate.currentState !== "string" ||
    typeof candidate.blocked !== "boolean"
  ) {
    return {
      state: null,
      violations: [{ code: "STATE_SCHEMA_INVALID", message: "Workflow state document is malformed or has an unexpected schemaVersion." }],
    };
  }

  return { state: candidate as unknown as WorkflowStateDocument, violations: [] };
}

function validateWindow(state: WorkflowStateDocument | null, input: RunBoundedRoleInput): BoundedRoleViolation[] {
  if (state === null) {
    return [];
  }

  const violations: BoundedRoleViolation[] = [];
  if (state.blocked) {
    violations.push({
      code: "WORKFLOW_BLOCKED",
      message: "Bounded role execution cannot open while the workflow is blocked.",
    });
  }
  if (!input.allowedStates.includes(state.currentState)) {
    violations.push({
      code: "WORKFLOW_STATE_NOT_ALLOWED",
      message: `Workflow state ${state.currentState} is outside the allowed executor window.`,
    });
  }
  return violations;
}

function validateScope(payload: BoundedRoleExecutionPayload, input: RunBoundedRoleInput): BoundedRoleViolation[] {
  const violations: BoundedRoleViolation[] = [];
  for (const fcId of payload.touchedFcIds) {
    if (!input.allowedFcIds.includes(fcId)) {
      violations.push({
        code: "FC_SCOPE_VIOLATION",
        message: `Touched FC ${fcId} is outside the bounded executor window.`,
      });
    }
  }
  for (const baId of payload.touchedBaIds) {
    if (!input.allowedBaIds.includes(baId)) {
      violations.push({
        code: "BA_SCOPE_VIOLATION",
        message: `Touched BA ${baId} is outside the bounded executor window.`,
      });
    }
  }
  return violations;
}

function renderExecutionXml(
  input: RunBoundedRoleInput,
  state: WorkflowStateDocument,
  payload: BoundedRoleExecutionPayload,
): string {
  const rootName = `${titleCaseRole(input.actorRole)}Execution`;
  const requiredSkillLines = input.requiredSkillRefs
    .map((skill) => `    <Skill name="${xmlEscape(skill)}" />`)
    .join("\n");
  const inputRefLines = input.inputRefs
    .map((ref) => `    <Ref value="${xmlEscape(ref)}" />`)
    .join("\n");
  const outputRefLines = payload.outputRefs
    .map((ref) => `    <Ref value="${xmlEscape(ref)}" />`)
    .join("\n");
  const fcLines = input.allowedFcIds
    .map((id) => `    <FC id="${xmlEscape(id)}" />`)
    .join("\n");
  const baLines = input.allowedBaIds
    .map((id) => `    <BA id="${xmlEscape(id)}" />`)
    .join("\n");
  const touchedFcLines = payload.touchedFcIds
    .map((id) => `    <FC id="${xmlEscape(id)}" />`)
    .join("\n");
  const touchedBaLines = payload.touchedBaIds
    .map((id) => `    <BA id="${xmlEscape(id)}" />`)
    .join("\n");
  const noteLines = (payload.notes ?? [])
    .map((note) => `    <Note value="${xmlEscape(note)}" />`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<${rootName} id="${xmlEscape(input.executionId)}" traceId="${xmlEscape(input.traceId)}" actorRole="${xmlEscape(input.actorRole)}" sequence="${input.executionSequence}">
  <WorkflowWindow currentState="${xmlEscape(state.currentState)}">
    <AllowedStates>
      ${input.allowedStates.map((value) => `<State name="${xmlEscape(value)}" />`).join("\n      ")}
    </AllowedStates>
  </WorkflowWindow>
  <AllowedScope>
${fcLines}
${baLines}
  </AllowedScope>
  <TouchedScope>
${touchedFcLines}
${touchedBaLines}
  </TouchedScope>
  <InputRefs>
${inputRefLines}
  </InputRefs>
  <OutputRefs>
${outputRefLines}
  </OutputRefs>
  <RequiredSkillRefs>
${requiredSkillLines}
  </RequiredSkillRefs>
  <Notes>
${noteLines}
  </Notes>
</${rootName}>
`;
}

function renderSkillTraceJson(input: RunBoundedRoleInput, now: string): string {
  return `${JSON.stringify(
    {
      schemaVersion: "grace-skill-trace-v1",
      traceId: input.traceId,
      executionId: input.executionId,
      actorRole: input.actorRole,
      executionSequence: input.executionSequence,
      generatedAt: now,
      events: input.requiredSkillRefs.map((skill, index) => ({
        id: `${input.executionId}-SKILL-${String(index + 1).padStart(2, "0")}`,
        skill,
        status: "LOADED",
        source: index === 0 ? "MANDATORY_MODE" : "MANDATORY_PROTOCOL",
        invokedAt: now,
        trigger: `skill(name="${skill}")`,
      })),
    },
    null,
    2,
  )}\n`;
}

/**
 * <FUNCTION_CONTRACT id="FC-grace-executors-runBoundedRole">
 *   <Intent>Open one bounded execution window for architect, coordinator, or coder and emit durable execution evidence only when semantic scope remains inside the allowed slice.</Intent>
 *   <Inputs>
 *     <Input name="input">Actor role, workflow window constraints, required skills, evidence paths, and a bounded execution callback.</Input>
 *   </Inputs>
 *   <Outputs>
 *     <Output name="result">Deterministic execution verdict with emitted evidence paths or bounded-window violations.</Output>
 *   </Outputs>
 *   <BlockAnchors>
 *     <BA ref="BA-grace-open-window" />
 *     <BA ref="BA-grace-run-role" />
 *     <BA ref="BA-grace-close-window" />
 *   </BlockAnchors>
 *   <Links>
 *     <Link ref="RequirementsAnalysis.xml#UC-GRACE-BOUNDED-EXECUTION" />
 *   </Links>
 * </FUNCTION_CONTRACT>
 */
export function runBoundedRole(input: RunBoundedRoleInput): RunBoundedRoleResult {
  const now = input.now ?? new Date().toISOString();
  const stateFilePath = resolve(input.stateFile ?? DEFAULT_STATE_FILE);
  const executionFilePath = resolve(input.executionFile ?? defaultExecutionFile(input.actorRole, input.executionSequence));
  const skillTraceFilePath = resolve(input.skillTraceFile ?? defaultSkillTraceFile(input.actorRole, input.executionSequence));

  /* <BLOCK_ANCHOR id="BA-grace-open-window" purpose="Open one bounded role window only when the current workflow state permits the actor to operate" /> */
  const loadedState = loadWorkflowState(stateFilePath);
  const windowViolations = [...loadedState.violations, ...validateWindow(loadedState.state, input)];
  graceRuntimeLog({
    ba: BA_GRACE_OPEN_WINDOW,
    belief: "A role executor may start only inside an explicit workflow state window backed by persisted state",
    fact: {
      stateFile: stateFilePath,
      actorRole: input.actorRole,
      currentState: loadedState.state?.currentState ?? null,
      violationCodes: windowViolations.map((violation) => violation.code),
    },
  });
  if (loadedState.state === null || windowViolations.length > 0) {
    return {
      ok: false,
      actorRole: input.actorRole,
      currentState: loadedState.state?.currentState ?? null,
      executionFile: null,
      skillTraceFile: null,
      violations: windowViolations,
      outputRefs: [],
    };
  }

  /* <BLOCK_ANCHOR id="BA-grace-run-role" purpose="Run the bounded executor and reject any FC or BA activity outside the allowed semantic slice" /> */
  const payload = input.operation();
  const scopeViolations = validateScope(payload, input);
  graceRuntimeLog({
    ba: BA_GRACE_RUN_ROLE,
    belief: "Role execution is legal only when touched FC and BA identifiers stay inside the declared semantic slice",
    fact: {
      actorRole: input.actorRole,
      touchedFcIds: payload.touchedFcIds,
      touchedBaIds: payload.touchedBaIds,
      violationCodes: scopeViolations.map((violation) => violation.code),
    },
  });
  if (scopeViolations.length > 0) {
    return {
      ok: false,
      actorRole: input.actorRole,
      currentState: loadedState.state.currentState,
      executionFile: null,
      skillTraceFile: null,
      violations: scopeViolations,
      outputRefs: payload.outputRefs,
    };
  }

  /* <BLOCK_ANCHOR id="BA-grace-close-window" purpose="Emit durable execution evidence and skill trace sidecars for a completed bounded role window" /> */
  ensureParentDir(executionFilePath);
  ensureParentDir(skillTraceFilePath);
  writeFileSync(executionFilePath, renderExecutionXml(input, loadedState.state, payload), "utf8");
  writeFileSync(skillTraceFilePath, renderSkillTraceJson(input, now), "utf8");
  graceRuntimeLog({
    ba: BA_GRACE_CLOSE_WINDOW,
    belief: "A completed bounded executor window must leave durable execution and skill-trace evidence for audit",
    fact: {
      executionFile: executionFilePath,
      skillTraceFile: skillTraceFilePath,
      actorRole: input.actorRole,
      outputRefs: payload.outputRefs,
    },
  });

  return {
    ok: true,
    actorRole: input.actorRole,
    currentState: loadedState.state.currentState,
    executionFile: executionFilePath,
    skillTraceFile: skillTraceFilePath,
    violations: [],
    outputRefs: payload.outputRefs,
  };
}
