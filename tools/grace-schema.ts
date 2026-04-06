import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface RuntimeEvidenceLine {
  mc?: string;
  uc?: string;
  fc?: string;
  ba?: string;
  belief?: string;
  fact?: Record<string, unknown>;
}

interface FailedTestEnvelope {
  testId: string;
  errorSignature: string;
  semanticScope: string;
  fcIds: string[];
  baIds: string[];
  evidenceRefs: string[];
  runtimeEvidence: RuntimeEvidenceLine[];
}

interface FailureEnvelope {
  schemaVersion: string;
  traceId?: string;
  status: "FAILED" | "PASSED";
  command: string;
  exitCode: number | null;
  failedTests: FailedTestEnvelope[];
  stdout: string;
  stderr: string;
}

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

interface ForcedContextBundle {
  schemaVersion: string;
  traceId?: string;
  status: "CONTEXT_BUNDLE_READY";
  memoryPath: string;
  count: number;
  scope?: string;
  testId?: string;
  errorSignature?: string;
  bundle: FailureMemoryRecord[];
}

interface LoopGuardVerdict {
  schemaVersion: string;
  traceId?: string;
  status: "ALLOW" | "ESCALATE_WITH_CONTEXT" | "BLOCK";
  retryCount: number;
  retryBudget: number;
  forcedContextLoaded: boolean;
  matchingRecords: number;
  blockReasons: string[];
  scope?: string;
  testId?: string;
  errorSignature?: string;
}

type SkillTraceActorRole = "ARCHITECT" | "COORDINATOR" | "CODER";
type SkillTraceStatus = "LOADED" | "APPLIED";
type SkillTraceSource = "MANDATORY_MODE" | "MANDATORY_PROTOCOL" | "OPTIONAL" | "CHAINED";

interface SkillTraceEvent {
  id: string;
  skill: string;
  status: SkillTraceStatus;
  source: SkillTraceSource;
  invokedAt: string;
  trigger: string;
  parentSkill?: string;
}

interface SkillTraceDocument {
  schemaVersion: string;
  traceId: string;
  executionId: string;
  actorRole: SkillTraceActorRole;
  executionSequence: number;
  generatedAt: string;
  events: SkillTraceEvent[];
}

type SchemaType = "failure-envelope" | "failure-memory" | "forced-context-bundle" | "loop-guard-verdict" | "skill-trace";

function fail(message: string): never {
  throw new Error(`SCHEMA_VALIDATION_ERROR ${message}`);
}

function assertObject(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${path} must be an object`);
  }
}

function assertString(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${path} must be a non-empty string`);
  }
}

function assertOptionalString(value: unknown, path: string): void {
  if (value !== undefined && value !== null && typeof value !== "string") {
    fail(`${path} must be a string when present`);
  }
}

function assertBoolean(value: unknown, path: string): asserts value is boolean {
  if (typeof value !== "boolean") {
    fail(`${path} must be a boolean`);
  }
}

function assertInteger(value: unknown, path: string, min?: number): asserts value is number {
  if (!Number.isInteger(value)) {
    fail(`${path} must be an integer`);
  }
  const numericValue = value as number;
  if (min !== undefined && numericValue < min) {
    fail(`${path} must be >= ${min}`);
  }
}

function assertArray(value: unknown, path: string): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    fail(`${path} must be an array`);
  }
}

function assertStringArray(value: unknown, path: string): asserts value is string[] {
  assertArray(value, path);
  value.forEach((item, index) => assertString(item, `${path}[${index}]`));
}

function validateRuntimeEvidenceLine(value: unknown, path: string): void {
  assertObject(value, path);
  assertOptionalString(value.mc, `${path}.mc`);
  assertOptionalString(value.uc, `${path}.uc`);
  assertOptionalString(value.fc, `${path}.fc`);
  assertOptionalString(value.ba, `${path}.ba`);
  assertOptionalString(value.belief, `${path}.belief`);
  if (value.fact !== undefined && value.fact !== null && (typeof value.fact !== "object" || Array.isArray(value.fact))) {
    fail(`${path}.fact must be an object when present`);
  }
}

function validateFailureMemoryRecordValue(value: unknown, path: string): void {
  assertObject(value, path);
  assertString(value.id, `${path}.id`);
  assertOptionalString(value.traceId, `${path}.traceId`);
  assertString(value.semanticScope, `${path}.semanticScope`);
  assertString(value.testId, `${path}.testId`);
  assertString(value.errorSignature, `${path}.errorSignature`);
  assertOptionalString(value.failedHypothesis, `${path}.failedHypothesis`);
  assertOptionalString(value.rejectedFixPattern, `${path}.rejectedFixPattern`);
  assertOptionalString(value.verifiedRecovery, `${path}.verifiedRecovery`);
  assertStringArray(value.evidenceRefs, `${path}.evidenceRefs`);
  assertString(value.createdAt, `${path}.createdAt`);
  assertString(value.firstSeen, `${path}.firstSeen`);
  assertString(value.lastSeen, `${path}.lastSeen`);
  assertInteger(value.occurrenceCount, `${path}.occurrenceCount`, 1);
}

