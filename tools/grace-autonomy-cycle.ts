/*
 * <MODULE_CONTRACT id="MC-grace-autonomy-cycle" version="1.0.0">
 *   <Purpose>
 *     Orchestrate the W11 post-failure autonomy cycle: test envelope, failure memory, forced context, and loop guard.
 *   </Purpose>
 * </MODULE_CONTRACT>
 */

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { validateFailureEnvelopeValue, validateForcedContextBundleValue, validateLoopGuardVerdictValue } from "./grace-schema.js";

interface CliArgs {
  command: string;
  sourceDir: string;
  runtimeLog: string;
  envelopeOut: string;
  memoryPath: string;
  contextOut: string;
  guardOut: string;
  traceId: string;
  retryCount: number;
  retryBudget: number;
  forcedContextLoaded: boolean;
  failedHypothesis: string;
  rejectedFixPattern: string;
  verifiedRecovery: string;
  json: boolean;
}

/*
 * <FUNCTION_CONTRACT id="FC-grace-autonomy-cycle-run">
 *   <Purpose>Execute the canonical W11 post-failure cycle as one deterministic orchestration path.</Purpose>
 *   <BlockAnchors>
 *     <Anchor id="BA-AUTO-ARGPARSE" />
 *     <Anchor id="BA-AUTO-ENVELOPE" />
 *     <Anchor id="BA-AUTO-MEMORY" />
 *     <Anchor id="BA-AUTO-CONTEXT" />
 *     <Anchor id="BA-AUTO-GUARD" />
 *     <Anchor id="BA-AUTO-OUTPUT" />
 *   </BlockAnchors>
 * </FUNCTION_CONTRACT>
 */

function parseCliArgs(argv: string[]): CliArgs {
  // <BLOCK_ANCHOR id="BA-AUTO-ARGPARSE" />
  const args: CliArgs = {
    command: "",
    sourceDir: "src",
    runtimeLog: "docs/grace/reports/runtime-evidence.jsonl",
    envelopeOut: "docs/grace/reports/test-failure-envelope.json",
    memoryPath: "docs/grace/reports/failure-memory.json",
    contextOut: "docs/grace/reports/test-failure-envelope.forced-context.json",
    guardOut: "docs/grace/reports/test-failure-envelope.loop-guard.json",
    traceId: "TRACE-GRACE-W11-DEFAULT",
    retryCount: 1,
    retryBudget: 2,
    forcedContextLoaded: true,
    failedHypothesis: "failure root cause is not yet verified",
    rejectedFixPattern: "unknown-rejected-fix",
    verifiedRecovery: "inspect runtime evidence before mutating semantic scope",
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
      case "--envelope-out":
        args.envelopeOut = argv[++i] ?? args.envelopeOut;
        break;
      case "--memory":
        args.memoryPath = argv[++i] ?? args.memoryPath;
        break;
      case "--context-out":
        args.contextOut = argv[++i] ?? args.contextOut;
        break;
      case "--guard-out":
        args.guardOut = argv[++i] ?? args.guardOut;
        break;
      case "--trace-id":
        args.traceId = argv[++i] ?? args.traceId;
        break;
      case "--retry-count":
        args.retryCount = Number(argv[++i] ?? args.retryCount);
        break;
      case "--retry-budget":
        args.retryBudget = Number(argv[++i] ?? args.retryBudget);
        break;
      case "--forced-context-loaded":
        args.forcedContextLoaded = (argv[++i] ?? "true").toLowerCase() === "true";
        break;
      case "--failed-hypothesis":
        args.failedHypothesis = argv[++i] ?? args.failedHypothesis;
        break;
      case "--rejected-fix-pattern":
        args.rejectedFixPattern = argv[++i] ?? args.rejectedFixPattern;
        break;
      case "--verified-recovery":
        args.verifiedRecovery = argv[++i] ?? args.verifiedRecovery;
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
  if (args.contextOut === "docs/grace/reports/test-failure-envelope.forced-context.json" && args.envelopeOut !== "docs/grace/reports/test-failure-envelope.json") {
    args.contextOut = `${args.envelopeOut}.forced-context.json`;
  }
  if (args.guardOut === "docs/grace/reports/test-failure-envelope.loop-guard.json" && args.envelopeOut !== "docs/grace/reports/test-failure-envelope.json") {
    args.guardOut = `${args.envelopeOut}.loop-guard.json`;
  }
  return args;
}

function runNodeScript(scriptName: string, scriptArgs: string[]): { status: number; stdout: string; stderr: string } {
  const scriptPath = resolve("out", "scripts", scriptName);
  const result = spawnSync(process.execPath, [scriptPath, ...scriptArgs], {
    encoding: "utf8",
    cwd: process.cwd(),
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function parseJsonOutput<T>(label: string, payload: { status: number; stdout: string; stderr: string }): T {
  if (payload.status !== 0) {
    throw new Error(`${label} failed: ${payload.stderr || payload.stdout}`);
  }
  return JSON.parse(payload.stdout) as T;
}

function main(): number {
  const args = parseCliArgs(process.argv.slice(2));

  // <BLOCK_ANCHOR id="BA-AUTO-ENVELOPE" />
  const envelope = validateFailureEnvelopeValue(parseJsonOutput<Record<string, unknown>>(
    "test-envelope",
    runNodeScript("grace-test-envelope.js", [
      "--command",
      args.command,
      "--source-dir",
      args.sourceDir,
      "--runtime-log",
      args.runtimeLog,
      "--out",
      args.envelopeOut,
      "--trace-id",
      args.traceId,
      "--expect-failure",
      "--json",
    ]),
  ));

  // <BLOCK_ANCHOR id="BA-AUTO-MEMORY" />
  const memory = parseJsonOutput<Record<string, unknown>>(
    "failure-memory",
    runNodeScript("grace-failure-memory.js", [
      "--memory",
      args.memoryPath,
      "--append",
      "--envelope",
      args.envelopeOut,
      "--trace-id",
      args.traceId,
      "--failed-hypothesis",
      args.failedHypothesis,
      "--rejected-fix-pattern",
      args.rejectedFixPattern,
      "--verified-recovery",
      args.verifiedRecovery,
      "--json",
    ]),
  );

  // <BLOCK_ANCHOR id="BA-AUTO-CONTEXT" />
  const context = validateForcedContextBundleValue(parseJsonOutput<Record<string, unknown>>(
    "inject-context",
    runNodeScript("grace-inject-context.js", [
      "--memory",
      args.memoryPath,
      "--envelope",
      args.envelopeOut,
      "--trace-id",
      args.traceId,
      "--out",
      args.contextOut,
      "--json",
    ]),
  ));

  // <BLOCK_ANCHOR id="BA-AUTO-GUARD" />
  const guard = validateLoopGuardVerdictValue(parseJsonOutput<Record<string, unknown>>(
    "loop-guard",
    runNodeScript("grace-loop-guard.js", [
      "--memory",
      args.memoryPath,
      "--envelope",
      args.envelopeOut,
      "--trace-id",
      args.traceId,
      "--retry-count",
      String(args.retryCount),
      "--retry-budget",
      String(args.retryBudget),
      "--forced-context-loaded",
      String(args.forcedContextLoaded),
      "--out",
      args.guardOut,
      "--json",
    ]),
  ));

  // <BLOCK_ANCHOR id="BA-AUTO-OUTPUT" />
  const payload = {
    status: "AUTONOMY_CYCLE_COMPLETE",
    envelope,
    memory,
    context,
    guard,
  };
  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log("AUTONOMY_CYCLE_COMPLETE");
  }
  return 0;
}

process.exit(main());
