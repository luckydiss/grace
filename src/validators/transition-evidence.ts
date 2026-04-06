import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  GRACE_TRANSITION_EVENT_SCHEMA,
  GRACE_WORKFLOW_STATE_SCHEMA,
  TRANSITIONS,
  WORKFLOW_STATES,
  type TransitionEventDocument,
  type WorkflowStateDocument,
} from "../state/index.js";
import type {
  TransitionEvidenceFailure,
  TransitionEvidenceValidationInput,
  TransitionEvidenceValidationResult,
  TransitionEvidenceSummary,
} from "./index.js";

/**
 * <!-- MODULE_MAP id="MM-grace-validators" -->
 * <Layers>
 *   <Layer name="domain" package="src/validators/index.ts">
 *     Deterministic evidence validation contracts for workflow state and transition log artifacts.
 *   </Layer>
 *   <Layer name="application" package="src/validators/transition-evidence.ts">
 *     Checks workflow state, append-only transition evidence, and trace consistency for one delivery stream.
 *   </Layer>
 * </Layers>
 * <Links>
 *   <Link ref="RequirementsAnalysis.xml#UC-GRACE-TRACEABILITY" />
 *   <Link ref="DevelopmentPlan.xml#DP-SVC-grace-validators" />
 * </Links>
 * <!-- /MODULE_MAP -->
 */

/**
 * <MODULE_CONTRACT id="MC-grace-validators">
 *   <Purpose>Validate durable workflow evidence so every GRACE transition stream remains auditable end to end.</Purpose>
 *   <Links>
 *     <Link ref="RequirementsAnalysis.xml#UC-GRACE-TRACEABILITY" />
 *     <Link ref="RequirementsAnalysis.xml#NFR-GRACE-AUDITABILITY" />
 *   </Links>
 * </MODULE_CONTRACT>
 */

const MC_GRACE_VALIDATORS = "MC-grace-validators";
const FC_GRACE_VALIDATE_TRANSITION_EVIDENCE = "FC-grace-validators-validateTransitionEvidence";
const BA_GRACE_VALIDATE_TRACE = "BA-grace-validate-trace";
const BA_GRACE_VALIDATE_ARTIFACTS = "BA-grace-validate-artifacts";

const DEFAULT_STATE_FILE = "docs/grace/state/WorkflowState.json";
const DEFAULT_EVENT_LOG = "docs/grace/state/TransitionLog.jsonl";

function graceRuntimeLog(entry: {
  ba: string;
  belief: string;
  fact: Record<string, unknown>;
}): void {
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      layer: "runtime",
      mc: MC_GRACE_VALIDATORS,
      fc: FC_GRACE_VALIDATE_TRANSITION_EVIDENCE,
      ...entry,
    }),
  );
}

function buildFailure(code: TransitionEvidenceFailure["code"], message: string): TransitionEvidenceFailure {
  return { code, message };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isWorkflowStateDocument(value: unknown): value is WorkflowStateDocument {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    candidate.schemaVersion === GRACE_WORKFLOW_STATE_SCHEMA &&
    typeof candidate.productId === "string" &&
    typeof candidate.traceId === "string" &&
    typeof candidate.currentState === "string" &&
    WORKFLOW_STATES.includes(candidate.currentState as (typeof WORKFLOW_STATES)[number]) &&
    typeof candidate.currentActor === "string" &&
    typeof candidate.updatedAt === "string" &&
    (typeof candidate.activeHandoffRef === "string" || candidate.activeHandoffRef === null) &&
    (typeof candidate.activeCwoRef === "string" || candidate.activeCwoRef === null) &&
    typeof candidate.blocked === "boolean" &&
    isStringArray(candidate.blockReasons)
  );
}

function isTransitionEventDocument(value: unknown): value is TransitionEventDocument {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    candidate.schemaVersion === GRACE_TRANSITION_EVENT_SCHEMA &&
    typeof candidate.id === "string" &&
    typeof candidate.traceId === "string" &&
    typeof candidate.productId === "string" &&
    typeof candidate.transition === "string" &&
    TRANSITIONS.includes(candidate.transition as (typeof TRANSITIONS)[number]) &&
    typeof candidate.from === "string" &&
    WORKFLOW_STATES.includes(candidate.from as (typeof WORKFLOW_STATES)[number]) &&
    typeof candidate.to === "string" &&
    WORKFLOW_STATES.includes(candidate.to as (typeof WORKFLOW_STATES)[number]) &&
    typeof candidate.actor === "string" &&
    typeof candidate.createdAt === "string" &&
    isStringArray(candidate.artifactRefs) &&
    isStringArray(candidate.notes)
  );
}

