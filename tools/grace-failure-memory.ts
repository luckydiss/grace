/*
 * <MODULE_CONTRACT id="MC-grace-failure-memory" version="1.1.0">
 *   <Purpose>
 *     Maintain deterministic failure-memory records for GRACE autonomy-stability workflows.
 *   </Purpose>
 *   <Responsibilities>
 *     <Item>Create and update a repository-local failure-memory artifact</Item>
 *     <Item>Append replayable records keyed by semantic scope, test id, and error signature</Item>
 *     <Item>Query matching records for later forced-context injection</Item>
 *     <Item>Deduplicate repeated incidents and compact stale records deterministically</Item>
 *     <Item>Emit deterministic JSON or text results</Item>
 *   </Responsibilities>
 * </MODULE_CONTRACT>
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { validateFailureMemoryDocumentValue } from "./grace-schema.js";

type Mode = "append" | "query" | "compact";

interface CliArgs {
  memory: string;
  mode: Mode;
  envelope?: string;
  traceId?: string;
  scope?: string;
  testId?: string;
  errorSignature?: string;
  failedHypothesis?: string;
  rejectedFixPattern?: string;
  verifiedRecovery?: string;
  evidenceRefs: string[];
  maxRecords?: number;
  json: boolean;
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

interface FailureEnvelopeFile {
  traceId?: string;
  failedTests?: Array<{
    testId?: string;
    errorSignature?: string;
    semanticScope?: string;
    evidenceRefs?: string[];
  }>;
}

/*
 * <FUNCTION_CONTRACT id="FC-grace-failure-memory-execute">
 *   <Purpose>Append, compact, or query deterministic failure-memory records.</Purpose>
 *   <BlockAnchors>
 *     <Anchor id="BA-FM-ARGPARSE" />
 *     <Anchor id="BA-FM-LOAD" />
 *     <Anchor id="BA-FM-MUTATE" />
 *     <Anchor id="BA-FM-COMPACT" />
 *     <Anchor id="BA-FM-OUTPUT" />
 *   </BlockAnchors>
 * </FUNCTION_CONTRACT>
 */

function parseCliArgs(argv: string[]): CliArgs {
  // <BLOCK_ANCHOR id="BA-FM-ARGPARSE" />
  const args: CliArgs = {
    memory: "docs/grace/reports/failure-memory.json",
    mode: "query",
    evidenceRefs: [],
    maxRecords: 50,
    json: false,
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    switch (arg) {
      case "--memory":
        args.memory = argv[++i] ?? args.memory;
        break;
      case "--append":
        args.mode = "append";
        break;
      case "--query":
        args.mode = "query";
        break;
      case "--compact":
        args.mode = "compact";
        break;
      case "--envelope":
        args.envelope = argv[++i];
        break;
      case "--trace-id":
        args.traceId = argv[++i];
        break;
      case "--scope":
        args.scope = argv[++i];
        break;
      case "--test-id":
        args.testId = argv[++i];
        break;
      case "--error-signature":
        args.errorSignature = argv[++i];
        break;
      case "--failed-hypothesis":
        args.failedHypothesis = argv[++i];
        break;
      case "--rejected-fix-pattern":
        args.rejectedFixPattern = argv[++i];
        break;
      case "--verified-recovery":
        args.verifiedRecovery = argv[++i];
        break;
      case "--evidence-ref":
        args.evidenceRefs.push(argv[++i] ?? "");
        break;
      case "--max-records":
        args.maxRecords = Number(argv[++i] ?? args.maxRecords);
        break;
      case "--json":
        args.json = true;
        break;
      default:
        break;
    }
    i++;
  }

  return args;
}

function hydrateRecord(record: FailureMemoryRecord, index: number): FailureMemoryRecord {
  const createdAt = record.createdAt ?? new Date(0).toISOString();
  return {
    ...record,
    id: record.id ?? `FM-${index + 1}`,
    createdAt,
    firstSeen: record.firstSeen ?? createdAt,
    lastSeen: record.lastSeen ?? createdAt,
    occurrenceCount: typeof record.occurrenceCount === "number" && record.occurrenceCount > 0 ? record.occurrenceCount : 1,
    evidenceRefs: Array.isArray(record.evidenceRefs) ? record.evidenceRefs : [],
  };
}

