/*
 * <MODULE_CONTRACT id="MC-grace-e2e-test" version="1.1.0">
 *   <Purpose>
 *     End-to-end smoke test runner for the full GRACE pipeline.
 *     Executes each pipeline stage in sequence and aggregates PASS/FAIL
 *     verdicts into an overall pipeline health report.
 *   </Purpose>
 *   <Responsibilities>
 *     <Item>Run grace-navigate on src/ and verify hierarchy output is non-empty</Item>
 *     <Item>Run grace-sync-contracts --check --dir src and verify ALL_SYNCHRONIZED</Item>
 *     <Item>Run grace-mental-test --plan DevelopmentPlan.xml --source src/ and verify PASS</Item>
 *     <Item>Generate runtime evidence and replay it through grace-log-trace</Item>
 *     <Item>Run strict traceability coverage against the generated runtime evidence</Item>
 *     <Item>Output per-step PASS/FAIL verdicts and an overall PASS/FAIL summary</Item>
 *   </Responsibilities>
 *   <Invariants>
 *     <I1>Each step runs in isolation; failure in one step does not prevent subsequent steps from running.</I1>
 *     <I2>The overall verdict is PASS iff all 5 steps individually return PASS.</I2>
 *     <I3>Exit code 0 = overall PASS; exit code 1 = one or more steps FAILED; exit code 2 = tool error.</I3>
 *     <I4>The smoke test is idempotent for source files; it may refresh generated runtime evidence artifacts.</I4>
 *   </Invariants>
 *   <Collaborators>
 *     <Item>invokes: tools/grace-navigate.ts (Step 1)</Item>
 *     <Item>invokes: tools/grace-sync-contracts.ts (Step 2)</Item>
 *     <Item>invokes: tools/grace-mental-test.ts (Step 3)</Item>
 *     <Item>invokes: tools/grace-generate-runtime-evidence.ts (Step 4)</Item>
 *     <Item>invokes: tools/grace-log-trace.ts (Step 4)</Item>
 *     <Item>invokes: tools/grace-traceability-coverage.ts (Step 5)</Item>
 *   </Collaborators>
 *   <Links>
 *     <Link ref="DevelopmentExecutionPlan.xml#W4-T3"/>
 *     <Link ref="DevelopmentExecutionPlan.xml#W7-T1"/>
 *     <Link ref="DevelopmentPlan.xml#DP-SVC-demo-http"/>
 *     <Link ref="DevelopmentPlan.xml#DP-SVC-grace-traceability-coverage"/>
 *   </Links>
 * </MODULE_CONTRACT>
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { executeNavigate } from "./grace-navigate.js";
import { executeSync } from "./grace-sync-contracts.js";
import { executeMentalTest } from "./grace-mental-test.js";
import { executeGenerateRuntimeEvidence } from "./grace-generate-runtime-evidence.js";
import { executeLogTrace } from "./grace-log-trace.js";
import { executeCoverage } from "./grace-traceability-coverage.js";

// <FUNCTION_CONTRACT id="FC-grace-e2e-test-runAll">
//   <Intent>
//     Orchestrate the full E2E smoke test: run all 5 pipeline steps in sequence,
//     capture per-step verdicts, and produce an overall PASS/FAIL report.
//   </Intent>
//   <Inputs>
//     <Input name="argv">Raw CLI argument array (process.argv.slice(2)).</Input>
//   </Inputs>
//   <Outputs>
//     <Output name="exitCode">0=PASS, 1=FAIL, 2=error.</Output>
//     <Output name="report">Human-readable or JSON report with per-step verdicts.</Output>
//   </Outputs>
//   <BlockAnchors>
//     <BA ref="BA-E2E-ARGPARSE"/>
//     <BA ref="BA-E2E-STEP1"/>
//     <BA ref="BA-E2E-STEP2"/>
//     <BA ref="BA-E2E-STEP3"/>
//     <BA ref="BA-E2E-STEP4"/>
//     <BA ref="BA-E2E-STEP5"/>
//     <BA ref="BA-E2E-VERDICT"/>
//   </BlockAnchors>
// </FUNCTION_CONTRACT>

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = detectProjectRoot(__dirname);

interface StepResult {
  step: number;
  name: string;
  verdict: "PASS" | "FAIL";
  elapsedMs: number;
  detail: string;
}

interface E2EReport {
  overallVerdict: "PASS" | "FAIL";
  timestamp: string;
  elapsedMs: number;
  steps: StepResult[];
}

function detectProjectRoot(startDir: string): string {
  let current = startDir;

  while (true) {
    const hasPackage = existsSync(resolve(current, "package.json"));
    const hasGraceDocs = existsSync(resolve(current, "docs", "grace", "GRACE_MARKUP_STANDARD.md"));
    if (hasPackage && hasGraceDocs) {
      return current;
    }

    const parent = resolve(current, "..");
    if (parent === current) {
      return process.cwd();
    }
    current = parent;
  }
}

function stepNavigate(dir: string): StepResult {
  // BLOCK_ANCHOR BA-E2E-STEP1
  const start = Date.now();
  const exitCode = executeNavigate(["--dir", dir]);
  const elapsedMs = Date.now() - start;
  const verdict: "PASS" | "FAIL" = exitCode === 0 ? "PASS" : "FAIL";
  const detail = exitCode === 0 ? "navigate completed successfully" : `Exit code ${exitCode}`;
  return { step: 1, name: "navigate", verdict, elapsedMs, detail };
}

function stepSyncContracts(dir: string): StepResult {
  // BLOCK_ANCHOR BA-E2E-STEP2
  const start = Date.now();
  const exitCode = executeSync(["--check", "--dir", dir]);
  const elapsedMs = Date.now() - start;
  const verdict: "PASS" | "FAIL" = exitCode === 0 ? "PASS" : "FAIL";
  const detail = exitCode === 0 ? "sync-contracts completed successfully" : `Exit code ${exitCode}`;
  return { step: 2, name: "sync-contracts", verdict, elapsedMs, detail };
}

function stepMentalTest(planPath: string, dir: string): StepResult {
  // BLOCK_ANCHOR BA-E2E-STEP3
  const start = Date.now();
  const exitCode = executeMentalTest(["--plan", planPath, "--source", dir, "--dry-run"]);
  const elapsedMs = Date.now() - start;
  const verdict: "PASS" | "FAIL" = exitCode === 0 ? "PASS" : "FAIL";
  const detail = exitCode === 0 ? "mental-test completed successfully" : `Exit code ${exitCode}`;
  return { step: 3, name: "mental-test", verdict, elapsedMs, detail };
}

async function stepLogTrace(runtimeEvidencePath: string): Promise<StepResult> {
  // BLOCK_ANCHOR BA-E2E-STEP4
  const start = Date.now();
  const generateExitCode = await executeGenerateRuntimeEvidence(["--out", runtimeEvidencePath]);
  const replayExitCode = generateExitCode === 0
    ? await executeLogTrace(["--replay", runtimeEvidencePath, "--source-root", PROJECT_ROOT, "--format", "json"])
    : 1;
  const elapsedMs = Date.now() - start;
  const verdict: "PASS" | "FAIL" = generateExitCode === 0 && replayExitCode === 0 ? "PASS" : "FAIL";
  const detail = verdict === "PASS"
    ? `runtime evidence generated and replayed: ${runtimeEvidencePath}`
    : `generate=${generateExitCode} replay=${replayExitCode}`;
  return { step: 4, name: "log-trace", verdict, elapsedMs, detail };
}

function stepTraceabilityGate(dir: string, runtimeEvidencePath: string): StepResult {
  // BLOCK_ANCHOR BA-E2E-STEP5
  const start = Date.now();
  const exitCode = executeCoverage(["--dir", dir, "--runtime-log", runtimeEvidencePath, "--strict"]);
  const elapsedMs = Date.now() - start;
  const verdict: "PASS" | "FAIL" = exitCode === 0 ? "PASS" : "FAIL";
  const detail = exitCode === 0
    ? `traceability coverage passed with runtime evidence ${runtimeEvidencePath}`
    : `Exit code ${exitCode}`;
  return { step: 5, name: "traceability-gate", verdict, elapsedMs, detail };
}

function formatReport(report: E2EReport, jsonMode: boolean): string {
  if (jsonMode) {
    return JSON.stringify(report, null, 2);
  }

  const lines: string[] = [];
  lines.push("=".repeat(40));
  lines.push("GRACE E2E Pipeline Smoke Test");
  lines.push("=".repeat(40));
  for (const s of report.steps) {
    const stepLabel = `Step ${s.step}`.padEnd(7);
    const nameLabel = s.name.padEnd(20);
    const verdictLabel = s.verdict.padEnd(5);
    lines.push(`${stepLabel} ${nameLabel} ${verdictLabel}  (${s.elapsedMs}ms)`);
  }
  lines.push("=".repeat(40));
  const passed = report.steps.filter((s) => s.verdict === "PASS").length;
  const total = report.steps.length;
  lines.push(`Overall: ${report.overallVerdict} (${passed}/${total} steps passed)`);
  return lines.join("\n");
}

async function runAll(argv: string[]): Promise<number> {
  // BLOCK_ANCHOR BA-E2E-ARGPARSE
  const args = new Map<string, string>();
  let i = 0;
  while (i < argv.length) {
    if (argv[i] === "--dir" && i + 1 < argv.length) {
      args.set("dir", argv[++i]);
    } else if (argv[i] === "--plan" && i + 1 < argv.length) {
      args.set("plan", argv[++i]);
    } else if (argv[i] === "--runtime-log" && i + 1 < argv.length) {
      args.set("runtime-log", argv[++i]);
    } else if (argv[i] === "--json") {
      args.set("json", "true");
    } else if (argv[i] === "--verbose") {
      args.set("verbose", "true");
    }
    i++;
  }

  const dir = args.get("dir") ?? "src";
  const planPath = args.get("plan") ?? "docs/grace/DevelopmentPlan.xml";
  const runtimeEvidencePath = args.get("runtime-log") ?? "docs/grace/reports/runtime-evidence.jsonl";
  const jsonMode = args.get("json") === "true";
  const verbose = args.get("verbose") === "true";

  const dirAbs = resolve(PROJECT_ROOT, dir);
  const planAbs = resolve(PROJECT_ROOT, planPath);

  if (!existsSync(dirAbs)) {
    console.error(`Error: source directory not found: ${dirAbs}`);
    return 2;
  }
  if (!existsSync(planAbs)) {
    console.error(`Error: plan file not found: ${planAbs}`);
    return 2;
  }

  const totalStart = Date.now();
  const results: StepResult[] = [];

  results.push(stepNavigate(dir));
  results.push(stepSyncContracts(dir));
  results.push(stepMentalTest(planAbs, dirAbs));
  results.push(await stepLogTrace(runtimeEvidencePath));
  results.push(stepTraceabilityGate(dir, runtimeEvidencePath));

  const overallPass = results.every((s) => s.verdict === "PASS");
  const report: E2EReport = {
    overallVerdict: overallPass ? "PASS" : "FAIL",
    timestamp: new Date().toISOString(),
    elapsedMs: Date.now() - totalStart,
    steps: results,
  };

  console.log(formatReport(report, jsonMode));

  if (verbose) {
    for (const s of results) {
      console.log(`\n--- Step ${s.step} detail ---\n${s.detail}`);
    }
  }

  return overallPass ? 0 : 1;
}

runAll(process.argv.slice(2)).then(
  (exitCode) => process.exit(exitCode),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
