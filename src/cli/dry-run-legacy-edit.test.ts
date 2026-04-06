import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import test from "node:test";
import { bootstrapLegacyOverlayWorkspace } from "../legacy/bootstrap.js";
import { inferLegacyContracts } from "../legacy/infer-contracts.js";
import { scanLegacyRepository } from "../legacy/scan.js";
import { proposeLegacySlice } from "../legacy/slice-propose.js";
import { seedLegacyTraceability } from "../legacy/trace-seed.js";
import { resolveLegacyOverlayTarget } from "../runtime/product-target.js";

test("dry-run-legacy-edit CLI emits JSON summary for a write-authorized bounded legacy slice", () => {
  const repoRoot = process.cwd();
  const rootDir = mkdtempSync(join(tmpdir(), "grace-legacy-dry-run-"));
  const productRoot = join(rootDir, "legacy-overlay");
  const sourceRepoRoot = join(rootDir, "legacy-source");
  mkdirSync(join(sourceRepoRoot, "src"), { recursive: true });
  writeFileSync(
    join(sourceRepoRoot, "src", "main.ts"),
    "export function main(): string {\n  return 'legacy';\n}\n",
    "utf8",
  );
  writeFileSync(
    join(sourceRepoRoot, "package.json"),
    `${JSON.stringify({ name: "legacy-dry-run", version: "0.0.0" }, null, 2)}\n`,
    "utf8",
  );

  const target = resolveLegacyOverlayTarget({
    repoRoot,
    productRoot,
    sourceRepoRoot,
    productId: "legacy-dry-run",
  });
  bootstrapLegacyOverlayWorkspace({
    target,
    frameworkRoot: repoRoot,
  });
  scanLegacyRepository({ target });
  inferLegacyContracts({ target });
  seedLegacyTraceability({ target });
  const plan = proposeLegacySlice({ target });
  const sliceId = plan.plan.candidates[0]?.id;
  assert.equal(typeof sliceId, "string");

  const stdout = execFileSync(
    process.execPath,
    [
      resolve(process.cwd(), "dist", "cli", "dry-run-legacy-edit.js"),
      "--repo-root",
      repoRoot,
      "--product-root",
      productRoot,
      "--source-repo-root",
      sourceRepoRoot,
      "--product-id",
      target.productId,
      "--slice-id",
      String(sliceId),
      "--requested-write-path",
      join(sourceRepoRoot, "src", "README.md"),
      "--write-mode-authorized",
      "--json",
    ],
    { encoding: "utf8" },
  );

  const payload = JSON.parse(stdout) as { ok: boolean; sliceId: string };
  assert.equal(typeof payload.ok, "boolean");
  assert.equal(payload.sliceId, sliceId);
});
