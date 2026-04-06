/*
 * <MODULE_CONTRACT id="MC-grace-loop-guard" version="1.0.0">
 *   <Purpose>
 *     Enforce retry budgets and forced-context requirements for autonomous GRACE remediation loops.
 *   </Purpose>
 * </MODULE_CONTRACT>
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { validateFailureMemoryDocumentValue, validateLoopGuardVerdictValue } from "./grace-schema.js";

interface CliArgs {
  memory?: string;
  envelope?: string;
  traceId?: string;
  scope?: string;
  testId?: string;
  errorSignature?: string;
  retryCount: number;
  retryBudget: number;
  forcedContextLoaded: boolean;
  proposedFix?: string;
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
 * <FUNCTION_CONTRACT id="FC-grace-loop-guard-evaluate">
 *   <Purpose>Evaluate whether another autonomous retry is allowed or must escalate.</Purpose>
 *   <BlockAnchors>
 *     <Anchor id="BA-LOOP-ARGPARSE" />
 *     <Anchor id="BA-LOOP-LOAD" />
 *     <Anchor id="BA-LOOP-EVALUATE" />
 *     <Anchor id="BA-LOOP-OUTPUT" />
 *   </BlockAnchors>
 * </FUNCTION_CONTRACT>
 */

function parseCliArgs(argv: string[]): CliArgs {
  // <BLOCK_ANCHOR id="BA-LOOP-ARGPARSE" />
  const args: CliArgs = {
    retryCount: 0,
    retryBudget: 2,
    forcedContextLoaded: false,
    json: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--memory":
        args.memory = argv[++i];
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
      case "--retry-count":
        args.retryCount = Number(argv[++i] ?? args.retryCount);
        break;
      case "--retry-budget":
        args.retryBudget = Number(argv[++i] ?? args.retryBudget);
        break;
      case "--forced-context-loaded":
        args.forcedContextLoaded = (argv[++i] ?? "false").toLowerCase() === "true";
        break;
      case "--proposed-fix":
        args.proposedFix = argv[++i];
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

function loadRelevantRecords(args: CliArgs): FailureMemoryRecord[] {
  // <BLOCK_ANCHOR id="BA-LOOP-LOAD" />
  if (!args.memory) {
    return [];
  }
  const document = validateFailureMemoryDocumentValue(JSON.parse(readFileSync(resolve(args.memory), "utf8")) as unknown);
  return document.records.filter(
    (record) =>
      (!args.scope || record.semanticScope === args.scope) &&
      (!args.testId || record.testId === args.testId) &&
      (!args.errorSignature || record.errorSignature === args.errorSignature),
  );
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
  const records = loadRelevantRecords(args);

  // <BLOCK_ANCHOR id="BA-LOOP-EVALUATE" />
  const repeatedRejectedFix = Boolean(
    args.proposedFix &&
      records.some((record) => record.rejectedFixPattern && record.rejectedFixPattern === args.proposedFix),
  );
  const thresholdReached = args.retryCount >= args.retryBudget;
  const requiresForcedContext = thresholdReached;
  const blockReasons: string[] = [];

  if (repeatedRejectedFix) {
    blockReasons.push("REJECTED_FIX_PATTERN_REPEATED");
  }
  if (requiresForcedContext && !args.forcedContextLoaded) {
    blockReasons.push("FORCED_CONTEXT_REQUIRED");
  }
  if (args.retryCount > args.retryBudget) {
    blockReasons.push("RETRY_BUDGET_EXHAUSTED");
  }

  const status = blockReasons.length > 0 ? "BLOCK" : thresholdReached ? "ESCALATE_WITH_CONTEXT" : "ALLOW";

  // <BLOCK_ANCHOR id="BA-LOOP-OUTPUT" />
  const payload = validateLoopGuardVerdictValue({
    schemaVersion: "grace-loop-guard-verdict-v1",
    traceId: args.traceId,
    status,
    retryCount: args.retryCount,
    retryBudget: args.retryBudget,
    forcedContextLoaded: args.forcedContextLoaded,
    matchingRecords: records.length,
    blockReasons,
    scope: args.scope,
    testId: args.testId,
    errorSignature: args.errorSignature,
  });

  if (args.out) {
    const outPath = resolve(args.out);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }

  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`LOOP_GUARD status=${status} retries=${args.retryCount}/${args.retryBudget}`);
  }

  return status === "BLOCK" ? 1 : 0;
}

process.exit(main());
