import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { bootstrapLegacyOverlayWorkspace } from "./bootstrap.js";
import { inferLegacyContracts } from "./infer-contracts.js";
import { resolveLegacyOverlayTarget } from "./index.js";
import { scanLegacyRepository } from "./scan.js";
import { proposeLegacyDryRunEdit, readLegacySlicePlan, proposeLegacySlice } from "./slice-propose.js";
import { seedLegacyTraceability } from "./trace-seed.js";

test("proposeLegacySlice emits deterministic bounded first-slice candidates without mutating source repo", () => {
  const repoRoot = process.cwd();
  const dir = mkdtempSync(join(tmpdir(), "grace-legacy-slices-"));
  const productRoot = join(dir, "overlay");
  const sourceRepoRoot = join(dir, "legacy-source");
  const entryFile = join(sourceRepoRoot, "src", "main.ts");

  mkdirSync(join(sourceRepoRoot, "src"), { recursive: true });
  writeFileSync(join(sourceRepoRoot, "package.json"), '{ "name": "legacy-slices" }\n', "utf8");
  writeFileSync(entryFile, "export const main = true;\n", "utf8");

  const target = resolveLegacyOverlayTarget({
    repoRoot,
    productRoot,
    sourceRepoRoot,
    productId: "legacy-slices-demo",
  });

  bootstrapLegacyOverlayWorkspace({
    target,
    frameworkRoot: repoRoot,
    productName: "Legacy Slices Demo",
  });
  scanLegacyRepository({ target });
  inferLegacyContracts({ target });
  seedLegacyTraceability({ target });

  const beforeSource = readFileSync(entryFile, "utf8");
  const result = proposeLegacySlice({ target });

  assert.ok(existsSync(result.planFile));
  assert.equal(readFileSync(entryFile, "utf8"), beforeSource);
  assert.equal(result.plan.summary.candidateCount >= 1, true);
  assert.ok(result.plan.candidates.some((candidate) => candidate.writablePathHints.includes("src/main.ts")));
});

test("readLegacySlicePlan loads persisted slice proposal plan", () => {
  const repoRoot = process.cwd();
  const dir = mkdtempSync(join(tmpdir(), "grace-legacy-slices-read-"));
  const productRoot = join(dir, "overlay");
  const sourceRepoRoot = join(dir, "legacy-source");

  mkdirSync(join(sourceRepoRoot, "src"), { recursive: true });
  writeFileSync(join(sourceRepoRoot, "src", "app.js"), "module.exports = {};\n", "utf8");

  const target = resolveLegacyOverlayTarget({
    repoRoot,
    productRoot,
    sourceRepoRoot,
    productId: "legacy-slices-read",
  });

  bootstrapLegacyOverlayWorkspace({
    target,
    frameworkRoot: repoRoot,
    productName: "Legacy Slices Read",
  });
  scanLegacyRepository({ target });
  inferLegacyContracts({ target });
  seedLegacyTraceability({ target });

  const result = proposeLegacySlice({ target });
  const loaded = readLegacySlicePlan(result.planFile);

  assert.equal(loaded.productId, "legacy-slices-read");
  assert.equal(loaded.summary.candidateCount >= 1, true);
});

test("proposeLegacyDryRunEdit enforces write-mode and editable whitelist without mutating source repo", () => {
  const repoRoot = process.cwd();
  const dir = mkdtempSync(join(tmpdir(), "grace-legacy-dryrun-"));
  const productRoot = join(dir, "overlay");
  const sourceRepoRoot = join(dir, "legacy-source");
  const entryFile = join(sourceRepoRoot, "src", "main.ts");

  mkdirSync(join(sourceRepoRoot, "src"), { recursive: true });
  writeFileSync(join(sourceRepoRoot, "package.json"), '{ "name": "legacy-dryrun" }\n', "utf8");
  writeFileSync(entryFile, "export const main = true;\n", "utf8");

  const target = resolveLegacyOverlayTarget({
    repoRoot,
    productRoot,
    sourceRepoRoot,
    productId: "legacy-dryrun-demo",
  });

  bootstrapLegacyOverlayWorkspace({
    target,
    frameworkRoot: repoRoot,
    productName: "Legacy Dry Run Demo",
  });
  scanLegacyRepository({ target });
  inferLegacyContracts({ target });
  seedLegacyTraceability({ target });
  const plan = proposeLegacySlice({ target });
  const sliceId = plan.plan.candidates[0]?.id;
  assert.equal(typeof sliceId, "string");

  const unauthorized = proposeLegacyDryRunEdit({
    target,
    sliceId: String(sliceId),
    requestedWritePaths: [entryFile],
    writeModeAuthorized: false,
  });
  assert.equal(unauthorized.dryRun.ok, false);
  assert.match(JSON.stringify(unauthorized.dryRun.failures), /LEGACY_WRITE_MODE_REQUIRED/u);

  const authorized = proposeLegacyDryRunEdit({
    target,
    sliceId: String(sliceId),
    requestedWritePaths: [entryFile],
    writeModeAuthorized: true,
  });
  assert.equal(typeof authorized.dryRun.ok, "boolean");
  assert.equal(readFileSync(entryFile, "utf8"), "export const main = true;\n");
});