function loadDocument(memoryPath: string): FailureMemoryDocument {
  // <BLOCK_ANCHOR id="BA-FM-LOAD" />
  if (!existsSync(memoryPath)) {
    const emptyDocument: FailureMemoryDocument = {
      schemaVersion: "grace-failure-memory-v1",
      generatedAt: new Date().toISOString(),
      records: [],
    };
    validateFailureMemoryDocumentValue(emptyDocument);
    return emptyDocument;
  }

  const parsed = JSON.parse(readFileSync(memoryPath, "utf8")) as FailureMemoryDocument;
  const document: FailureMemoryDocument = {
    schemaVersion: parsed.schemaVersion ?? "grace-failure-memory-v1",
    generatedAt: parsed.generatedAt ?? new Date().toISOString(),
    records: Array.isArray(parsed.records) ? parsed.records.map(hydrateRecord) : [],
  };
  validateFailureMemoryDocumentValue(document);
  return document;
}

function saveDocument(memoryPath: string, document: FailureMemoryDocument): void {
  validateFailureMemoryDocumentValue(document);
  mkdirSync(dirname(memoryPath), { recursive: true });
  writeFileSync(memoryPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
}

function appendRecord(document: FailureMemoryDocument, args: CliArgs): FailureMemoryRecord {
  // <BLOCK_ANCHOR id="BA-FM-MUTATE" />
  if (args.envelope && (!args.scope || !args.testId || !args.errorSignature)) {
    const envelope = JSON.parse(readFileSync(resolve(args.envelope), "utf8")) as FailureEnvelopeFile;
    const firstFailed = envelope.failedTests?.[0];
    args.traceId = args.traceId ?? envelope.traceId;
    args.scope = args.scope ?? firstFailed?.semanticScope;
    args.testId = args.testId ?? firstFailed?.testId;
    args.errorSignature = args.errorSignature ?? firstFailed?.errorSignature;
    args.evidenceRefs = args.evidenceRefs.length > 0 ? args.evidenceRefs : firstFailed?.evidenceRefs ?? [];
  }

  if (!args.scope || !args.testId || !args.errorSignature) {
    throw new Error("append requires --scope, --test-id, and --error-signature");
  }

  const createdAt = new Date().toISOString();
  const existing = document.records.find((record) =>
    record.semanticScope === args.scope &&
    record.testId === args.testId &&
    record.errorSignature === args.errorSignature &&
    (record.rejectedFixPattern ?? "") === (args.rejectedFixPattern ?? "") &&
    (record.verifiedRecovery ?? "") === (args.verifiedRecovery ?? ""),
  );

  if (existing) {
    existing.traceId = args.traceId ?? existing.traceId;
    existing.lastSeen = createdAt;
    existing.occurrenceCount += 1;
    existing.failedHypothesis = args.failedHypothesis ?? existing.failedHypothesis;
    existing.rejectedFixPattern = args.rejectedFixPattern ?? existing.rejectedFixPattern;
    existing.verifiedRecovery = args.verifiedRecovery ?? existing.verifiedRecovery;
    existing.evidenceRefs = Array.from(new Set([...existing.evidenceRefs, ...args.evidenceRefs.filter(Boolean)]));
    document.generatedAt = createdAt;
    return existing;
  }

  const record: FailureMemoryRecord = {
    id: `FM-${document.records.length + 1}`,
    traceId: args.traceId,
    semanticScope: args.scope,
    testId: args.testId,
    errorSignature: args.errorSignature,
    failedHypothesis: args.failedHypothesis,
    rejectedFixPattern: args.rejectedFixPattern,
    verifiedRecovery: args.verifiedRecovery,
    evidenceRefs: Array.from(new Set(args.evidenceRefs.filter(Boolean))),
    createdAt,
    firstSeen: createdAt,
    lastSeen: createdAt,
    occurrenceCount: 1,
  };

  document.generatedAt = createdAt;
  document.records.push(record);
  return record;
}

function queryRecords(document: FailureMemoryDocument, args: CliArgs): FailureMemoryRecord[] {
  return document.records.filter((record) => {
    if (args.scope && record.semanticScope !== args.scope) {
      return false;
    }
    if (args.testId && record.testId !== args.testId) {
      return false;
    }
    if (args.errorSignature && record.errorSignature !== args.errorSignature) {
      return false;
    }
    return true;
  }).sort((left, right) => {
    if (left.occurrenceCount !== right.occurrenceCount) {
      return right.occurrenceCount - left.occurrenceCount;
    }
    return right.lastSeen.localeCompare(left.lastSeen);
  });
}

function compactRecords(document: FailureMemoryDocument, maxRecords: number): FailureMemoryDocument {
  // <BLOCK_ANCHOR id="BA-FM-COMPACT" />
  const grouped = new Map<string, FailureMemoryRecord>();

  for (const record of document.records) {
    const key = [
      record.semanticScope,
      record.testId,
      record.errorSignature,
      record.rejectedFixPattern ?? "",
      record.verifiedRecovery ?? "",
    ].join("::");
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { ...record, evidenceRefs: [...record.evidenceRefs] });
      continue;
    }

    existing.firstSeen = existing.firstSeen.localeCompare(record.firstSeen) <= 0 ? existing.firstSeen : record.firstSeen;
    existing.lastSeen = existing.lastSeen.localeCompare(record.lastSeen) >= 0 ? existing.lastSeen : record.lastSeen;
    existing.createdAt = existing.createdAt.localeCompare(record.createdAt) <= 0 ? existing.createdAt : record.createdAt;
    existing.occurrenceCount += record.occurrenceCount;
    existing.evidenceRefs = Array.from(new Set([...existing.evidenceRefs, ...record.evidenceRefs]));
    existing.failedHypothesis = existing.failedHypothesis ?? record.failedHypothesis;
  }

  const compacted = Array.from(grouped.values())
    .sort((left, right) => {
      if (left.occurrenceCount !== right.occurrenceCount) {
        return right.occurrenceCount - left.occurrenceCount;
      }
      return right.lastSeen.localeCompare(left.lastSeen);
    })
    .slice(0, maxRecords)
    .map((record, index) => ({ ...record, id: `FM-${index + 1}` }));

  return {
    schemaVersion: "grace-failure-memory-v1",
    generatedAt: new Date().toISOString(),
    records: compacted,
  };
}

