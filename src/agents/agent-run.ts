import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureParentDir } from "../runtime/fs-utils.js";
import { createGraceRuntimeLogger } from "../runtime/runtime-log.js";
import type { WorkflowStateName } from "../state/index.js";
import type { AgentDescriptor } from "./index.js";

const MC_GRACE_AGENTS = "MC-grace-agents";
const FC_GRACE_AGENTS_PERSIST_RUN = "FC-grace-agents-persistRun";
const BA_GRACE_AGENT_RUN_DISPATCH = "BA-grace-agent-run-dispatch";
const BA_GRACE_AGENT_RUN_TRANSITION = "BA-grace-agent-run-transition";

const graceRuntimeLog = createGraceRuntimeLogger({
  mc: MC_GRACE_AGENTS,
  fc: FC_GRACE_AGENTS_PERSIST_RUN,
});

export type AgentRuntimeKind = "deterministic-local" | "external-cli";

export type AgentRunStatus = "DISPATCHED" | "ACTIVE" | "SUCCEEDED" | "FAILED" | "BLOCKED";

export type AgentRunFailureCategory =
  | "TRANSIENT"
  | "TOOL_FAILURE"
  | "USER_INTERRUPT"
  | "SCOPE_VIOLATION"
  | "POLICY_BLOCK"
  | "UNKNOWN";

export type AgentRunNextAction = "NONE" | "RESUME" | "REISSUE" | "ESCALATE";

