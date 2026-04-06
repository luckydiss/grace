/*
 * <MODULE_CONTRACT id="MC-grace-test-envelope" version="1.0.0">
 *   <Purpose>
 *     Capture a failing test command, extract failed TC ids, and enrich the result into a GRACE failure envelope.
 *   </Purpose>
 * </MODULE_CONTRACT>
 */

import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { validateFailureEnvelopeValue } from "./grace-schema.js";

interface CliArgs {
  command: string;
  sourceDir: string;
  runtimeLog: string;
  out: string;
  traceId?: string;
  expectFailure: boolean;
  json: boolean;
}

interface TcMapping {
  testId: string;
  fcId: string;
  baIds: string[];
}

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

/*
 * <FUNCTION_CONTRACT id="FC-grace-test-envelope-capture">
 *   <Purpose>Run a test command and emit a structured GRACE failure envelope.</Purpose>
 *   <BlockAnchors>
 *     <Anchor id="BA-TENV-ARGPARSE" />
 *     <Anchor id="BA-TENV-RUN" />
 *     <Anchor id="BA-TENV-MAP" />
 *     <Anchor id="BA-TENV-OUTPUT" />
 *   </BlockAnchors>
 * </FUNCTION_CONTRACT>
 */

function parseCliArgs(argv: string[]): CliArgs {
  // <BLOCK_ANCHOR id="BA-TENV-ARGPARSE" />
  const args: CliArgs = {
    command: "",
    sourceDir: "src",
    runtimeLog: "docs/grace/reports/runtime-evidence.jsonl",
    out: "docs/grace/reports/test-failure-envelope.json",
    expectFailure: false,
    json: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--command":
        args.command = argv[++i] ?? "";
        break;
      case "--source-dir":
        args.sourceDir = argv[++i] ?? args.sourceDir;
        break;
      case "--runtime-log":
        args.runtimeLog = argv[++i] ?? args.runtimeLog;
        break;
      case "--out":
        args.out = argv[++i] ?? args.out;
        break;
      case "--trace-id":
        args.traceId = argv[++i];
        break;
      case "--expect-failure":
        args.expectFailure = true;
        break;
      case "--json":
        args.json = true;
        break;
      default:
        break;
    }
  }

  if (!args.command) {
    throw new Error("--command is required");
  }
  return args;
}

function listTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = resolve(dir, entry);
    const st = statSync(fullPath);
    if (st.isDirectory()) {
      results.push(...listTsFiles(fullPath));
    } else if (entry.endsWith(".ts")) {
      results.push(fullPath);
    }
  }
  return results;
}

function collectTcMappings(sourceDir: string): Map<string, TcMapping> {
  const mappings = new Map<string, TcMapping>();
  const files = listTsFiles(resolve(sourceDir));
  const fcRegex = /<FUNCTION_CONTRACT id="([^"]+)">([\s\S]*?)<\/FUNCTION_CONTRACT>/g;
  const tcRegex = /<TC id="([^"]+)">/g;
  const baRegex = /<BA ref="([^"]+)"/g;

  for (const filePath of files) {
    const content = readFileSync(filePath, "utf8");
    let fcMatch: RegExpExecArray | null;
    while ((fcMatch = fcRegex.exec(content)) !== null) {
      const fcId = fcMatch[1];
      const block = fcMatch[2];
      const baIds = Array.from(block.matchAll(baRegex), (match) => match[1]);
      for (const tcMatch of block.matchAll(tcRegex)) {
        mappings.set(tcMatch[1], { testId: tcMatch[1], fcId, baIds });
      }
    }
  }
  return mappings;
}

function loadRuntimeEvidence(runtimeLog: string): RuntimeEvidenceLine[] {
  const content = readFileSync(resolve(runtimeLog), "utf8");
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RuntimeEvidenceLine);
}

function extractFailedTcIds(output: string): string[] {
  return Array.from(new Set(Array.from(output.matchAll(/TC-[A-Z0-9-]+/g), (match) => match[0])));
}

function main(): number {
  const args = parseCliArgs(process.argv.slice(2));

  // <BLOCK_ANCHOR id="BA-TENV-RUN" />
  const result = spawnSync(args.command, {
    shell: true,
    encoding: "utf8",
    cwd: process.cwd(),
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const combined = `${stdout}\n${stderr}`;
  const failedTcIds = result.status === 0 ? [] : extractFailedTcIds(combined);

  if (args.expectFailure && result.status === 0) {
    console.error("expected test command to fail");
    return 1;
  }

  // <BLOCK_ANCHOR id="BA-TENV-MAP" />
  const tcMappings = collectTcMappings(args.sourceDir);
  const runtimeEvidence = loadRuntimeEvidence(args.runtimeLog);
  const failedTests: FailedTestEnvelope[] = failedTcIds.map((testId) => {
    const mapping = tcMappings.get(testId);
    const fcIds = mapping ? [mapping.fcId] : [];
    const baIds = mapping?.baIds ?? [];
    const relatedRuntime = runtimeEvidence.filter(
      (line) => (fcIds.length === 0 || (line.fc !== undefined && fcIds.includes(line.fc))) &&
        (baIds.length === 0 || (line.ba !== undefined && baIds.includes(line.ba))),
    );
    const evidenceRefs = baIds.map((baId) => `${args.sourceDir}#${baId}`);
    return {
      testId,
      errorSignature: `${testId}-ASSERTION_FAILURE`,
      semanticScope: fcIds[0] ?? testId,
      fcIds,
      baIds,
      evidenceRefs,
      runtimeEvidence: relatedRuntime,
    };
  });

  const envelope: FailureEnvelope = {
    schemaVersion: "grace-failure-envelope-v1",
    traceId: args.traceId,
    status: result.status === 0 ? "PASSED" : "FAILED",
    command: args.command,
    exitCode: result.status,
    failedTests,
    stdout,
    stderr,
  };

  // <BLOCK_ANCHOR id="BA-TENV-OUTPUT" />
  validateFailureEnvelopeValue(envelope);
  const outPath = resolve(args.out);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");

  if (args.json) {
    console.log(JSON.stringify(envelope, null, 2));
  } else {
    console.log(`TEST_ENVELOPE status=${envelope.status} failedTests=${failedTests.length} out=${args.out}`);
  }

  return result.status === 0 ? 0 : 0;
}

process.exit(main());
