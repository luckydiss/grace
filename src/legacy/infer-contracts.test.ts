import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { bootstrapLegacyOverlayWorkspace } from "./bootstrap.js";
import { inferLegacyContracts, readLegacyContractDrafts } from "./infer-contracts.js";
import { resolveLegacyOverlayTarget } from "./index.js";
import { scanLegacyRepository } from "./scan.js";

test("inferLegacyContracts emits deterministic draft contracts without mutating source repo", () => {
  const repoRoot = process.cwd();
  const dir = mkdtempSync(join(tmpdir(), "grace-legacy-contracts-"));
  const productRoot = join(dir, "overlay");
  const sourceRepoRoot = join(dir, "legacy-source");
  const entryFile = join(sourceRepoRoot, "src", "main.ts");
  const testFile = join(sourceRepoRoot, "tests", "main.test.ts");

  mkdirSync(join(sourceRepoRoot, "src"), { recursive: true });
  mkdirSync(join(sourceRepoRoot, "tests"), { recursive: true });
  writeFileSync(join(sourceRepoRoot, "package.json"), '{ "name": "legacy-contracts" }\n', "utf8");
  writeFileSync(entryFile, "export const main = true;\n", "utf8");
  writeFileSync(testFile, "export const tested = true;\n", "utf8");

  const target = resolveLegacyOverlayTarget({
    repoRoot,
    productRoot,
    sourceRepoRoot,
    productId: "legacy-contracts-demo",
  });

  bootstrapLegacyOverlayWorkspace({
    target,
    frameworkRoot: repoRoot,
    productName: "Legacy Contracts Demo",
  });
  scanLegacyRepository({ target });

  const beforeSource = readFileSync(entryFile, "utf8");
  const result = inferLegacyContracts({ target });

  assert.ok(existsSync(result.draftsFile));
  assert.equal(readFileSync(entryFile, "utf8"), beforeSource);
  assert.equal(result.drafts.summary.moduleContractCount >= 1, true);
  assert.equal(result.drafts.summary.functionContractCount >= 2, true);
  assert.ok(result.drafts.functionContracts.some((item) => item.ref === "src/main.ts"));
  assert.ok(result.drafts.blockAnchors.some((item) => item.ref === "tests/main.test.ts"));
});

test("readLegacyContractDrafts loads persisted draft contracts", () => {
  const repoRoot = process.cwd();
  const dir = mkdtempSync(join(tmpdir(), "grace-legacy-contracts-read-"));
  const productRoot = join(dir, "overlay");
  const sourceRepoRoot = join(dir, "legacy-source");

  mkdirSync(join(sourceRepoRoot, "src"), { recursive: true });
  writeFileSync(join(sourceRepoRoot, "src", "app.js"), "module.exports = {};\n", "utf8");

  const target = resolveLegacyOverlayTarget({
    repoRoot,
    productRoot,
    sourceRepoRoot,
    productId: "legacy-contracts-read",
  });

  bootstrapLegacyOverlayWorkspace({
    target,
    frameworkRoot: repoRoot,
    productName: "Legacy Contracts Read",
  });
  scanLegacyRepository({ target });

  const result = inferLegacyContracts({ target });
  const loaded = readLegacyContractDrafts(result.draftsFile);

  assert.equal(loaded.productId, "legacy-contracts-read");
  assert.equal(loaded.summary.functionContractCount >= 1, true);
});
