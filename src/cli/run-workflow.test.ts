import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

function runCli(args: string[], cwd: string) {
  return spawnSync(process.execPath, ["dist/cli/run-workflow.js", ...args], {
    cwd,
    encoding: "utf8",
  });
}

test("grace CLI starts workflow and writes interrupt payload report", () => {
  const repoRoot = process.cwd();
  const cwd = repoRoot;
  const productRoot = repoRoot;
  const dir = mkdtempSync(join(tmpdir(), "grace-cli-"));
  const outFile = join(dir, "workflow-start.json");

  const result = runCli(
    [
      "start",
      "--repo-root",
      repoRoot,
      "--product-root",
      productRoot,
      "--product-id",
      "grace",
      "--thread-id",
      "cli-start-thread",
      "--verification-mode",
      "pass",
      "--state-file",
      join(dir, "WorkflowState.json"),
      "--transition-log-file",
      join(dir, "TransitionLog.jsonl"),
      "--issue-report-file",
      join(dir, "IssueReport.xml"),
      "--approval-log-file",
      join(dir, "approvals.log"),
      "--living-doc-report-file",
      join(dir, "living-doc-report.json"),
      "--policy-schema-report-file",
      join(dir, "policy-schema-consistency.json"),
      "--execution-dir",
      join(dir, "executions"),
      "--failure-memory-file",
      join(dir, "failure-memory.json"),
      "--forced-context-file",
      join(dir, "forced-context.json"),
      "--loop-guard-file",
      join(dir, "loop-guard.json"),
      "--out",
      outFile,
    ],
    cwd,
  );

  assert.equal(result.status, 0);
  assert.match(readFileSync(outFile, "utf8"), /__interrupt__/u);
});

test("grace CLI resumes workflow and writes final state report", () => {
  const repoRoot = process.cwd();
  const cwd = repoRoot;
  const productRoot = repoRoot;
  const dir = mkdtempSync(join(tmpdir(), "grace-cli-"));
  const startOut = join(dir, "workflow-start.json");
  const resumeOut = join(dir, "workflow-resume.json");
  const sharedArgs = [
    "--repo-root",
    repoRoot,
    "--product-root",
    productRoot,
    "--product-id",
    "grace",
    "--thread-id",
    "cli-resume-thread",
    "--verification-mode",
    "pass",
    "--state-file",
    join(dir, "WorkflowState.json"),
    "--transition-log-file",
    join(dir, "TransitionLog.jsonl"),
    "--issue-report-file",
    join(dir, "IssueReport.xml"),
    "--approval-log-file",
    join(dir, "approvals.log"),
    "--living-doc-report-file",
    join(dir, "living-doc-report.json"),
    "--policy-schema-report-file",
    join(dir, "policy-schema-consistency.json"),
    "--execution-dir",
    join(dir, "executions"),
    "--failure-memory-file",
    join(dir, "failure-memory.json"),
    "--forced-context-file",
    join(dir, "forced-context.json"),
    "--loop-guard-file",
    join(dir, "loop-guard.json"),
  ];

  const started = runCli(["start", ...sharedArgs, "--out", startOut], cwd);
  assert.equal(started.status, 0);

  const resumed = runCli(["resume", ...sharedArgs, "--approval-decision", "approve", "--out", resumeOut], cwd);
  assert.equal(resumed.status, 0);
  assert.match(readFileSync(resumeOut, "utf8"), /ARCHIVED/u);
  assert.match(readFileSync(join(dir, "executions", "CoordinatorExecution-Workflow-0001.xml"), "utf8"), /CoordinatorExecution/u);
  assert.match(readFileSync(join(dir, "executions", "CoordinatorSkillTrace-Workflow-0001.json"), "utf8"), /mode-coordinator/u);
});
