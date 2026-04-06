import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  runLegacyValidator,
  runNamedLegacyVerificationAdapter,
} from "./legacy-validator.js";

function withMutedConsoleError<T>(fn: () => T): T {
  const original = console.error;
  console.error = () => undefined;
  try {
    return fn();
  } finally {
    console.error = original;
  }
}

test("FC-grace-adapters-runLegacyValidator runs one allowed legacy command and persists a deterministic report", () => {
  const dir = mkdtempSync(join(tmpdir(), "grace-legacy-adapter-"));
  const reportFile = join(dir, "legacy-validator-report.json");

  const result = withMutedConsoleError(() =>
    runLegacyValidator({
      productId: "grace",
      traceId: "TRACE-GRACE-CORE",
      adapterId: "ADAPTER-VERIFY-01",
      toolName: "echo-validator",
      command: {
        command: process.execPath,
        args: ["-e", "process.stdout.write('validator-pass')"],
      },
      allowedCommands: [process.execPath],
      reportFile,
      reportRef: "docs/grace/reports/legacy-validator-report.json",
      now: "2026-04-05T11:30:00+03:00",
    }),
  );

  assert.equal(result.ok, true);
  assert.equal(result.report.exitCode, 0);
  assert.match(result.report.stdout, /validator-pass/u);
  assert.match(readFileSync(reportFile, "utf8"), /grace-legacy-validator-report-v1/u);
});

test("FC-grace-adapters-runLegacyValidator blocks commands outside the allowed set and still persists a report", () => {
  const dir = mkdtempSync(join(tmpdir(), "grace-legacy-adapter-"));
  const reportFile = join(dir, "legacy-validator-report.json");

  const result = withMutedConsoleError(() =>
    runLegacyValidator({
      productId: "grace",
      traceId: "TRACE-GRACE-CORE",
      adapterId: "ADAPTER-VERIFY-02",
      toolName: "blocked-validator",
      command: {
        command: process.execPath,
        args: ["-e", "process.exit(0)"],
      },
      allowedCommands: ["node-not-allowed"],
      reportFile,
      reportRef: "docs/grace/reports/legacy-validator-report.json",
      now: "2026-04-05T11:31:00+03:00",
    }),
  );

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.failures.map((failure) => failure.code),
    ["COMMAND_NOT_ALLOWED"],
  );
  assert.match(readFileSync(reportFile, "utf8"), /COMMAND_NOT_ALLOWED/u);
});

test("FC-grace-adapters-runLegacyValidator reports command failure deterministically", () => {
  const dir = mkdtempSync(join(tmpdir(), "grace-legacy-adapter-"));
  const reportFile = join(dir, "legacy-validator-report.json");

  const result = withMutedConsoleError(() =>
    runLegacyValidator({
      productId: "grace",
      traceId: "TRACE-GRACE-CORE",
      adapterId: "ADAPTER-VERIFY-03",
      toolName: "failing-validator",
      command: {
        command: process.execPath,
        args: ["-e", "process.stderr.write('validator-fail'); process.exit(3)"],
      },
      allowedCommands: [process.execPath],
      reportFile,
      reportRef: "docs/grace/reports/legacy-validator-report.json",
      now: "2026-04-05T11:32:00+03:00",
    }),
  );

  assert.equal(result.ok, false);
  assert.equal(result.report.exitCode, 3);
  assert.match(result.report.stderr, /validator-fail/u);
  assert.deepEqual(
    result.failures.map((failure) => failure.code),
    ["COMMAND_FAILED"],
  );
});

test("FC-grace-adapters-runLegacyValidator runs named grace-validate-product through the bounded adapter surface", () => {
  const dir = mkdtempSync(join(tmpdir(), "grace-legacy-adapter-"));
  const reportFile = join(dir, "legacy-validate-report.json");

  const result = withMutedConsoleError(() =>
    runNamedLegacyVerificationAdapter({
      productId: "grace",
      traceId: "TRACE-GRACE-CORE",
      adapterId: "ADAPTER-VALIDATE-01",
      toolName: "grace-validate-product",
      target: {
        repoRoot: process.cwd(),
        productRoot: process.cwd(),
      },
      reportFile,
      reportRef: "docs/grace/reports/legacy-validate-report.json",
      now: "2026-04-05T12:10:00+03:00",
    }),
  );

  assert.equal(result.ok, true);
  assert.equal(result.report.exitCode, 0);
  assert.equal(JSON.parse(result.report.stdout).valid, true);
});