export interface AgentRunStateDocument {
  schemaVersion: "grace-agent-run-state-v1";
  runId: string;
  traceId: string;
  productId: string;
  roleName: AgentDescriptor["roleName"];
  actorRole: AgentDescriptor["actorRole"];
  executionSequence: number;
  adapterKind: AgentRuntimeKind;
  currentStatus: AgentRunStatus;
  allowedStates: WorkflowStateName[];
  inputRefs: string[];
  outputRefs: string[];
  taskPacketRef: string;
  invocationRef: string;
  stateFile: string;
  logFile: string;
  sessionId: string | null;
  resumeToken: string | null;
  failureReason: string | null;
  failureCategory: AgentRunFailureCategory | null;
  retryBudget: number;
  retryCount: number;
  retryReason: string | null;
  resumeContextRef: string | null;
  nextAction: AgentRunNextAction;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface AgentRunEventDocument {
  schemaVersion: "grace-agent-run-event-v1";
  id: string;
  runId: string;
  traceId: string;
  productId: string;
  roleName: AgentDescriptor["roleName"];
  actorRole: AgentDescriptor["actorRole"];
  executionSequence: number;
  adapterKind: AgentRuntimeKind;
  status: AgentRunStatus;
  createdAt: string;
  inputRefs: string[];
  outputRefs: string[];
  sessionId: string | null;
  resumeToken: string | null;
  failureReason: string | null;
  failureCategory: AgentRunFailureCategory | null;
  retryCount: number;
  retryBudget: number;
  retryReason: string | null;
  resumeContextRef: string | null;
  nextAction: AgentRunNextAction;
  notes: string[];
}

export interface InitializeAgentRunInput {
  runId: string;
  traceId: string;
  productId: string;
  descriptor: AgentDescriptor;
  executionSequence: number;
  adapterKind: AgentRuntimeKind;
  allowedStates: WorkflowStateName[];
  inputRefs: string[];
  taskPacketRef: string;
  invocationRef: string;
  stateFile: string;
  logFile: string;
  sessionId?: string | null;
  resumeToken?: string | null;
  retryBudget?: number;
  resumeContextRef?: string | null;
  now?: string;
}

export interface UpdateAgentRunInput {
  stateFile: string;
  logFile: string;
  status: AgentRunStatus;
  outputRefs?: string[];
  sessionId?: string | null;
  resumeToken?: string | null;
  failureReason?: string | null;
  failureCategory?: AgentRunFailureCategory | null;
  retryReason?: string | null;
  resumeContextRef?: string | null;
  notes?: string[];
  now?: string;
}

const ALLOWED_AGENT_RUN_TRANSITIONS: Record<AgentRunStatus, AgentRunStatus[]> = {
  DISPATCHED: ["ACTIVE", "FAILED", "BLOCKED"],
  ACTIVE: ["SUCCEEDED", "FAILED", "BLOCKED"],
  FAILED: ["ACTIVE"],
  BLOCKED: [],
  SUCCEEDED: [],
};

const RETRYABLE_FAILURE_CATEGORIES = new Set<AgentRunFailureCategory>([
  "TRANSIENT",
  "TOOL_FAILURE",
  "USER_INTERRUPT",
]);

function normalizeRetryBudget(value: number | undefined): number {
  if (value === undefined) {
    return 1;
  }
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function classifyFailureCategory(failureReason: string | null | undefined): AgentRunFailureCategory | null {
  if (!failureReason) {
    return null;
  }
  const normalized = failureReason.toLowerCase();
  if (normalized.includes("fc_scope_violation") || normalized.includes("ba_scope_violation") || normalized.includes("scope")) {
    return "SCOPE_VIOLATION";
  }
  if (normalized.includes("policy") || normalized.includes("blocked")) {
    return "POLICY_BLOCK";
  }
  if (normalized.includes("interrupt") || normalized.includes("cancel")) {
    return "USER_INTERRUPT";
  }
  if (normalized.includes("timeout") || normalized.includes("temporary") || normalized.includes("network")) {
    return "TRANSIENT";
  }
  if (normalized.includes("exit") || normalized.includes("tool") || normalized.includes("adapter")) {
    return "TOOL_FAILURE";
  }
  return "UNKNOWN";
}

function determineNextAction(
  status: AgentRunStatus,
  failureCategory: AgentRunFailureCategory | null,
  retryCount: number,
  retryBudget: number,
): AgentRunNextAction {
  if (status === "SUCCEEDED" || status === "ACTIVE" || status === "DISPATCHED") {
    return "NONE";
  }
  if (status === "BLOCKED") {
    return "REISSUE";
  }
  if (failureCategory !== null && RETRYABLE_FAILURE_CATEGORIES.has(failureCategory) && retryCount < retryBudget) {
    return "RESUME";
  }
  if (failureCategory === "SCOPE_VIOLATION" || failureCategory === "POLICY_BLOCK") {
    return "REISSUE";
  }
  return "ESCALATE";
}

function assertAllowedTransition(from: AgentRunStatus, to: AgentRunStatus): void {
  if (!ALLOWED_AGENT_RUN_TRANSITIONS[from].includes(to)) {
    throw new Error(`Illegal agent run transition: ${from} -> ${to}`);
  }
}

function assertResumePolicy(state: AgentRunStateDocument, input: UpdateAgentRunInput): { retryCount: number; resumeContextRef: string | null } {
  if (state.currentStatus !== "FAILED") {
    return {
      retryCount: state.retryCount,
      resumeContextRef: input.resumeContextRef === undefined ? state.resumeContextRef : input.resumeContextRef,
    };
  }
  if (state.nextAction !== "RESUME") {
    throw new Error(`Agent run cannot resume from FAILED while nextAction=${state.nextAction}`);
  }
  if (state.retryCount >= state.retryBudget) {
    throw new Error(`Agent run retry budget exhausted: ${state.retryCount}/${state.retryBudget}`);
  }
  const resumeContextRef = input.resumeContextRef === undefined ? state.resumeContextRef : input.resumeContextRef;
  const hasResumeHandle = Boolean(state.resumeToken || state.sessionId || resumeContextRef);
  if (!hasResumeHandle) {
    throw new Error("Agent run resume requires sessionId, resumeToken, or resumeContextRef");
  }
  return {
    retryCount: state.retryCount + 1,
    resumeContextRef,
  };
}

function nextEventId(status: AgentRunStatus, count: number): string {
  return `RUNEV-${status}-${String(count).padStart(4, "0")}`;
}

function persistState(filePath: string, state: AgentRunStateDocument): void {
  ensureParentDir(filePath);
  writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function appendEvent(filePath: string, event: AgentRunEventDocument): void {
  ensureParentDir(filePath);
  appendFileSync(filePath, `${JSON.stringify(event)}\n`, "utf8");
}

export function initializeAgentRun(input: InitializeAgentRunInput): AgentRunStateDocument {
  const now = input.now ?? new Date().toISOString();
  const stateFile = resolve(input.stateFile);
  const logFile = resolve(input.logFile);
  const state: AgentRunStateDocument = {
    schemaVersion: "grace-agent-run-state-v1",
    runId: input.runId,
    traceId: input.traceId,
    productId: input.productId,
    roleName: input.descriptor.roleName,
    actorRole: input.descriptor.actorRole,
    executionSequence: input.executionSequence,
    adapterKind: input.adapterKind,
    currentStatus: "DISPATCHED",
    allowedStates: [...input.allowedStates],
    inputRefs: [...input.inputRefs],
    outputRefs: [],
    taskPacketRef: input.taskPacketRef,
    invocationRef: input.invocationRef,
    stateFile,
    logFile,
    sessionId: input.sessionId ?? null,
    resumeToken: input.resumeToken ?? null,
    failureReason: null,
    failureCategory: null,
    retryBudget: normalizeRetryBudget(input.retryBudget),
    retryCount: 0,
    retryReason: null,
    resumeContextRef: input.resumeContextRef ?? null,
    nextAction: "NONE",
    startedAt: now,
    updatedAt: now,
    completedAt: null,
  };
  const event: AgentRunEventDocument = {
    schemaVersion: "grace-agent-run-event-v1",
    id: nextEventId("DISPATCHED", 1),
    runId: state.runId,
    traceId: state.traceId,
    productId: state.productId,
    roleName: state.roleName,
    actorRole: state.actorRole,
    executionSequence: state.executionSequence,
    adapterKind: state.adapterKind,
    status: "DISPATCHED",
    createdAt: now,
    inputRefs: [...state.inputRefs],
    outputRefs: [],
    sessionId: state.sessionId,
    resumeToken: state.resumeToken,
    failureReason: null,
    failureCategory: null,
    retryCount: 0,
    retryBudget: state.retryBudget,
    retryReason: null,
    resumeContextRef: state.resumeContextRef,
    nextAction: "NONE",
    notes: ["Agent run dispatched and awaiting bounded execution."],
  };
  persistState(stateFile, state);
  appendEvent(logFile, event);
  graceRuntimeLog({
    ba: BA_GRACE_AGENT_RUN_DISPATCH,
    belief: "Every agent execution should become a durable run record before any bounded role work begins",
    fact: {
      runId: state.runId,
      actorRole: state.actorRole,
      adapterKind: state.adapterKind,
      stateFile,
      logFile,
    },
  });
  return state;
}

export function updateAgentRun(input: UpdateAgentRunInput): AgentRunStateDocument {
  const stateFile = resolve(input.stateFile);
  const logFile = resolve(input.logFile);
  const now = input.now ?? new Date().toISOString();
  const state = JSON.parse(readFileSync(stateFile, "utf8")) as AgentRunStateDocument;
  assertAllowedTransition(state.currentStatus, input.status);
  const outputRefs = input.outputRefs ?? state.outputRefs;
  const failureCategory =
    input.status === "FAILED" || input.status === "BLOCKED"
      ? input.failureCategory ?? classifyFailureCategory(input.failureReason ?? state.failureReason)
      : null;
  const retryState =
    input.status === "ACTIVE"
      ? assertResumePolicy(state, input)
      : {
          retryCount: state.retryCount,
          resumeContextRef: input.resumeContextRef === undefined ? state.resumeContextRef : input.resumeContextRef,
        };
  const retryReason = input.status === "ACTIVE" && state.currentStatus === "FAILED"
    ? input.retryReason ?? "Governed retry resumed the failed agent run."
    : input.retryReason === undefined
      ? state.retryReason
      : input.retryReason;
  const nextAction = determineNextAction(input.status, failureCategory, retryState.retryCount, state.retryBudget);
  const nextState: AgentRunStateDocument = {
    ...state,
    currentStatus: input.status,
    outputRefs: [...outputRefs],
    sessionId: input.sessionId === undefined ? state.sessionId : input.sessionId,
    resumeToken: input.resumeToken === undefined ? state.resumeToken : input.resumeToken,
    failureReason: input.failureReason === undefined ? state.failureReason : input.failureReason,
    failureCategory,
    retryCount: retryState.retryCount,
    retryBudget: state.retryBudget,
    retryReason,
    resumeContextRef: retryState.resumeContextRef,
    nextAction,
    updatedAt: now,
    completedAt: input.status === "SUCCEEDED" || input.status === "FAILED" || input.status === "BLOCKED" ? now : null,
  };
  const rawLines = readLines(logFile);
  const event: AgentRunEventDocument = {
    schemaVersion: "grace-agent-run-event-v1",
    id: nextEventId(input.status, rawLines.length + 1),
    runId: nextState.runId,
    traceId: nextState.traceId,
    productId: nextState.productId,
    roleName: nextState.roleName,
    actorRole: nextState.actorRole,
    executionSequence: nextState.executionSequence,
    adapterKind: nextState.adapterKind,
    status: input.status,
    createdAt: now,
    inputRefs: [...nextState.inputRefs],
    outputRefs: [...nextState.outputRefs],
    sessionId: nextState.sessionId,
    resumeToken: nextState.resumeToken,
    failureReason: nextState.failureReason,
    failureCategory: nextState.failureCategory,
    retryCount: nextState.retryCount,
    retryBudget: nextState.retryBudget,
    retryReason: nextState.retryReason,
    resumeContextRef: nextState.resumeContextRef,
    nextAction: nextState.nextAction,
    notes: [...(input.notes ?? [])],
  };
  persistState(stateFile, nextState);
  appendEvent(logFile, event);
  graceRuntimeLog({
    ba: BA_GRACE_AGENT_RUN_TRANSITION,
    belief: "Agent run lifecycle changes must stay append-only and aligned with bounded execution outcomes",
    fact: {
      runId: nextState.runId,
      status: nextState.currentStatus,
      outputRefCount: nextState.outputRefs.length,
      failureReason: nextState.failureReason,
    },
  });
  return nextState;
}

function readLines(filePath: string): string[] {
  try {
    return readFileSync(filePath, "utf8")
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
}
