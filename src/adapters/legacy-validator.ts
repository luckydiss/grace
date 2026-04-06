import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import type {
  LegacyValidatorFailure,
  LegacyValidatorInput,
  LegacyValidatorReport,
  LegacyValidatorResult,
  LegacyVerificationTarget,
  LegacyVerificationToolName,
  NamedLegacyVerificationAdapterInput,
  Text2SqlCompatibilityPilotCheck,
  Text2SqlCompatibilityPilotInput,
  Text2SqlCompatibilityPilotReport,
} from "./index.js";

const MC_GRACE_V1_ADAPTERS = "MC-grace-v1-adapters";
const FC_GRACE_ADAPTERS_RUN_LEGACY_VALIDATOR = "FC-grace-adapters-runLegacyValidator";
const BA_GRACE_RUN_LEGACY_COMMAND = "BA-grace-run-legacy-command";
const BA_GRACE_PERSIST_LEGACY_REPORT = "BA-grace-persist-legacy-report";

function graceRuntimeLog(entry: {
  ba: string;
  belief: string;
  fact: Record<string, unknown>;
}): void {
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      layer: "runtime",
      mc: MC_GRACE_V1_ADAPTERS,
      fc: FC_GRACE_ADAPTERS_RUN_LEGACY_VALIDATOR,
      ...entry,
    }),
  );
}