function validateFailureEnvelopeValue(value: unknown): FailureEnvelope {
  assertObject(value, "failureEnvelope");
  assertString(value.schemaVersion, "failureEnvelope.schemaVersion");
  if (value.schemaVersion !== "grace-failure-envelope-v1") {
    fail(`failureEnvelope.schemaVersion must equal grace-failure-envelope-v1`);
  }
  assertOptionalString(value.traceId, "failureEnvelope.traceId");
  if (value.status !== "FAILED" && value.status !== "PASSED") {
    fail("failureEnvelope.status must equal FAILED or PASSED");
  }
  assertString(value.command, "failureEnvelope.command");
  if (value.exitCode !== null) {
    assertInteger(value.exitCode, "failureEnvelope.exitCode");
  }
  assertArray(value.failedTests, "failureEnvelope.failedTests");
  value.failedTests.forEach((item, index) => {
    const path = `failureEnvelope.failedTests[${index}]`;
    assertObject(item, path);
    assertString(item.testId, `${path}.testId`);
    assertString(item.errorSignature, `${path}.errorSignature`);
    assertString(item.semanticScope, `${path}.semanticScope`);
    assertStringArray(item.fcIds, `${path}.fcIds`);
    assertStringArray(item.baIds, `${path}.baIds`);
    assertStringArray(item.evidenceRefs, `${path}.evidenceRefs`);
    assertArray(item.runtimeEvidence, `${path}.runtimeEvidence`);
    item.runtimeEvidence.forEach((line, evidenceIndex) => validateRuntimeEvidenceLine(line, `${path}.runtimeEvidence[${evidenceIndex}]`));
  });
  if (typeof value.stdout !== "string" || typeof value.stderr !== "string") {
    fail("failureEnvelope.stdout and failureEnvelope.stderr must be strings");
  }
  return value as unknown as FailureEnvelope;
}

function validateFailureMemoryDocumentValue(value: unknown): FailureMemoryDocument {
  assertObject(value, "failureMemory");
  assertString(value.schemaVersion, "failureMemory.schemaVersion");
  if (value.schemaVersion !== "grace-failure-memory-v1") {
    fail(`failureMemory.schemaVersion must equal grace-failure-memory-v1`);
  }
  assertString(value.generatedAt, "failureMemory.generatedAt");
  assertArray(value.records, "failureMemory.records");
  value.records.forEach((record, index) => validateFailureMemoryRecordValue(record, `failureMemory.records[${index}]`));
  return value as unknown as FailureMemoryDocument;
}

function validateForcedContextBundleValue(value: unknown): ForcedContextBundle {
  assertObject(value, "forcedContextBundle");
  assertString(value.schemaVersion, "forcedContextBundle.schemaVersion");
  if (value.schemaVersion !== "grace-forced-context-bundle-v1") {
    fail(`forcedContextBundle.schemaVersion must equal grace-forced-context-bundle-v1`);
  }
  assertOptionalString(value.traceId, "forcedContextBundle.traceId");
  if (value.status !== "CONTEXT_BUNDLE_READY") {
    fail("forcedContextBundle.status must equal CONTEXT_BUNDLE_READY");
  }
  assertString(value.memoryPath, "forcedContextBundle.memoryPath");
  assertInteger(value.count, "forcedContextBundle.count", 0);
  assertOptionalString(value.scope, "forcedContextBundle.scope");
  assertOptionalString(value.testId, "forcedContextBundle.testId");
  assertOptionalString(value.errorSignature, "forcedContextBundle.errorSignature");
  assertArray(value.bundle, "forcedContextBundle.bundle");
  value.bundle.forEach((record, index) => validateFailureMemoryRecordValue(record, `forcedContextBundle.bundle[${index}]`));
  return value as unknown as ForcedContextBundle;
}

