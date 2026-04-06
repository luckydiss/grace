import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

function runCli(args: string[], cwd: string) {
  return spawnSync(process.execPath, ["dist/cli/bootstrap-legacy-overlay.js", ...args], {
    cwd,
    encoding: "utf8",
  });
}

test("legacy bootstrap CLI creates overlay artifacts and keeps source repository untouched", () => {
  const repoRoot = process.cwd();
  const cwd = repoRoot;
  const dir = mkdtempSync(join(tmpdir(), "grace-legacy-cli-"));
  const productRoot = join(dir, "overlay");
  const sourceRepoRoot = join(dir, "legacy-source");
  const sourceSentinel = join(sourceRepoRoot, "README.md");

  mkdirSync(sourceRepoRoot, { recursive: true });
  writeFileSync(sourceSentinel, "legacy\n", "utf8");

  const result = runCli(
    [
      "--repo-root",
      repoRoot,
      "--product-root",
      productRoot,
      "--source-repo-root",
      sourceRepoRoot,
      "--product-id",
      "legacy-cli",
      "--product-name",
      "Legacy CLI Overlay",
      "--json",
    ],
    cwd,
  );

  assert.equal(result.status, 0, result.stdout || result.stderr);
  assert.match(result.stdout, /"mode": "legacy-overlay"/u);
  assert.ok(existsSync(join(productRoot, "docs", "grace", "LegacyWorkspace.json")));
  assert.equal(spawnSync("cmd", ["/c", "type", sourceSentinel], { encoding: "utf8" }).stdout.trim(), "legacy");
});
