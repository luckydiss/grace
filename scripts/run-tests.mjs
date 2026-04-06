#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

function parseArgs(argv) {
  const args = {
    coverage: false,
    excludeDirs: [],
    roots: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--coverage") {
      args.coverage = true;
      continue;
    }
    if (arg === "--exclude-dir") {
      const value = argv[++i];
      if (value) {
        args.excludeDirs.push(value);
      }
      continue;
    }
    args.roots.push(arg);
  }

  return args;
}

function collectTestFiles(rootDir, excludeDirs) {
  const files = [];
  const normalizedRoot = resolve(rootDir);

  function visit(currentDir) {
    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        const rel = relative(normalizedRoot, fullPath);
        const parts = rel.split(/[\\/]/u).filter(Boolean);
        if (parts.some((part) => excludeDirs.includes(part))) {
          continue;
        }
        visit(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".test.js")) {
        files.push(fullPath);
      }
    }
  }

  visit(normalizedRoot);
  return files.sort((left, right) => left.localeCompare(right));
}

const { coverage, excludeDirs, roots } = parseArgs(process.argv.slice(2));

if (roots.length === 0) {
  console.error("run-tests.mjs: expected at least one test root");
  process.exit(1);
}

const files = [];
for (const root of roots) {
  const resolved = resolve(root);
  try {
    const stat = statSync(resolved);
    if (!stat.isDirectory()) {
      continue;
    }
  } catch {
    console.error(`run-tests.mjs: test root not found: ${root}`);
    process.exit(1);
  }
  files.push(...collectTestFiles(resolved, excludeDirs));
}

if (files.length === 0) {
  console.error(`run-tests.mjs: no test files found under ${roots.join(", ")}`);
  process.exit(1);
}

const nodeArgs = [];
if (coverage) {
  nodeArgs.push("--experimental-test-coverage");
}
nodeArgs.push("--test", ...files);

const result = spawnSync(process.execPath, nodeArgs, { stdio: "inherit" });
process.exit(typeof result.status === "number" ? result.status : 1);