function loadStateDocument(stateFilePath: string): { state: WorkflowStateDocument | null; failures: TransitionEvidenceFailure[] } {
  if (!existsSync(stateFilePath)) {
    return {
      state: null,
      failures: [buildFailure("STATE_FILE_MISSING", `Workflow state file does not exist: ${stateFilePath}`)],
    };
  }

  const raw = JSON.parse(readFileSync(stateFilePath, "utf8")) as unknown;
  if (!isWorkflowStateDocument(raw)) {
    return {
      state: null,
      failures: [buildFailure("STATE_SCHEMA_INVALID", "Workflow state document is malformed or has an unexpected schemaVersion.")],
    };
  }

  return { state: raw, failures: [] };
}

function loadTransitionEvents(transitionLogPath: string): { events: TransitionEventDocument[]; failures: TransitionEvidenceFailure[] } {
  if (!existsSync(transitionLogPath)) {
    return {
      events: [],
      failures: [buildFailure("TRANSITION_LOG_MISSING", `Transition log file does not exist: ${transitionLogPath}`)],
    };
  }

  const lines = readFileSync(transitionLogPath, "utf8")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    return {
      events: [],
      failures: [buildFailure("TRANSITION_LOG_MISSING", `Transition log file is empty: ${transitionLogPath}`)],
    };
  }

  const failures: TransitionEvidenceFailure[] = [];
  const events: TransitionEventDocument[] = [];
  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      failures.push(buildFailure("TRANSITION_EVENT_INVALID", "Transition log contains a line that is not valid JSON."));
      continue;
    }

    if (!isTransitionEventDocument(parsed)) {
      failures.push(buildFailure("TRANSITION_EVENT_INVALID", "Transition log contains a malformed transition event."));
      continue;
    }
    events.push(parsed);
  }

  return { events, failures };
}

function summarizeEvidence(state: WorkflowStateDocument, events: TransitionEventDocument[]): TransitionEvidenceSummary {
  return {
    eventCount: events.length,
    finalState: state.currentState,
    actors: [...new Set(events.map((event) => event.actor))],
    transitions: [...new Set(events.map((event) => event.transition))],
  };
}

function hasRequiredArtifactRef(events: TransitionEventDocument[], requiredRef: string): boolean {
  return events.some((event) => event.artifactRefs.some((artifactRef) => artifactRef.startsWith(requiredRef)));
}

function approvalEventsCarryEvidence(events: TransitionEventDocument[], approvalArtifactRef: string): boolean {
  return events
    .filter((event) => event.transition === "approve_handoff")
    .every((event) => event.artifactRefs.some((artifactRef) => artifactRef.startsWith(approvalArtifactRef)));
}

/**
 * <FUNCTION_CONTRACT id="FC-grace-validators-validateTransitionEvidence">
 *   <Intent>Validate the canonical workflow state and append-only transition log for one trace so auditors can reconstruct the exact delivery stream.</Intent>
 *   <Inputs>
 *     <Input name="input">Product id, trace id, evidence paths, and optional required artifact ref prefixes.</Input>
 *   </Inputs>
 *   <Outputs>
 *     <Output name="result">Deterministic validation verdict, parsed evidence, and audit summary.</Output>
 *   </Outputs>
 *   <BlockAnchors>
 *     <BA ref="BA-grace-validate-trace" />
 *     <BA ref="BA-grace-validate-artifacts" />
 *   </BlockAnchors>
 *   <Links>
 *     <Link ref="RequirementsAnalysis.xml#UC-GRACE-TRACEABILITY" />
 *   </Links>
 * </FUNCTION_CONTRACT>
 */
