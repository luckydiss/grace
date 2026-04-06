import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureParentDir, readJsonIfExists } from "../runtime/fs-utils.js";
import { emitGraceRuntimeLog } from "../runtime/runtime-log.js";
import { applyTransition } from "../state/transition-engine.js";
import type { AutonomyRecoveryInput, AutonomyRecoveryResult } from "./index.js";

/**
 * <!-- MODULE_MAP id="MM-grace-autonomy-bridge" -->
 * <Layers>
 *   <Layer name="domain" package="src/autonomy/index.ts">
 *     Contracts for governed remediation after verification failure.
 *   </Layer>
 *   <Layer name="application" package="src/autonomy/recovery-bridge.ts">
 *     Bridges failure-memory, forced-context, and loop-guard artifacts into explicit remediation transitions.
 *   </Layer>
 * </Layers>
 * <Links>
 *   <Link ref="RequirementsAnalysis.xml#UC-GRACE-FAILURE-RECOVERY" />
 *   <Link ref="DevelopmentPlan.xml#DP-SVC-grace-autonomy-bridge" />
 * </Links>
 * <!-- /MODULE_MAP -->
 */

/**
 * <MODULE_CONTRACT id="MC-grace-autonomy-bridge">
 *   <Purpose>Convert repeated failures into explicit remediation or blocked states using durable W11-style artifacts.</Purpose>
 *   <Links>
 *     <Link ref="RequirementsAnalysis.xml#UC-GRACE-FAILURE-RECOVERY" />
 *     <Link ref="Technology.xml#DEC-GRACE-EVIDENCE-001" />
 *   </Links>
 * </MODULE_CONTRACT>
 */

const MC_GRACE_AUTONOMY_BRIDGE = "MC-grace-autonomy-bridge";
const FC_GRACE_AUTONOMY_EXECUTE_RECOVERY = "FC-grace-autonomy-executeRecovery";
const BA_GRACE_APPEND_FAILURE_MEMORY = "BA-grace-append-failure-memory";
const BA_GRACE_BUILD_FORCED_CONTEXT = "BA-grace-build-forced-context";
const BA_GRACE_EVALUATE_LOOP_GUARD = "BA-grace-evaluate-loop-guard";

interface FailureMemoryRecord {
  id: string;
  traceId?: string;
  semanticScope: string;
  testId: string;
  errorSignature: string;
  failedHypothesis?: string;
  rejectedFixPattern?: string;
  verifiedRecovery?: string;
  evidenceRefs: string[];
  createdAt: string;
  firstSeen: string;
  lastSeen: string;
  occurrenceCount: number;
}

interface FailureMemoryDocument {
  schemaVersion: string;
  generatedAt: string;
  records: FailureMemoryRecord[];
}

function graceRuntimeLog(entry: {
  ba: string;
  belief: string;
  fact: Record<string, unknown>;
}): void {
  emitGraceRuntimeLog({
    mc: MC_GRACE_AUTONOMY_BRIDGE,
    fc: FC_GRACE_AUTONOMY_EXECUTE_RECOVERY,
    ...entry,
  });
}

function loadFailureMemory(memoryFile: string): FailureMemoryDocument {
  return readJsonIfExists<FailureMemoryDocument>(memoryFile) ?? {
    schemaVersion: "grace-failure-memory-v1",
    generatedAt: new Date().toISOString(),
    records: [],
  };
}