function validateLoopGuardVerdictValue(value: unknown): LoopGuardVerdict {
  assertObject(value, "loopGuardVerdict");
  assertString(value.schemaVersion, "loopGuardVerdict.schemaVersion");
  if (value.schemaVersion !== "grace-loop-guard-verdict-v1") {
    fail(`loopGuardVerdict.schemaVersion must equal grace-loop-guard-verdict-v1`);
  }
  assertOptionalString(value.traceId, "loopGuardVerdict.traceId");
  if (value.status !== "ALLOW" && value.status !== "ESCALATE_WITH_CONTEXT" && value.status !== "BLOCK") {
    fail("loopGuardVerdict.status must equal ALLOW, ESCALATE_WITH_CONTEXT, or BLOCK");
  }
  assertInteger(value.retryCount, "loopGuardVerdict.retryCount", 0);
  assertInteger(value.retryBudget, "loopGuardVerdict.retryBudget", 0);
  assertBoolean(value.forcedContextLoaded, "loopGuardVerdict.forcedContextLoaded");
  assertInteger(value.matchingRecords, "loopGuardVerdict.matchingRecords", 0);
  assertStringArray(value.blockReasons, "loopGuardVerdict.blockReasons");
  assertOptionalString(value.scope, "loopGuardVerdict.scope");
  assertOptionalString(value.testId, "loopGuardVerdict.testId");
  assertOptionalString(value.errorSignature, "loopGuardVerdict.errorSignature");
  return value as unknown as LoopGuardVerdict;
}

function validateSkillTraceDocumentValue(value: unknown): SkillTraceDocument {
  assertObject(value, "skillTrace");
  assertString(value.schemaVersion, "skillTrace.schemaVersion");
  if (value.schemaVersion !== "grace-skill-trace-v1") {
    fail("skillTrace.schemaVersion must equal grace-skill-trace-v1");
  }
  assertString(value.traceId, "skillTrace.traceId");
  assertString(value.executionId, "skillTrace.executionId");
  if (value.actorRole !== "ARCHITECT" && value.actorRole !== "COORDINATOR" && value.actorRole !== "CODER") {
    fail("skillTrace.actorRole must equal ARCHITECT, COORDINATOR, or CODER");
  }
  assertInteger(value.executionSequence, "skillTrace.executionSequence", 1);
  assertString(value.generatedAt, "skillTrace.generatedAt");
  assertArray(value.events, "skillTrace.events");
  const seenEventIds = new Set<string>();
  value.events.forEach((event, index) => {
    const path = `skillTrace.events[${index}]`;
    assertObject(event, path);
    assertString(event.id, `${path}.id`);
    if (seenEventIds.has(event.id)) {
      fail(`${path}.id must be unique`);
    }
    seenEventIds.add(event.id);
    assertString(event.skill, `${path}.skill`);
    if (event.status !== "LOADED" && event.status !== "APPLIED") {
      fail(`${path}.status must equal LOADED or APPLIED`);
    }
    if (
      event.source !== "MANDATORY_MODE" &&
      event.source !== "MANDATORY_PROTOCOL" &&
      event.source !== "OPTIONAL" &&
      event.source !== "CHAINED"
    ) {
      fail(`${path}.source must equal MANDATORY_MODE, MANDATORY_PROTOCOL, OPTIONAL, or CHAINED`);
    }
    assertString(event.invokedAt, `${path}.invokedAt`);
    assertString(event.trigger, `${path}.trigger`);
    assertOptionalString(event.parentSkill, `${path}.parentSkill`);
  });
  return value as unknown as SkillTraceDocument;
}

function validateByType(
  type: SchemaType,
  value: unknown,
): FailureEnvelope | FailureMemoryDocument | ForcedContextBundle | LoopGuardVerdict | SkillTraceDocument {
  switch (type) {
    case "failure-envelope":
      return validateFailureEnvelopeValue(value);
    case "failure-memory":
      return validateFailureMemoryDocumentValue(value);
    case "forced-context-bundle":
      return validateForcedContextBundleValue(value);
    case "loop-guard-verdict":
      return validateLoopGuardVerdictValue(value);
    case "skill-trace":
      return validateSkillTraceDocumentValue(value);
  }
}

function loadAndValidateJsonFile<T>(filePath: string, type: SchemaType): T {
  const value = JSON.parse(readFileSync(resolve(filePath), "utf8")) as unknown;
  return validateByType(type, value) as T;
}

export {
  type FailureEnvelope,
  type FailureMemoryDocument,
  type FailureMemoryRecord,
  type ForcedContextBundle,
  type LoopGuardVerdict,
  type SkillTraceActorRole,
  type SkillTraceDocument,
  type SkillTraceEvent,
  type SkillTraceSource,
  type SkillTraceStatus,
  type SchemaType,
  loadAndValidateJsonFile,
  validateByType,
  validateFailureEnvelopeValue,
  validateFailureMemoryDocumentValue,
  validateForcedContextBundleValue,
  validateLoopGuardVerdictValue,
  validateSkillTraceDocumentValue,
};
