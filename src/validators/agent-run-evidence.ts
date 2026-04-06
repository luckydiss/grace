import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { toRepoArtifactRef } from "../runtime/product-target.js";
import type { AgentRunEventDocument, AgentRunStateDocument, AgentRunStatus } from "../agents/agent-run.js";
import type {
  AgentRunEvidenceFailure,
  AgentRunEvidenceValidationInput,
  AgentRunEvidenceValidationResult,
} from "./index.js";

const ROLE_FILE_PREFIX: Record<AgentRunEvidenceValidationInput["requiredRoles"][number], string> = {
  ARCHITECT: "Architect",
  COORDINATOR: "Coordinator",
  CODER: "Coder",
};

function buildFailure(code: AgentRunEvidenceFailure["code"], message: string): AgentRunEvidenceFailure {
  return { code, message };
}

function validateStateFile(filePath: string): AgentRunEvidenceFailure | null {
  if (!existsSync(filePath)) {
    return buildFailure("AGENT_RUN_STATE_MISSING", `Missing required agent run state artifact: ${filePath}`);
  }
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Partial<AgentRunStateDocument>;
  if (
    parsed.schemaVersion !== "grace-agent-run-state-v1" ||
    typeof parsed.currentStatus !== "string" ||
    typeof parsed.retryCount !== "number" ||
    typeof parsed.retryBudget !== "number" ||
    typeof parsed.nextAction !== "string"
  ) {
    return buildFailure("AGENT_RUN_STATE_INVALID", `Agent run state artifact is invalid: ${filePath}`);
  }
  if (parsed.retryCount > parsed.retryBudget) {
    return buildFailure("AGENT_RUN_RETRY_BUDGET_EXCEEDED", `Agent run state exceeded retry budget: ${filePath}`);
  }
  return null;
}

function validateLogFile(filePath: string): AgentRunEvidenceFailure | null {
  if (!existsSync(filePath)) {
    return buildFailure("AGENT_RUN_LOG_MISSING", `Missing required agent run log artifact: ${filePath}`);
  }
  const lines = readFileSync(filePath, "utf8")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    return buildFailure("AGENT_RUN_LOG_INVALID", `Agent run log artifact is empty: ${filePath}`);
  }
  const events = lines.map((line) => JSON.parse(line) as Partial<AgentRunEventDocument>);
  const statuses = events.map((event) => event.status);
  if (statuses[0] !== "DISPATCHED" || !statuses.includes("ACTIVE")) {
    return buildFailure("AGENT_RUN_LOG_INVALID", `Agent run log artifact is missing required lifecycle statuses: ${filePath}`);
  }
  const allowedTransitions: Record<AgentRunStatus, AgentRunStatus[]> = {
    DISPATCHED: ["ACTIVE", "FAILED", "BLOCKED"],
    ACTIVE: ["SUCCEEDED", "FAILED", "BLOCKED"],
    FAILED: ["ACTIVE"],
    BLOCKED: [],
    SUCCEEDED: [],
  };
  let maxRetryCount = 0;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (
      event.schemaVersion !== "grace-agent-run-event-v1" ||
      typeof event.status !== "string" ||
      typeof event.retryCount !== "number" ||
      typeof event.retryBudget !== "number" ||
      typeof event.nextAction !== "string"
    ) {
      return buildFailure("AGENT_RUN_LOG_INVALID", `Agent run log artifact contains a malformed lifecycle event: ${filePath}`);
    }
    maxRetryCount = Math.max(maxRetryCount, event.retryCount);
    if (event.retryCount > event.retryBudget) {
      return buildFailure("AGENT_RUN_RETRY_BUDGET_EXCEEDED", `Agent run log exceeded retry budget in: ${filePath}`);
    }
    if (index === 0) {
      continue;
    }
    const previous = events[index - 1];
    if (!previous.status || !allowedTransitions[previous.status as AgentRunStatus]?.includes(event.status as AgentRunStatus)) {
      return buildFailure(
        "AGENT_RUN_TRANSITION_INVALID",
        `Agent run log contains an illegal transition ${String(previous.status)} -> ${String(event.status)} in: ${filePath}`,
      );
    }
  }
  return null;
}

export function validateAgentRunEvidence(input: AgentRunEvidenceValidationInput): AgentRunEvidenceValidationResult {
  const executionDir = resolve(input.executionDir);
  const failures: AgentRunEvidenceFailure[] = [];
  const artifactRefs: string[] = [];

  for (const role of input.requiredRoles) {
    const prefix = ROLE_FILE_PREFIX[role];
    const stateFile = join(executionDir, `${prefix}RunState-Workflow-0001.json`);
    const logFile = join(executionDir, `${prefix}RunLog-Workflow-0001.jsonl`);

    for (const [filePath, validator] of [
      [stateFile, validateStateFile],
      [logFile, validateLogFile],
    ] as const) {
      const failure = validator(filePath);
      if (failure !== null) {
        failures.push(failure);
      } else {
        artifactRefs.push(toRepoArtifactRef(input.repoRoot, filePath));
      }
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    artifactRefs,
  };
}
