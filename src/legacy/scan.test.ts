import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { bootstrapLegacyOverlayWorkspace } from "./bootstrap.js";
import { resolveLegacyOverlayTarget } from "./index.js";
import { readLegacyRiskReport, readLegacyScanReport, scanLegacyRepository } from "./scan.js";

test("scanLegacyRepository emits deterministic topology and discovery artifacts without mutating source repo", () => {
  const repoRoot = process.cwd();
  const dir = mkdtempSync(join(tmpdir(), "grace-legacy-scan-"));
  const productRoot = join(dir, "overlay");
  const sourceRepoRoot = join(dir, "legacy-source");
  const packageFile = join(sourceRepoRoot, "package.json");
  const entryFile = join(sourceRepoRoot, "src", "main.ts");
  const testFile = join(sourceRepoRoot, "tests", "main.test.ts");
  const configFile = join(sourceRepoRoot, "tsconfig.json");

  mkdirSync(join(sourceRepoRoot, "src"), { recursive: true });
  mkdirSync(join(sourceRepoRoot, "tests"), { recursive: true });
  writeFileSync(packageFile, '{ "name": "legacy-app" }\n', "utf8");
  writeFileSync(entryFile, "export const main = true;\n", "utf8");
  writeFileSync(testFile, "export const tested = true;\n", "utf8");
  writeFileSync(configFile, '{ "compilerOptions": {} }\n', "utf8");

  const target = resolveLegacyOverlayTarget({
    repoRoot,
    productRoot,
    sourceRepoRoot,
    productId: "legacy-scan-demo",
  });

  bootstrapLegacyOverlayWorkspace({
    target,
    frameworkRoot: repoRoot,
    productName: "Legacy Scan Demo",
  });

  const beforeSourceSentinel = readFileSync(entryFile, "utf8");
  const result = scanLegacyRepository({ target });

  assert.ok(existsSync(result.reportFile));
  assert.ok(existsSync(result.riskReportFile));
  assert.equal(readFileSync(entryFile, "utf8"), beforeSourceSentinel);
  assert.ok(result.report.entrypoints.includes("src/main.ts"));
  assert.ok(result.report.tests.includes("tests/main.test.ts"));
  assert.ok(result.report.configs.includes("tsconfig.json"));
  assert.ok(result.report.dependencySurfaces.includes("package.json"));
  assert.equal(result.report.summary.byLanguage.typescript, 2);
  assert.equal(result.riskReport.summary.highestSeverity, "none");
});

test("readLegacyScanReport loads persisted scan report", () => {
  const repoRoot = process.cwd();
  const dir = mkdtempSync(join(tmpdir(), "grace-legacy-scan-read-"));
  const productRoot = join(dir, "overlay");
  const sourceRepoRoot = join(dir, "legacy-source");

  mkdirSync(join(sourceRepoRoot, "src"), { recursive: true });
  writeFileSync(join(sourceRepoRoot, "src", "app.js"), "module.exports = {};\n", "utf8");

  const target = resolveLegacyOverlayTarget({
    repoRoot,
    productRoot,
    sourceRepoRoot,
    productId: "legacy-scan-read",
  });

  bootstrapLegacyOverlayWorkspace({
    target,
    frameworkRoot: repoRoot,
    productName: "Legacy Scan Read",
  });

  const result = scanLegacyRepository({ target });
  const loaded = readLegacyScanReport(result.reportFile);

  assert.equal(loaded.productId, "legacy-scan-read");
  assert.ok(loaded.topology.some((entry) => entry.ref === "src/app.js"));
});

test("scanLegacyRepository emits a deterministic risk report for no-test and large-file conditions", () => {
  const repoRoot = process.cwd();
  const dir = mkdtempSync(join(tmpdir(), "grace-legacy-risk-"));
  const productRoot = join(dir, "overlay");
  const sourceRepoRoot = join(dir, "legacy-source");
  const largeFile = join(sourceRepoRoot, "src", "oversized.ts");

  mkdirSync(join(sourceRepoRoot, "src"), { recursive: true });
  writeFileSync(join(sourceRepoRoot, "package.json"), '{ "name": "legacy-risk-demo" }\n', "utf8");
  writeFileSync(largeFile, `${Array.from({ length: 340 }, (_, index) => `export const line${index} = ${index};`).join("\n")}\n`, "utf8");

  const target = resolveLegacyOverlayTarget({
    repoRoot,
    productRoot,
    sourceRepoRoot,
    productId: "legacy-risk-demo",
  });

  bootstrapLegacyOverlayWorkspace({
    target,
    frameworkRoot: repoRoot,
    productName: "Legacy Risk Demo",
  });

  const result = scanLegacyRepository({ target });
  const risk = readLegacyRiskReport(result.riskReportFile);

  assert.equal(risk.productId, "legacy-risk-demo");
  assert.equal(risk.summary.highestSeverity, "warn");
  assert.equal((risk.summary.byCode.NO_TESTS_DETECTED ?? 0) >= 1, true);
  assert.equal((risk.summary.byCode.LARGE_FILE ?? 0) >= 1, true);
  assert.ok(risk.findings.some((finding) => finding.ref === "src/oversized.ts"));
});