test("FC-grace-adapters-runLegacyValidator runs named grace-execution-proof through the bounded adapter surface", () => {
  const dir = mkdtempSync(join(tmpdir(), "grace-legacy-adapter-"));
  const reportFile = join(dir, "legacy-execution-proof-report.json");

  const result = withMutedConsoleError(() =>
    runNamedLegacyVerificationAdapter({
      productId: "grace",
      traceId: "TRACE-GRACE-CORE",
      adapterId: "ADAPTER-EXECUTION-PROOF-01",
      toolName: "grace-execution-proof",
      target: {
        repoRoot: process.cwd(),
        productRoot: process.cwd(),
        executionsDir: resolve(process.cwd(), "docs", "grace", "executions"),
      },
      reportFile,
      reportRef: "docs/grace/reports/legacy-execution-proof-report.json",
      now: "2026-04-05T12:11:00+03:00",
    }),
  );

  assert.equal(result.ok, false);
  assert.equal(result.report.exitCode, 1);
  assert.equal(JSON.parse(result.report.stdout).valid, false);
  assert.deepEqual(
    result.failures.map((failure) => failure.code),
    ["COMMAND_FAILED"],
  );
});

test("FC-grace-adapters-runLegacyValidator materializes named grace-delivery-trace command configuration", () => {
  const dir = mkdtempSync(join(tmpdir(), "grace-legacy-adapter-"));
  const reportFile = join(dir, "legacy-delivery-trace-report.json");

  const result = withMutedConsoleError(() =>
    runNamedLegacyVerificationAdapter({
      productId: "grace",
      traceId: "TRACE-GRACE-CORE",
      adapterId: "ADAPTER-DELIVERY-TRACE-01",
      toolName: "grace-delivery-trace",
      target: {
        repoRoot: process.cwd(),
        productRoot: process.cwd(),
        executionsDir: resolve(process.cwd(), "docs", "grace", "executions"),
      },
      reportFile,
      reportRef: "docs/grace/reports/legacy-delivery-trace-report.json",
      now: "2026-04-05T12:12:00+03:00",
    }),
  );

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.failures.map((failure) => failure.code),
    [
      "NAMED_TOOL_INPUT_MISSING",
      "NAMED_TOOL_INPUT_MISSING",
      "NAMED_TOOL_INPUT_MISSING",
      "NAMED_TOOL_INPUT_MISSING",
      "NAMED_TOOL_INPUT_MISSING",
      "NAMED_TOOL_INPUT_MISSING",
    ],
  );
  assert.match(readFileSync(reportFile, "utf8"), /grace-delivery-trace/u);
});

test("FC-grace-adapters-runLegacyValidator materializes named grace-traceability-coverage command configuration", () => {
  const dir = mkdtempSync(join(tmpdir(), "grace-legacy-adapter-"));
  const reportFile = join(dir, "legacy-traceability-coverage-report.json");

  const result = withMutedConsoleError(() =>
    runNamedLegacyVerificationAdapter({
      productId: "grace",
      traceId: "TRACE-GRACE-CORE",
      adapterId: "ADAPTER-TRACEABILITY-01",
      toolName: "grace-traceability-coverage",
      target: {
        repoRoot: process.cwd(),
        productRoot: process.cwd(),
      },
      reportFile,
      reportRef: "docs/grace/reports/legacy-traceability-coverage-report.json",
      now: "2026-04-05T12:13:00+03:00",
    }),
  );

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.failures.map((failure) => failure.code),
    ["NAMED_TOOL_INPUT_MISSING"],
  );
  assert.match(readFileSync(reportFile, "utf8"), /grace-traceability-coverage/u);
});
