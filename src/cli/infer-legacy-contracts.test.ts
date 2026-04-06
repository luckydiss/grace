import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { bootstrapLegacyOverlayWorkspace } from "../legacy/bootstrap.js";
import { resolveLegacyOverlayTarget } from "../legacy/index.js";
import { scanLegacyRepository } from "../legacy/scan.js";

test("infer-legacy-contracts CLI emits a JSON draft-contract summary for a bootstrapped overlay", () => {
  const repoRoot = process.cwd();
  const dir = mkdtempSync(join(tmpdir(), "grace-legacy-contracts-cli-"));
  const productRoot = join(dir, "overlay");
  const sourceRepoRoot = join(dir, "legacy-source");

  mkdirSync(join(sourceRepoRoot, "src"), { recursive: true });
  writeFileSync(join(sourceRepoRoot, "src", "server.ts"), "export const server = true;\n", "utf8");
  writeFileSync(join(sourceRepoRoot, "package.json"), '{ "name": "legacy-contracts-cli" }\n', "utf8");

  const target = resolveLegacyOverlayTarget({
    repoRoot,
    productRoot,
    sourceRepoRoot,
    productId: "legacy-contracts-cli",
  });

  bootstrapLegacyOverlayWorkspace({
    target,
    frameworkRoot: repoRoot,
    productName: "Legacy Contracts CLI",
  });
  scanLegacyRepository({ target });

  const run = spawnSync(
    process.execPath,
    [
      join(repoRoot, "dist", "cli", "infer-legacy-contracts.js"),
      "--repo-root",
      repoRoot,
      "--product-root",
      productRoot,
      "--source-repo-root",
      sourceRepoRoot,
      "--product-id",
      "legacy-contracts-cli",
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
      moduleContractCount: number;
      functionContractCount: number;
      blockAnchorCount: number;
    };
  };

  assert.equal(payload.ok, true);
  assert.equal(payload.summary.moduleContractCount >= 1, true);
  assert.equal(payload.summary.functionContractCount >= 1, true);
  assert.equal(payload.summary.blockAnchorCount >= 1, true);
});