function main(): number {
  const args = parseCliArgs(process.argv.slice(2));
  const memoryPath = resolve(args.memory);
  const document = loadDocument(memoryPath);

  // <BLOCK_ANCHOR id="BA-FM-OUTPUT" />
  if (args.mode === "append") {
    const record = appendRecord(document, args);
    saveDocument(memoryPath, document);
    if (args.json) {
      console.log(JSON.stringify({ status: "APPENDED", memoryPath, record }, null, 2));
    } else {
      console.log(`FAILURE_MEMORY_APPENDED id=${record.id} scope=${record.semanticScope} testId=${record.testId}`);
    }
    return 0;
  }

  if (args.mode === "compact") {
    const compacted = compactRecords(document, args.maxRecords ?? 50);
    saveDocument(memoryPath, compacted);
    if (args.json) {
      console.log(JSON.stringify({ status: "COMPACTED", memoryPath, count: compacted.records.length, records: compacted.records }, null, 2));
    } else {
      console.log(`FAILURE_MEMORY_COMPACTED count=${compacted.records.length} memoryPath=${memoryPath}`);
    }
    return 0;
  }

  const matches = queryRecords(document, args);
  if (args.json) {
    console.log(JSON.stringify({ status: "QUERIED", memoryPath, count: matches.length, matches }, null, 2));
  } else {
    console.log(`FAILURE_MEMORY_QUERY count=${matches.length} memoryPath=${memoryPath}`);
  }
  return 0;
}

process.exit(main());
