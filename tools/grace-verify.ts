#!/usr/bin/env node

import { spawnSync } from "node:child_process";

interface VerifyStep {
  label: string;
  command: string;
  args: string[];
}

interface StepResult {
  label: string;
  status: number | null;
}

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const nodeCmd = process.execPath;

const steps: VerifyStep[] = [
  { label: "build", command: npmCmd, args: ["run", "build"] },
  { label: "build-tools", command: npmCmd, args: ["run", "build:tools"] },
  { label: "test", command: npmCmd, args: ["run", "test"] },
  { label: "mcp-build", command: npmCmd, args: ["--prefix", "mcp", "run", "build"] },
  { label: "mcp-test", command: npmCmd, args: ["--prefix", "mcp", "run", "test"] },
  { label: "validate-framework", command: nodeCmd, args: ["out/tools/grace-validate.js", "--mode", "framework"] },
  { label: "validate-product-root", command: nodeCmd, args: ["out/tools/grace-validate.js", "--mode", "product", "--root", "."] },
];

function runStep(step: VerifyStep): StepResult {
  console.log(`VERIFY_STEP_BEGIN ${step.label}`);
  const result = spawnSync(step.command, step.args, {
    cwd: process.cwd(),
    stdio: "inherit",
    shell: process.platform === "win32" && step.command.toLowerCase().endsWith(".cmd"),
  });
  const status = typeof result.status === "number" ? result.status : 1;
  console.log(`VERIFY_STEP_END ${step.label} status=${status}`);
  return { label: step.label, status };
}

function main(): number {
  const results = steps.map(runStep);
  const failed = results.filter((result) => result.status !== 0);

  console.log("VERIFY_SUMMARY");
  for (const result of results) {
    console.log(`- ${result.label}: ${result.status === 0 ? "PASS" : `FAIL (${result.status})`}`);
  }

  if (failed.length > 0) {
    console.error(`VERIFY_GATE: BLOCKED (${failed.length} of ${results.length} steps failed)`);
    return 1;
  }

  console.log(`VERIFY_GATE: PASS (${results.length} steps passed)`);
  return 0;
}

process.exit(main());
