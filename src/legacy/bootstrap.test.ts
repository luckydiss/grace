import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { bootstrapLegacyOverlayWorkspace, persistLegacyOverlayMetadata } from "./bootstrap.js";
import { resolveLegacyOverlayTarget } from "./index.js";

test("persistLegacyOverlayMetadata writes LegacyWorkspace and SourceRepoMap sidecars", () => {
  const dir = mkdtempSync(join(tmpdir(), "grace-legacy-overlay-"));
  const target = resolveLegacyOverlayTarget({
    repoRoot: "C:/repo",
    productRoot: "C:/repo/products/legacy-overlay",
    sourceRepoRoot: "C:/repo/legacy/billing-service",
    productId: "billing-legacy",
  });

  const legacyWorkspaceFile = join(dir, "LegacyWorkspace.json");
  const sourceRepoMapFile = join(dir, "SourceRepoMap.json");
  const result = persistLegacyOverlayMetadata({
    target,
    legacyWorkspaceFile,
    sourceRepoMapFile,
  });

  assert.ok(existsSync(legacyWorkspaceFile));
  assert.ok(existsSync(sourceRepoMapFile));
  assert.equal(result.legacyWorkspace.metadata.overlayRelativeToRepoRoot, "products/legacy-overlay");
  assert.equal(result.sourceRepoMap.refs.sourceRepoRootRef, "legacy/billing-service");
  assert.match(readFileSync(legacyWorkspaceFile, "utf8"), /grace-legacy-workspace-v1/u);
  assert.match(readFileSync(sourceRepoMapFile, "utf8"), /grace-source-repo-map-v1/u);
});

test("bootstrapLegacyOverlayWorkspace creates read-only overlay artifacts without mutating source repo", () => {
  const repoRoot = process.cwd();
  const dir = mkdtempSync(join(tmpdir(), "grace-legacy-bootstrap-"));
  const productRoot = join(dir, "overlay");
  const sourceRepoRoot = join(dir, "legacy-source");
  const sourceSentinel = join(sourceRepoRoot, "src", "sentinel.txt");

  mkdirSync(join(sourceRepoRoot, "src"), { recursive: true });
  writeFileSync(sourceSentinel, "legacy-source-unchanged\n", "utf8");

  const target = resolveLegacyOverlayTarget({
    repoRoot,
    productRoot,
    sourceRepoRoot,
    productId: "legacy-billing",
  });

  const result = bootstrapLegacyOverlayWorkspace({
    target,
    frameworkRoot: repoRoot,
    productName: "Legacy Billing Overlay",
  });

  assert.ok(existsSync(join(productRoot, "docs", "grace", "RequirementsAnalysis.xml")));
  assert.ok(existsSync(join(productRoot, "docs", "grace", "Technology.xml")));
  assert.ok(existsSync(join(productRoot, "docs", "grace", "DevelopmentPlan.xml")));
  assert.ok(existsSync(join(productRoot, "docs", "grace", "DevelopmentExecutionPlan.xml")));
  assert.ok(existsSync(join(productRoot, "docs", "grace", "state", "WorkflowState.json")));
  assert.ok(existsSync(join(productRoot, "docs", "grace", "policies", "transition-policy.json")));
  assert.equal(readFileSync(sourceSentinel, "utf8"), "legacy-source-unchanged\n");
  assert.match(readFileSync(result.policyFile, "utf8"), /legacy-billing/u);
});

test("bootstrapped legacy overlay passes product validation", () => {
  const repoRoot = process.cwd();
  const dir = mkdtempSync(join(tmpdir(), "grace-legacy-validate-"));
  const productRoot = join(dir, "overlay");
  const sourceRepoRoot = join(dir, "legacy-source");
  const sourceSentinel = join(sourceRepoRoot, "src", "app.ts");

  mkdirSync(join(sourceRepoRoot, "src"), { recursive: true });
  writeFileSync(sourceSentinel, "export const untouched = true;\n", "utf8");

  const target = resolveLegacyOverlayTarget({
    repoRoot,
    productRoot,
    sourceRepoRoot,
    productId: "legacy-validated",
  });

  bootstrapLegacyOverlayWorkspace({
    target,
    frameworkRoot: repoRoot,
    productName: "Legacy Validated Overlay",
  });

  const validation = spawnSync(
    process.execPath,
    [join(repoRoot, "out", "tools", "grace-validate.js"), "--mode", "product", "--root", productRoot],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );

  assert.equal(validation.status, 0, validation.stdout || validation.stderr);
  assert.match(validation.stdout, /VALIDATION_PASS/u);
  assert.equal(readFileSync(sourceSentinel, "utf8"), "export const untouched = true;\n");
});
