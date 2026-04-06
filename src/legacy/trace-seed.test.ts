import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { bootstrapLegacyOverlayWorkspace } from "./bootstrap.js";
import { inferLegacyContracts } from "./infer-contracts.js";
import { resolveLegacyOverlayTarget } from "./index.js";
import { scanLegacyRepository } from "./scan.js";
import { readLegacyGraphRegistry, seedLegacyTraceability } from "./trace-seed.js";

test("seedLegacyTraceability emits deterministic legacy graph registry without mutating source repo", () => {
  const repoRoot = process.cwd();
  const dir = mkdtempSync(join(tmpdir(), "grace-legacy-trace-"));
  const productRoot = join(dir, "overlay");
  const sourceRepoRoot = join(dir, "legacy-source");
  const entryFile = join(sourceRepoRoot, "src", "main.ts");

  mkdirSync(join(sourceRepoRoot, "src"), { recursive: true });
  writeFileSync(join(sourceRepoRoot, "package.json"), '{ "name": "legacy-trace" }\n', "utf8");
  writeFileSync(entryFile, "export const main = true;\n", "utf8");

  const target = resolveLegacyOverlayTarget({
    repoRoot,
    productRoot,
    sourceRepoRoot,
    productId: "legacy-trace-demo",
  });

  bootstrapLegacyOverlayWorkspace({
    target,
    frameworkRoot: repoRoot,
    productName: "Legacy Trace Demo",
  });
  scanLegacyRepository({ target });
  inferLegacyContracts({ target });

  const beforeSource = readFileSync(entryFile, "utf8");
  const result = seedLegacyTraceability({ target });

  assert.ok(existsSync(result.registryFile));
  assert.equal(readFileSync(entryFile, "utf8"), beforeSource);
  assert.equal(result.registry.summary.moduleNodeCount >= 1, true);
  assert.equal(result.registry.summary.functionNodeCount >= 1, true);
  assert.equal(result.registry.summary.anchorNodeCount >= 1, true);
  assert.equal(result.registry.summary.edgeCount >= 2, true);
});

test("readLegacyGraphRegistry loads persisted graph registry", () => {
  const repoRoot = process.cwd();
  const dir = mkdtempSync(join(tmpdir(), "grace-legacy-trace-read-"));
  const productRoot = join(dir, "overlay");
  const sourceRepoRoot = join(dir, "legacy-source");

  mkdirSync(join(sourceRepoRoot, "src"), { recursive: true });
  writeFileSync(join(sourceRepoRoot, "src", "app.js"), "module.exports = {};\n", "utf8");

  const target = resolveLegacyOverlayTarget({
    repoRoot,
    productRoot,
    sourceRepoRoot,
    productId: "legacy-trace-read",
  });

  bootstrapLegacyOverlayWorkspace({
    target,
    frameworkRoot: repoRoot,
    productName: "Legacy Trace Read",
  });
  scanLegacyRepository({ target });
  inferLegacyContracts({ target });

  const result = seedLegacyTraceability({ target });
  const loaded = readLegacyGraphRegistry(result.registryFile);

  assert.equal(loaded.productId, "legacy-trace-read");
  assert.equal(loaded.summary.nodeCount >= 1, true);
});
