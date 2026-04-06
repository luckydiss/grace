/*
 * <MODULE_CONTRACT id="MC-grace-inject-context" version="1.0.0">
 *   <Purpose>
 *     Build a forced-context bundle from failure-memory records for repeated GRACE remediation attempts.
 *   </Purpose>
 * </MODULE_CONTRACT>
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { validateFailureMemoryDocumentValue, validateForcedContextBundleValue } from "./grace-schema.js";

interface CliArgs {
  memory: string;
  envelope?: string;
  traceId?: string;
  scope?: string;
  testId?: string;
  errorSignature?: string;
  out?: string;
  json: boolean;
}

interface FailureMemoryRecord {
  id: string;
  semanticScope: string;
  testId: string;
  errorSignature: string;
  failedHypothesis?: string;
  rejectedFixPattern?: string;
  verifiedRecovery?: string;
  evidenceRefs: string[];
  createdAt: string;
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
  }>;
}

/*
 * <FUNCTION_CONTRACT id="FC-grace-inject-context-buildBundle">
 *   <Purpose>Construct a deterministic forced-context bundle from failure-memory records.</Purpose>
 *   <BlockAnchors>
 *     <Anchor id="BA-CTX-ARGPARSE" />
 *     <Anchor id="BA-CTX-LOAD" />
 *     <Anchor id="BA-CTX-FILTER" />
 *     <Anchor id="BA-CTX-OUTPUT" />
 *   </BlockAnchors>
 * </FUNCTION_CONTRACT>
 */

function parseCliArgs(argv: string[]): CliArgs {
  // <BLOCK_ANCHOR id="BA-CTX-ARGPARSE" />
  const args: CliArgs = {
    memory: "docs/grace/reports/failure-memory.json",
    json: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--memory":
        args.memory = argv[++i] ?? args.memory;
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
      case "--out":
        args.out = argv[++i];
        break;
      case "--json":
        args.json = true;
        break;
      default:
        break;
    }
  }

  return args;
}

function loadDocument(memoryPath: string): FailureMemoryDocument {
  // <BLOCK_ANCHOR id="BA-CTX-LOAD" />
  return validateFailureMemoryDocumentValue(JSON.parse(readFileSync(memoryPath, "utf8")) as unknown);
}

function buildBundle(document: FailureMemoryDocument, args: CliArgs): FailureMemoryRecord[] {
  // <BLOCK_ANCHOR id="BA-CTX-FILTER" />
  const exact = document.records.filter(
    (record) =>
      (!args.scope || record.semanticScope === args.scope) &&
      (!args.testId || record.testId === args.testId) &&
      (!args.errorSignature || record.errorSignature === args.errorSignature),
  );
  if (exact.length > 0) {
    return exact;
  }

  const adjacent = document.records.filter(
    (record) =>
      (!args.scope || record.semanticScope === args.scope) &&
      (!args.testId || record.testId === args.testId),
  );
  return adjacent;
}

function main(): number {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.envelope && (!args.scope || !args.testId || !args.errorSignature)) {
    const envelope = JSON.parse(readFileSync(resolve(args.envelope), "utf8")) as FailureEnvelopeFile;
    const firstFailed = envelope.failedTests?.[0];
    args.traceId = args.traceId ?? envelope.traceId;
    args.scope = args.scope ?? firstFailed?.semanticScope;
    args.testId = args.testId ?? firstFailed?.testId;
    args.errorSignature = args.errorSignature ?? firstFailed?.errorSignature;
  }
  const memoryPath = resolve(args.memory);
  const document = loadDocument(memoryPath);
  const bundle = buildBundle(document, args);

  // <BLOCK_ANCHOR id="BA-CTX-OUTPUT" />
  const payload = validateForcedContextBundleValue({
    schemaVersion: "grace-forced-context-bundle-v1",
    traceId: args.traceId,
    status: "CONTEXT_BUNDLE_READY",
    memoryPath,
    count: bundle.length,
    scope: args.scope,
    testId: args.testId,
    errorSignature: args.errorSignature,
    bundle,
  });

  if (args.out) {
    const outPath = resolve(args.out);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }

  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`FORCED_CONTEXT_BUNDLE count=${bundle.length} memoryPath=${memoryPath}`);
  }
  return bundle.length > 0 ? 0 : 1;
}

process.exit(main());