function ensureParentDir(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

function buildFailure(code: LegacyValidatorFailure["code"], message: string): LegacyValidatorFailure {
  return { code, message };
}

function requireTargetValue(
  value: string | undefined,
  codeName: string,
  toolName: LegacyVerificationToolName,
): string | LegacyValidatorFailure {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return buildFailure(
    "NAMED_TOOL_INPUT_MISSING",
    `${toolName} requires target field ${codeName}.`,
  );
}

function buildNamedToolCommand(
  toolName: LegacyVerificationToolName,
  target: LegacyVerificationTarget,
): { command: LegacyValidatorInput["command"]; failures: LegacyValidatorFailure[] } {
  const repoRoot = resolve(target.repoRoot);
  const nodeCommand = process.execPath;
  const failures: LegacyValidatorFailure[] = [];
  const script = (name: string) => resolve(repoRoot, "out", "tools", name);

  if (toolName === "grace-validate-product") {
    return {
      command: {
        command: nodeCommand,
        args: [script("grace-validate.js"), "--mode", "product", "--root", resolve(target.productRoot), "--json"],
        cwd: repoRoot,
      },
      failures,
    };
  }

  if (toolName === "grace-execution-proof") {
    const executionsDir = requireTargetValue(target.executionsDir, "executionsDir", toolName);
    if (typeof executionsDir !== "string") {
      failures.push(executionsDir);
      return { command: { command: nodeCommand, args: [], cwd: repoRoot }, failures };
    }
    return {
      command: {
        command: nodeCommand,
        args: [script("grace-execution-proof.js"), "--dir", resolve(executionsDir), "--json"],
        cwd: repoRoot,
      },
      failures,
    };
  }

  if (toolName === "grace-traceability-coverage") {
    const sourceDir = requireTargetValue(target.sourceDir, "sourceDir", toolName);
    if (typeof sourceDir !== "string") {
      failures.push(sourceDir);
      return { command: { command: nodeCommand, args: [], cwd: repoRoot }, failures };
    }
    const args = [script("grace-traceability-coverage.js"), "--dir", resolve(sourceDir), "--strict", "--json"];
    if (target.runtimeLogFile) {
      args.push("--runtime-log", resolve(target.runtimeLogFile));
    }
    return {
      command: {
        command: nodeCommand,
        args,
        cwd: repoRoot,
      },
      failures,
    };
  }

  if (toolName === "grace-delivery-trace") {
    const executionsDir = requireTargetValue(target.executionsDir, "executionsDir", toolName);
    const handoffFile = requireTargetValue(target.handoffFile, "handoffFile", toolName);
    const cwoFile = requireTargetValue(target.cwoFile, "cwoFile", toolName);
    const envelopeFile = requireTargetValue(target.envelopeFile, "envelopeFile", toolName);
    const memoryFile = requireTargetValue(target.memoryFile, "memoryFile", toolName);
    const forcedContextFile = requireTargetValue(target.forcedContextFile, "forcedContextFile", toolName);
    const loopGuardFile = requireTargetValue(target.loopGuardFile, "loopGuardFile", toolName);
    for (const value of [executionsDir, handoffFile, cwoFile, envelopeFile, memoryFile, forcedContextFile, loopGuardFile]) {
      if (typeof value !== "string") {
        failures.push(value);
      }
    }
    if (failures.length > 0) {
      return { command: { command: nodeCommand, args: [], cwd: repoRoot }, failures };
    }
    const resolvedExecutionsDir = executionsDir as string;
    const resolvedHandoffFile = handoffFile as string;
    const resolvedCwoFile = cwoFile as string;
    const resolvedEnvelopeFile = envelopeFile as string;
    const resolvedMemoryFile = memoryFile as string;
    const resolvedForcedContextFile = forcedContextFile as string;
    const resolvedLoopGuardFile = loopGuardFile as string;
    return {
      command: {
        command: nodeCommand,
        args: [
          script("grace-delivery-trace.js"),
          "--root",
          resolve(target.productRoot),
          "--executions",
          resolve(resolvedExecutionsDir),
          "--handoff",
          resolve(resolvedHandoffFile),
          "--cwo",
          resolve(resolvedCwoFile),
          "--envelope",
          resolve(resolvedEnvelopeFile),
          "--memory",
          resolve(resolvedMemoryFile),
          "--context",
          resolve(resolvedForcedContextFile),
          "--guard",
          resolve(resolvedLoopGuardFile),
          "--json",
        ],
        cwd: repoRoot,
      },
      failures,
    };
  }

  failures.push(buildFailure("NAMED_TOOL_UNKNOWN", `Unknown named legacy verification tool: ${toolName}`));
  return { command: { command: nodeCommand, args: [], cwd: repoRoot }, failures };
}

/**
 * <FUNCTION_CONTRACT id="FC-grace-adapters-runLegacyValidator">
 *   <Intent>Invoke one allowed legacy validator command through a bounded v2 adapter surface and persist one deterministic adapter report.</Intent>
 *   <Inputs>
 *     <Input name="input">Adapter metadata, one allowed command spec, and one durable report output location.</Input>
 *   </Inputs>
 *   <Outputs>
 *     <Output name="result">Deterministic adapter result containing the persisted report, artifact ref, and failures when present.</Output>
 *   </Outputs>
 *   <BlockAnchors>
 *     <BA ref="BA-grace-run-legacy-command" />
 *     <BA ref="BA-grace-persist-legacy-report" />
 *   </BlockAnchors>
 *   <Links>
 *     <Link ref="RequirementsAnalysis.xml#UC-GRACE-ADAPTER-COMPATIBILITY" />
 *     <Link ref="RequirementsAnalysis.xml#NFR-GRACE-COMPATIBILITY" />
 *   </Links>
 * </FUNCTION_CONTRACT>
 */
export function runLegacyValidator(input: LegacyValidatorInput): LegacyValidatorResult {
  const reportFile = resolve(input.reportFile);
  const executedAt = input.now ?? new Date().toISOString();
  const failures: LegacyValidatorFailure[] = [];

  /* <BLOCK_ANCHOR id="BA-grace-run-legacy-command" purpose="Run one explicitly allowed legacy validator command and capture deterministic stdout, stderr, and exit code" /> */
  if (!input.allowedCommands.includes(input.command.command)) {
    failures.push(
      buildFailure(
        "COMMAND_NOT_ALLOWED",
        `Legacy validator command ${input.command.command} is not in the allowed command set.`,
      ),
    );
  }

  let stdout = "";
  let stderr = "";
  let exitCode = 1;

  if (failures.length === 0) {
    const result = spawnSync(input.command.command, input.command.args, {
      cwd: input.command.cwd,
      encoding: "utf8",
      shell: false,
    });
    stdout = result.stdout ?? "";
    stderr = result.stderr ?? "";
    exitCode = typeof result.status === "number" ? result.status : 1;
    if (exitCode !== 0) {
      failures.push(
        buildFailure(
          "COMMAND_FAILED",
          `Legacy validator command exited with status ${exitCode}.`,
        ),
      );
    }
  }

  graceRuntimeLog({
    ba: BA_GRACE_RUN_LEGACY_COMMAND,
    belief: "Legacy v1 validators may run during migration only through an explicit bounded adapter command whitelist",
    fact: {
      adapterId: input.adapterId,
      toolName: input.toolName,
      command: input.command.command,
      args: input.command.args,
      exitCode,
      failureCount: failures.length,
    },
  });

  const report: LegacyValidatorReport = {
    schemaVersion: "grace-legacy-validator-report-v1",
    productId: input.productId,
    traceId: input.traceId,
    adapterId: input.adapterId,
    toolName: input.toolName,
    executedAt,
    ok: failures.length === 0,
    exitCode,
    command: {
      command: input.command.command,
      args: [...input.command.args],
      cwd: input.command.cwd ?? null,
    },
    stdout,
    stderr,
    failures,
  };

  /* <BLOCK_ANCHOR id="BA-grace-persist-legacy-report" purpose="Persist one deterministic adapter report artifact so later workflow nodes can consume legacy evidence under v2 control" /> */
  ensureParentDir(reportFile);
  writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  graceRuntimeLog({
    ba: BA_GRACE_PERSIST_LEGACY_REPORT,
    belief: "Every legacy adapter invocation must leave a durable report artifact before it can participate in v2 workflow evidence",
    fact: {
      reportFile,
      artifactRef: input.reportRef,
      ok: report.ok,
      exitCode,
    },
  });

  return {
    ok: report.ok,
    artifactRef: input.reportRef,
    reportFile,
    report,
    failures,
  };
}

export function runNamedLegacyVerificationAdapter(input: NamedLegacyVerificationAdapterInput): LegacyValidatorResult {
  const named = buildNamedToolCommand(input.toolName, input.target);
  if (named.failures.length > 0) {
    const reportFile = resolve(input.reportFile);
    const executedAt = input.now ?? new Date().toISOString();
    const report: LegacyValidatorReport = {
      schemaVersion: "grace-legacy-validator-report-v1",
      productId: input.productId,
      traceId: input.traceId,
      adapterId: input.adapterId,
      toolName: input.toolName,
      executedAt,
      ok: false,
      exitCode: 1,
      command: {
        command: named.command.command,
        args: [...named.command.args],
        cwd: named.command.cwd ?? null,
      },
      stdout: "",
      stderr: "",
      failures: named.failures,
    };
    ensureParentDir(reportFile);
    writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    return {
      ok: false,
      artifactRef: input.reportRef,
      reportFile,
      report,
      failures: named.failures,
    };
  }

  return runLegacyValidator({
    productId: input.productId,
    traceId: input.traceId,
    adapterId: input.adapterId,
    toolName: input.toolName,
    command: named.command,
    allowedCommands: [process.execPath],
    reportFile: input.reportFile,
    reportRef: input.reportRef,
    now: input.now,
  });
}

function buildMarkdownCompatibilityReport(report: Text2SqlCompatibilityPilotReport): string {
  const lines = [
    "# GRACE Compatibility Report: text2sql Pilot",
    "",
    `Date: \`${report.executedAt}\``,
    `Adapter: \`${report.adapterId}\``,
    `Target: \`${report.targetProductId}\``,
    "",
    "Legacy evidence consumed:",
    ...report.v1EvidenceRefs.map((ref) => `- \`${ref}\``),
    "",
    "Adapter-backed checks:",
    ...report.checks.map(
      (check) =>
        `- \`${check.toolName}\` -> ok=\`${check.ok}\`, exitCode=\`${check.exitCode}\`, failureCodes=\`${check.failureCodes.join(",") || "NONE"}\``,
    ),
    "",
    "Summary:",
    `- supportedChecks=\`${report.summary.supportedChecks}\``,
    `- blockedChecks=\`${report.summary.blockedChecks}\``,
    `- verificationStatusAligned=\`${report.summary.verificationStatusAligned}\``,
    `- traceabilityStatusAligned=\`${report.summary.traceabilityStatusAligned}\``,
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * text2sql pilot stays inside FC-grace-adapters-runLegacyValidator because it is only an orchestration
 * of already bounded adapter calls plus one deterministic compatibility report.
 */
export function runText2SqlCompatibilityPilot(input: Text2SqlCompatibilityPilotInput): {
  reportFile: string;
  markdownReportFile: string;
  reportRef: string;
  markdownReportRef: string;
  report: Text2SqlCompatibilityPilotReport;
} {
  const repoRoot = resolve(input.repoRoot);
  const targetProductRoot = resolve(input.targetProductRoot);
  const reportsDir = dirname(resolve(input.reportFile));
  const executedAt = input.now ?? new Date().toISOString();

  const verificationMarkdownRef = "text2sql/docs/grace/reports/Verification-20260405-Text2SQL-MVP.md";
  const verificationResultsRef = "text2sql/docs/grace/reports/verification-results-20260405.json";
  const runtimeEvidenceRef = "text2sql/docs/grace/reports/runtime-evidence-20260405.jsonl";
  const verificationMarkdownFile = resolve(repoRoot, verificationMarkdownRef);
  const verificationResultsFile = resolve(repoRoot, verificationResultsRef);
  const runtimeEvidenceFile = resolve(repoRoot, runtimeEvidenceRef);

  const validateReportRef = "docs/grace/reports/text2sql-pilot-legacy-validate-report.json";
  const traceabilityReportRef = "docs/grace/reports/text2sql-pilot-legacy-traceability-report.json";
  const executionProofReportRef = "docs/grace/reports/text2sql-pilot-legacy-execution-proof-report.json";
  const deliveryTraceReportRef = "docs/grace/reports/text2sql-pilot-legacy-delivery-trace-report.json";

  const validateResult = runNamedLegacyVerificationAdapter({
    productId: input.productId,
    traceId: input.traceId,
    adapterId: `${input.adapterId}-validate`,
    toolName: "grace-validate-product",
    target: {
      repoRoot,
      productRoot: targetProductRoot,
    },
    reportFile: resolve(reportsDir, "text2sql-pilot-legacy-validate-report.json"),
    reportRef: validateReportRef,
    now: executedAt,
  });

  const traceabilityResult = runNamedLegacyVerificationAdapter({
    productId: input.productId,
    traceId: input.traceId,
    adapterId: `${input.adapterId}-traceability`,
    toolName: "grace-traceability-coverage",
    target: {
      repoRoot,
      productRoot: targetProductRoot,
      sourceDir: resolve(targetProductRoot, "src"),
      runtimeLogFile: runtimeEvidenceFile,
    },
    reportFile: resolve(reportsDir, "text2sql-pilot-legacy-traceability-report.json"),
    reportRef: traceabilityReportRef,
    now: executedAt,
  });

  const executionProofResult = runNamedLegacyVerificationAdapter({
    productId: input.productId,
    traceId: input.traceId,
    adapterId: `${input.adapterId}-execution-proof`,
    toolName: "grace-execution-proof",
    target: {
      repoRoot,
      productRoot: targetProductRoot,
    },
    reportFile: resolve(reportsDir, "text2sql-pilot-legacy-execution-proof-report.json"),
    reportRef: executionProofReportRef,
    now: executedAt,
  });

  const deliveryTraceResult = runNamedLegacyVerificationAdapter({
    productId: input.productId,
    traceId: input.traceId,
    adapterId: `${input.adapterId}-delivery-trace`,
    toolName: "grace-delivery-trace",
    target: {
      repoRoot,
      productRoot: targetProductRoot,
    },
    reportFile: resolve(reportsDir, "text2sql-pilot-legacy-delivery-trace-report.json"),
    reportRef: deliveryTraceReportRef,
    now: executedAt,
  });

  const checks: Text2SqlCompatibilityPilotCheck[] = [
    validateResult,
    traceabilityResult,
    executionProofResult,
    deliveryTraceResult,
  ].map((result) => ({
    toolName: result.report.toolName as LegacyVerificationToolName,
    ok: result.ok,
    exitCode: result.report.exitCode,
    artifactRef: result.artifactRef,
    failureCodes: result.failures.map((failure) => failure.code),
  }));

  const verificationStatusAligned =
    existsSync(verificationMarkdownFile) &&
    readFileSync(verificationMarkdownFile, "utf8").includes("Status: `PASS`") &&
    validateResult.ok;
  const traceabilityStatusAligned =
    existsSync(runtimeEvidenceFile) &&
    traceabilityResult.ok &&
    JSON.parse(traceabilityResult.report.stdout).runtimeBackedPass === true;

  const report: Text2SqlCompatibilityPilotReport = {
    schemaVersion: "grace-text2sql-compatibility-report-v1",
    productId: input.productId,
    traceId: input.traceId,
    adapterId: input.adapterId,
    targetProductId: "text2sql",
    executedAt,
    targetProductRoot,
    v1EvidenceRefs: [verificationMarkdownRef, verificationResultsRef, runtimeEvidenceRef],
    checks,
    summary: {
      supportedChecks: checks.filter((check) => check.ok).length,
      blockedChecks: checks.filter((check) => !check.ok).length,
      verificationStatusAligned,
      traceabilityStatusAligned,
    },
  };

  ensureParentDir(resolve(input.reportFile));
  writeFileSync(resolve(input.reportFile), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(resolve(input.markdownReportFile), buildMarkdownCompatibilityReport(report), "utf8");

  graceRuntimeLog({
    ba: BA_GRACE_PERSIST_LEGACY_REPORT,
    belief: "A v2 migration pilot is auditable only when legacy evidence and adapter-backed results are collapsed into one deterministic compatibility report",
    fact: {
      targetProductRoot,
      reportFile: resolve(input.reportFile),
      markdownReportFile: resolve(input.markdownReportFile),
      supportedChecks: report.summary.supportedChecks,
      blockedChecks: report.summary.blockedChecks,
    },
  });

  return {
    reportFile: resolve(input.reportFile),
    markdownReportFile: resolve(input.markdownReportFile),
    reportRef: input.reportRef,
    markdownReportRef: input.markdownReportRef,
    report,
  };
}