export function validateTransitionEvidence(input: TransitionEvidenceValidationInput): TransitionEvidenceValidationResult {
  const stateFilePath = resolve(input.stateFile ?? DEFAULT_STATE_FILE);
  const transitionLogPath = resolve(input.transitionLogFile ?? DEFAULT_EVENT_LOG);

  /* <BLOCK_ANCHOR id="BA-grace-validate-trace" purpose="Validate workflow state and append-only transition evidence for one product trace" /> */
  const stateResult = loadStateDocument(stateFilePath);
  const eventResult = loadTransitionEvents(transitionLogPath);
  const traceFailures = [...stateResult.failures, ...eventResult.failures];

  if (stateResult.state !== null) {
    if (stateResult.state.productId !== input.productId) {
      traceFailures.push(buildFailure("PRODUCT_MISMATCH", `Workflow state productId must equal ${input.productId}.`));
    }
    if (stateResult.state.traceId !== input.traceId) {
      traceFailures.push(buildFailure("TRACE_MISMATCH", `Workflow state traceId must equal ${input.traceId}.`));
    }
    if (stateResult.state.currentState === "BLOCKED" && stateResult.state.blocked !== true) {
      traceFailures.push(buildFailure("BLOCKED_STATE_INCONSISTENT", "Workflow state BLOCKED must also set blocked=true."));
    }
    if (stateResult.state.currentState !== "BLOCKED" && stateResult.state.blocked === true) {
      traceFailures.push(buildFailure("BLOCKED_STATE_INCONSISTENT", "Workflow state with blocked=true must use currentState=BLOCKED."));
    }
  }

  for (const event of eventResult.events) {
    if (event.productId !== input.productId) {
      traceFailures.push(buildFailure("PRODUCT_MISMATCH", `Transition event ${event.id} productId must equal ${input.productId}.`));
    }
    if (event.traceId !== input.traceId) {
      traceFailures.push(buildFailure("TRACE_MISMATCH", `Transition event ${event.id} traceId must equal ${input.traceId}.`));
    }
  }

  if (stateResult.state !== null && eventResult.events.length > 0) {
    const lastEvent = eventResult.events[eventResult.events.length - 1];
    if (lastEvent.to !== stateResult.state.currentState) {
      traceFailures.push(
        buildFailure(
          "FINAL_STATE_MISMATCH",
          `Workflow state currentState ${stateResult.state.currentState} must equal last transition target ${lastEvent.to}.`,
        ),
      );
    }
  }

  graceRuntimeLog({
    ba: BA_GRACE_VALIDATE_TRACE,
    belief: "Workflow evidence is auditable only when persisted state and append-only transition log agree on one product trace",
    fact: {
      stateFile: stateFilePath,
      transitionLog: transitionLogPath,
      stateLoaded: stateResult.state !== null,
      eventCount: eventResult.events.length,
      failureCount: traceFailures.length,
    },
  });

  /* <BLOCK_ANCHOR id="BA-grace-validate-artifacts" purpose="Validate that required artifact refs are present in the transition evidence chain" /> */
  const artifactFailures: TransitionEvidenceFailure[] = [];
  for (const requiredRef of input.requiredArtifactRefs ?? []) {
    if (!hasRequiredArtifactRef(eventResult.events, requiredRef)) {
      artifactFailures.push(buildFailure("ARTIFACT_REF_MISSING", `Missing required artifact ref prefix in transition evidence: ${requiredRef}`));
    }
  }
  if (!approvalEventsCarryEvidence(eventResult.events, input.approvalArtifactRef ?? "docs/grace/approvals.log")) {
    artifactFailures.push(
      buildFailure("APPROVAL_ARTIFACT_MISSING", "approve_handoff transition must leave a matching approvals.log artifact ref in durable evidence."),
    );
  }
  graceRuntimeLog({
    ba: BA_GRACE_VALIDATE_ARTIFACTS,
    belief: "Traceability is complete only when required artifact refs appear in the durable transition evidence chain",
    fact: {
      requiredArtifactRefs: input.requiredArtifactRefs ?? [],
      failureCount: artifactFailures.length,
    },
  });

  const failures = [...traceFailures, ...artifactFailures];
  if (failures.length > 0 || stateResult.state === null) {
    return {
      ok: false,
      failures,
      summary: stateResult.state === null ? null : summarizeEvidence(stateResult.state, eventResult.events),
      state: stateResult.state,
      events: eventResult.events,
    };
  }

  return {
    ok: true,
    failures: [],
    summary: summarizeEvidence(stateResult.state, eventResult.events),
    state: stateResult.state,
    events: eventResult.events,
  };
}
