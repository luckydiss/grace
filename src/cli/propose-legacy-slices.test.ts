import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { bootstrapLegacyOverlayWorkspace } from "../legacy/bootstrap.js";
import { inferLegacyContracts } from "../legacy/infer-contracts.js";
import { resolveLegacyOverlayTarget } from "../legacy/index.js";
import { scanLegacyRepository } from "../legacy/scan.js";
import { seedLegacyTraceability } from "../legacy/trace-seed.js";

test("propose-legacy-slices CLI emits a JSON slice-plan summary for a bootstrapped overlay", () => {
  const repoRoot = process.cwd();
  const dir = mkdtempSync(join(tmpdir(), "grace-legacy-slices-cli-"));
  const productRoot = join(dir, "overlay");
  const sourceRepoRoot = join(dir, "legacy-source");

  mkdirSync(join(sourceRepoRoot, "src"), { recursive: true });
  writeFileSync(join(sourceRepoRoot, "src", "server.ts"), "export const server = true;\n", "utf8");
  writeFileSync(join(sourceRepoRoot, "package.json"), '{ "name": "legacy-slices-cli" }\n', "utf8");

  const target = resolveLegacyOverlayTarget({
    repoRoot,
    productRoot,
    sourceRepoRoot,
    productId: "legacy-slices-cli",
  });

  bootstrapLegacyOverlayWorkspace({
    target,
    frameworkRoot: repoRoot,
    productName: "Legacy Slices CLI",
  });
  scanLegacyRepository({ target });
  inferLegacyContracts({ target });
  seedLegacyTraceability({ target });

  const run = spawnSync(
    process.execPath,
    [
      join(repoRoot, "dist", "cli", "propose-legacy-slices.js"),
      "--repo-root",
      repoRoot,
      "--product-root",
      productRoot,
      "--source-repo-root",
      sourceRepoRoot,
      "--product-id",
      "legacy-slices-cli",
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
      candidateCount: number;
      highRiskCandidateCount: number;
    };
  };

  assert.equal(payload.ok, true);
  assert.equal(payload.summary.candidateCount >= 1, true);
  assert.equal(typeof payload.summary.highRiskCandidateCount, "number");
});
