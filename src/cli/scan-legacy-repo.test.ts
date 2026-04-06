import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { bootstrapLegacyOverlayWorkspace } from "../legacy/bootstrap.js";
import { resolveLegacyOverlayTarget } from "../legacy/index.js";

test("scan-legacy-repo CLI emits a JSON scan summary for a bootstrapped overlay", () => {
  const repoRoot = process.cwd();
  const dir = mkdtempSync(join(tmpdir(), "grace-legacy-scan-cli-"));
  const productRoot = join(dir, "overlay");
  const sourceRepoRoot = join(dir, "legacy-source");

  mkdirSync(join(sourceRepoRoot, "src"), { recursive: true });
  writeFileSync(join(sourceRepoRoot, "src", "server.ts"), "export const server = true;\n", "utf8");
  writeFileSync(join(sourceRepoRoot, "package.json"), '{ "name": "legacy-cli" }\n', "utf8");

  const target = resolveLegacyOverlayTarget({
    repoRoot,
    productRoot,
    sourceRepoRoot,
    productId: "legacy-scan-cli",
  });

  bootstrapLegacyOverlayWorkspace({
    target,
    frameworkRoot: repoRoot,
    productName: "Legacy Scan CLI",
  });

  const run = spawnSync(
    process.execPath,
    [
      join(repoRoot, "dist", "cli", "scan-legacy-repo.js"),
      "--repo-root",
      repoRoot,
      "--product-root",
      productRoot,
      "--source-repo-root",
      sourceRepoRoot,
      "--product-id",
      "legacy-scan-cli",
      "--json",
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );

  assert.equal(run.status, 0, run.stdout || run.stderr);
  const payload = JSON.parse(run.stdout) as {
    ok: boolean;
    summary: {
      totalFiles: number;
      dependencySurfaceCount: number;
    };
    riskSummary: {
      findingCount: number;
    };
  };

  assert.equal(payload.ok, true);
  assert.equal(payload.summary.totalFiles >= 2, true);
  assert.equal(payload.summary.dependencySurfaceCount, 1);
  assert.equal(typeof payload.riskSummary.findingCount, "number");
});