function saveJson(filePath: string, value: unknown): void {
  ensureParentDir(filePath);
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function appendFailureMemory(input: AutonomyRecoveryInput): { record: FailureMemoryRecord; artifactRef: string } {
  const memoryFile = resolve(input.failureMemoryFile);
  const document = loadFailureMemory(memoryFile);
  const now = new Date().toISOString();
  const existing = document.records.find((record) =>
    record.semanticScope === input.scope &&
    record.testId === input.testId &&
    record.errorSignature === input.errorSignature,
  );
  if (existing) {
    existing.lastSeen = now;
    existing.occurrenceCount += 1;
    existing.failedHypothesis = input.failedHypothesis ?? existing.failedHypothesis;
    existing.rejectedFixPattern = input.rejectedFixPattern ?? existing.rejectedFixPattern;
    existing.verifiedRecovery = input.verifiedRecovery ?? existing.verifiedRecovery;
    existing.evidenceRefs = Array.from(new Set([...existing.evidenceRefs, ...input.evidenceRefs]));
    document.generatedAt = now;
    saveJson(memoryFile, document);
    return {
      record: existing,
      artifactRef: "docs/grace/reports/failure-memory.json",
    };
  }

  const record: FailureMemoryRecord = {
    id: `FM-${document.records.length + 1}`,
    traceId: input.traceId,
    semanticScope: input.scope,
    testId: input.testId,
    errorSignature: input.errorSignature,
    failedHypothesis: input.failedHypothesis,
    rejectedFixPattern: input.rejectedFixPattern,
    verifiedRecovery: input.verifiedRecovery,
    evidenceRefs: Array.from(new Set(input.evidenceRefs)),
    createdAt: now,
    firstSeen: now,
    lastSeen: now,
    occurrenceCount: 1,
  };
  document.generatedAt = now;
  document.records.push(record);
  saveJson(memoryFile, document);
  return {
    record,
    artifactRef: "docs/grace/reports/failure-memory.json",
  };
}

function buildForcedContext(input: AutonomyRecoveryInput, document: FailureMemoryDocument): { count: number; artifactRef: string } {
  const bundle = document.records.filter((record) =>
    record.semanticScope === input.scope &&
    record.testId === input.testId,
  );
  saveJson(resolve(input.forcedContextFile), {
    schemaVersion: "grace-forced-context-bundle-v1",
    traceId: input.traceId,
    status: "CONTEXT_BUNDLE_READY",
    memoryPath: resolve(input.failureMemoryFile),
    count: bundle.length,
    scope: input.scope,
    testId: input.testId,
    errorSignature: input.errorSignature,
    bundle,
  });
  return {
    count: bundle.length,
    artifactRef: "docs/grace/reports/forced-context.json",
  };
}

function evaluateLoopGuard(input: AutonomyRecoveryInput, document: FailureMemoryDocument, forcedContextCount: number): {
  status: "ALLOW" | "ESCALATE_WITH_CONTEXT" | "BLOCK";
  blockReasons: string[];
  artifactRef: string;
} {
  const relevant = document.records.filter((record) =>
    record.semanticScope === input.scope &&
    record.testId === input.testId &&
    record.errorSignature === input.errorSignature,
  );
  const repeatedRejectedFix = Boolean(
    input.proposedFix &&
    relevant.some((record) => record.rejectedFixPattern && record.rejectedFixPattern === input.proposedFix),
  );
  const thresholdReached = input.retryCount >= input.retryBudget;
  const forcedContextLoaded = forcedContextCount > 0;
  const blockReasons: string[] = [];

  if (repeatedRejectedFix) {
    blockReasons.push("REJECTED_FIX_PATTERN_REPEATED");
  }
  if (thresholdReached && !forcedContextLoaded) {
    blockReasons.push("FORCED_CONTEXT_REQUIRED");
  }
  if (input.retryCount > input.retryBudget) {
    blockReasons.push("RETRY_BUDGET_EXHAUSTED");
  }

  const status = blockReasons.length > 0 ? "BLOCK" : thresholdReached ? "ESCALATE_WITH_CONTEXT" : "ALLOW";
  saveJson(resolve(input.loopGuardFile), {
    schemaVersion: "grace-loop-guard-verdict-v1",
    traceId: input.traceId,
    status,
    retryCount: input.retryCount,
    retryBudget: input.retryBudget,
    forcedContextLoaded,
    matchingRecords: relevant.length,
    blockReasons,
    scope: input.scope,
    testId: input.testId,
    errorSignature: input.errorSignature,
  });
  return {
    status,
    blockReasons,
    artifactRef: "docs/grace/reports/loop-guard.json",
  };
}

/**
 * <FUNCTION_CONTRACT id="FC-grace-autonomy-executeRecovery">
 *   <Intent>Bridge a captured failure into failure-memory, forced-context, and loop-guard artifacts, then reopen remediation only when governance allows it.</Intent>
 *   <Inputs>
 *     <Input name="input">Failure identity, retry metadata, evidence refs, and workflow persistence paths.</Input>
 *   </Inputs>
 *   <Outputs>
 *     <Output name="result">Final remediation state, emitted artifacts, and loop-guard verdict.</Output>
 *   </Outputs>
 *   <BlockAnchors>
 *     <BA ref="BA-grace-append-failure-memory" />
 *     <BA ref="BA-grace-build-forced-context" />
 *     <BA ref="BA-grace-evaluate-loop-guard" />
 *   </BlockAnchors>
 *   <Links>
 *     <Link ref="RequirementsAnalysis.xml#UC-GRACE-FAILURE-RECOVERY" />
 *     <Link ref="DevelopmentPlan.xml#Flow-GRACE-FailureBranch" />
 *   </Links>
 * </FUNCTION_CONTRACT>
 */
export function executeRecoveryBridge(input: AutonomyRecoveryInput): AutonomyRecoveryResult {
  /* <BLOCK_ANCHOR id="BA-grace-append-failure-memory" purpose="Append or update deterministic failure-memory evidence for the captured failure" /> */
  const memory = appendFailureMemory(input);
  const appendTransition = applyTransition({
    productId: input.productId,
    traceId: input.traceId,
    actor: "COORDINATOR",
    transition: "append_failure_memory",
    stateFile: input.stateFile,
    transitionLogFile: input.transitionLogFile,
    policyFile: input.policyFile,
    issueReportFile: input.issueReportFile,
    artifactRefs: [memory.artifactRef],
  });
  graceRuntimeLog({
    ba: BA_GRACE_APPEND_FAILURE_MEMORY,
    belief: "A captured failure must first become durable failure-memory before remediation can continue",
    fact: {
      currentState: appendTransition.state.currentState,
      failureMemory: memory.artifactRef,
      recordId: memory.record.id,
    },
  });

  /* <BLOCK_ANCHOR id="BA-grace-build-forced-context" purpose="Build a forced-context bundle from failure-memory before evaluating another remediation attempt" /> */
  const memoryDocument = loadFailureMemory(resolve(input.failureMemoryFile));
  const forcedContext = buildForcedContext(input, memoryDocument);
  const contextTransition = applyTransition({
    productId: input.productId,
    traceId: input.traceId,
    actor: "COORDINATOR",
    transition: "inject_forced_context",
    stateFile: input.stateFile,
    transitionLogFile: input.transitionLogFile,
    policyFile: input.policyFile,
    issueReportFile: input.issueReportFile,
    artifactRefs: [memory.artifactRef, forcedContext.artifactRef],
  });
  graceRuntimeLog({
    ba: BA_GRACE_BUILD_FORCED_CONTEXT,
    belief: "Repeated remediation attempts must carry forward structured context from prior failures",
    fact: {
      currentState: contextTransition.state.currentState,
      forcedContextCount: forcedContext.count,
      forcedContext: forcedContext.artifactRef,
    },
  });

  /* <BLOCK_ANCHOR id="BA-grace-evaluate-loop-guard" purpose="Evaluate retry budget and rejected fix history before reopening remediation" /> */
  const loopGuard = evaluateLoopGuard(input, memoryDocument, forcedContext.count);
  const loopTransition = applyTransition({
    productId: input.productId,
    traceId: input.traceId,
    actor: "COORDINATOR",
    transition: "evaluate_loop_guard",
    stateFile: input.stateFile,
    transitionLogFile: input.transitionLogFile,
    policyFile: input.policyFile,
    issueReportFile: input.issueReportFile,
    artifactRefs: [memory.artifactRef, forcedContext.artifactRef, loopGuard.artifactRef],
  });
  const finalTransition = applyTransition({
    productId: input.productId,
    traceId: input.traceId,
    actor: "COORDINATOR",
    transition: loopGuard.status === "BLOCK" ? "block_remediation" : "allow_remediation",
    stateFile: input.stateFile,
    transitionLogFile: input.transitionLogFile,
    policyFile: input.policyFile,
    issueReportFile: input.issueReportFile,
    artifactRefs: [memory.artifactRef, forcedContext.artifactRef, loopGuard.artifactRef],
  });
  graceRuntimeLog({
    ba: BA_GRACE_EVALUATE_LOOP_GUARD,
    belief: "Loop-guard verdicts decide whether remediation reopens or the workflow stays blocked",
    fact: {
      loopGuardStatus: loopGuard.status,
      currentState: finalTransition.state.currentState,
      blockReasons: loopGuard.blockReasons,
    },
  });

  return {
    currentState: finalTransition.state.currentState as "REMEDIATION_READY" | "BLOCKED",
    transitionHistory: [
      appendTransition.event.transition,
      contextTransition.event.transition,
      loopTransition.event.transition,
      finalTransition.event.transition,
    ],
    artifactRefs: [memory.artifactRef, forcedContext.artifactRef, loopGuard.artifactRef],
    forcedContextCount: forcedContext.count,
    loopGuardStatus: loopGuard.status,
    blockReasons: loopGuard.blockReasons,
  };
}
