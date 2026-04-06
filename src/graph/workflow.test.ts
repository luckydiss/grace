import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { Command } from "@langchain/langgraph";
import { buildGraceWorkflow } from "./workflow.js";
import { bootstrapLegacyOverlayWorkspace } from "../legacy/bootstrap.js";
import { resolveLegacyOverlayTarget } from "../runtime/product-target.js";

function withMutedConsoleError<T>(fn: () => Promise<T>): Promise<T> {
  const original = console.error;
  console.error = () => undefined;
  return fn().finally(() => {
    console.error = original;
  });
}

function buildInput(dir: string, verificationMode: "pass" | "fail") {
  const repoRoot = process.cwd();
  const productRoot = process.cwd();
  return {
    repoRoot,
    productRoot,
    sourceRepoRoot: productRoot,
    productId: "grace",
    traceId: "TRACE-GRACE-CORE",
    stateFile: join(dir, "WorkflowState.json"),
    transitionLogFile: join(dir, "TransitionLog.jsonl"),
    issueReportFile: join(dir, "IssueReport-Workflow.xml"),
    executionDir: join(dir, "executions"),
    verificationMode,
    handoffRef: "docs/grace/handoffs/Handoff-20260405-01-GRACE-Foundation.xml",
    requirementsRef: "docs/grace/RequirementsAnalysis.xml",
    technologyRef: "docs/grace/Technology.xml",
    developmentPlanRef: "docs/grace/DevelopmentPlan.xml",
    executionPlanRef: "docs/grace/DevelopmentExecutionPlan.xml",
    approvalsRef: "docs/grace/approvals.log",
    approvalLogFile: join(dir, "approvals.log"),
    requirementsFile: join(process.cwd(), "docs", "grace", "RequirementsAnalysis.xml"),
    technologyFile: join(process.cwd(), "docs", "grace", "Technology.xml"),
    developmentPlanFile: join(process.cwd(), "docs", "grace", "DevelopmentPlan.xml"),
    executionPlanFile: join(process.cwd(), "docs", "grace", "DevelopmentExecutionPlan.xml"),
    livingDocReportFile: join(dir, "living-doc-report.json"),
    livingDocReportRef: "docs/grace/reports/living-doc-report.json",
    policySchemaReportFile: join(dir, "policy-schema-consistency.json"),
    policySchemaReportRef: "docs/grace/reports/policy-schema-consistency.json",
    branchSpecRef: "docs/grace/cwo/BS-20260405-01-GRACE-Foundation.xml",
    cwoRef: "docs/grace/cwo/CWO-20260405-01-GRACE-Foundation.xml",
    failureMemoryFile: join(dir, "failure-memory.json"),
    forcedContextFile: join(dir, "forced-context.json"),
    loopGuardFile: join(dir, "loop-guard.json"),
    failureScope: "FC-grace-graph-buildWorkflow",
    failureTestId: "TC-GRACE-FAIL-01",
    failureErrorSignature: "verification failed",
    retryCount: verificationMode === "pass" ? 1 : 1,
    retryBudget: 2,
    proposedFix: "targeted-remediation",
    policyFile: join(process.cwd(), "docs", "grace", "policies", "transition-policy.json"),
  };
}

async function collectStreamChunks(streamPromise: Promise<AsyncIterable<unknown>>): Promise<unknown[]> {
  const chunks: unknown[] = [];
  const stream = await streamPromise;
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

test("FC-grace-graph-buildWorkflow interrupts at the approval boundary and resumes through delivery to ARCHIVED", async () => {
  const dir = mkdtempSync(join(tmpdir(), "grace-graph-"));
  const graph = buildGraceWorkflow();
  const config = { configurable: { thread_id: "grace-thread-pass" } };

  const interruptedChunks = await withMutedConsoleError(() =>
    collectStreamChunks(
      graph.stream(
        {
          ...buildInput(dir, "pass"),
          currentState: null,
          approvalDecision: null,
          transitionHistory: [],
          artifactHistory: [],
          issueReportRefs: [],
        },
        config,
      ),
    ),
  );

  assert.ok(interruptedChunks.some((chunk) => JSON.stringify(chunk).includes("__interrupt__")));

  const result = await withMutedConsoleError(() =>
    graph.invoke(new Command({ resume: { approved: true } }), config),
  );

  assert.equal(result.currentState, "ARCHIVED");
  assert.match(readFileSync(join(dir, "WorkflowState.json"), "utf8"), /ARCHIVED/u);
  assert.match(readFileSync(join(dir, "living-doc-report.json"), "utf8"), /grace-living-doc-report-v1/u);
});

test("FC-grace-graph-buildWorkflow routes verification failure into governed remediation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "grace-graph-"));
  const graph = buildGraceWorkflow();
  const config = { configurable: { thread_id: "grace-thread-fail" } };

  await withMutedConsoleError(() =>
    collectStreamChunks(
      graph.stream(
        {
          ...buildInput(dir, "fail"),
          currentState: null,
          approvalDecision: null,
          transitionHistory: [],
          artifactHistory: [],
          issueReportRefs: [],
        },
        config,
      ),
    ),
  );

  const result = await withMutedConsoleError(() =>
    graph.invoke(new Command({ resume: { approved: true } }), config),
  );

  assert.equal(result.currentState, "REMEDIATION_READY");
  assert.match(readFileSync(join(dir, "WorkflowState.json"), "utf8"), /REMEDIATION_READY/u);
  assert.match(readFileSync(join(dir, "loop-guard.json"), "utf8"), /ALLOW/u);
});

test("FC-grace-graph-buildWorkflow routes legacy overlays to slice-ready onboarding under full swarm evidence", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "grace-legacy-graph-"));
  const repoRoot = process.cwd();
  const productRoot = join(rootDir, "legacy-overlay");
  const sourceRepoRoot = join(rootDir, "legacy-source");
  mkdirSync(join(sourceRepoRoot, "src"), { recursive: true });
  writeFileSync(join(sourceRepoRoot, "src", "task-create.ts"), "export const createTask = () => true;\n", "utf8");
  writeFileSync(join(sourceRepoRoot, "src", "task-list.ts"), "export const listTasks = () => [];\n", "utf8");
  writeFileSync(join(sourceRepoRoot, "src", "task-create.test.ts"), "export const createTaskTest = true;\n", "utf8");
  writeFileSync(join(sourceRepoRoot, "package.json"), '{ "name": "legacy-graph-test" }\n', "utf8");

  const target = resolveLegacyOverlayTarget({
    repoRoot,
    productRoot,
    sourceRepoRoot,
    productId: "legacy-graph-test",
  });
  bootstrapLegacyOverlayWorkspace({
    target,
    frameworkRoot: repoRoot,
    productName: "Legacy Graph Test",
  });

  const graph = buildGraceWorkflow();
  const result = await withMutedConsoleError(() =>
    graph.invoke(
      {
        repoRoot,
        productRoot,
        sourceRepoRoot,
        productId: target.productId,
        traceId: target.traceId,
        stateFile: join(productRoot, "docs", "grace", "state", "WorkflowState.json"),
        transitionLogFile: join(productRoot, "docs", "grace", "state", "TransitionLog.jsonl"),
        issueReportFile: join(productRoot, "docs", "grace", "reports", "issues", "WorkflowIssueReport.xml"),
        executionDir: join(productRoot, "docs", "grace", "executions"),
        verificationMode: "pass",
        handoffRef: "legacy-overlay/docs/grace/handoffs/Handoff-bootstrap-legacy-graph-test.xml",
        requirementsRef: "legacy-overlay/docs/grace/RequirementsAnalysis.xml",
        technologyRef: "legacy-overlay/docs/grace/Technology.xml",
        developmentPlanRef: "legacy-overlay/docs/grace/DevelopmentPlan.xml",
        executionPlanRef: "legacy-overlay/docs/grace/DevelopmentExecutionPlan.xml",
        approvalsRef: "legacy-overlay/docs/grace/approvals.log",
        approvalLogFile: join(productRoot, "docs", "grace", "approvals.log"),
        requirementsFile: join(productRoot, "docs", "grace", "RequirementsAnalysis.xml"),
        technologyFile: join(productRoot, "docs", "grace", "Technology.xml"),
        developmentPlanFile: join(productRoot, "docs", "grace", "DevelopmentPlan.xml"),
        executionPlanFile: join(productRoot, "docs", "grace", "DevelopmentExecutionPlan.xml"),
        livingDocReportFile: join(productRoot, "docs", "grace", "reports", "living-doc-report.json"),
        livingDocReportRef: "legacy-overlay/docs/grace/reports/living-doc-report.json",
        policySchemaReportFile: join(productRoot, "docs", "grace", "reports", "policy-schema-consistency.json"),
        policySchemaReportRef: "legacy-overlay/docs/grace/reports/policy-schema-consistency.json",
        branchSpecRef: "legacy-overlay/docs/grace/cwo/BS-bootstrap-legacy-graph-test.xml",
        cwoRef: "legacy-overlay/docs/grace/cwo/CWO-bootstrap-legacy-graph-test.xml",
        failureMemoryFile: join(productRoot, "docs", "grace", "reports", "failure-memory.json"),
        forcedContextFile: join(productRoot, "docs", "grace", "reports", "forced-context.json"),
        loopGuardFile: join(productRoot, "docs", "grace", "reports", "loop-guard.json"),
        failureScope: "FC-grace-graph-buildWorkflow",
        failureTestId: "TC-GRACE-LEGACY-01",
        failureErrorSignature: "legacy onboarding failed",
        retryCount: 1,
        retryBudget: 2,
        proposedFix: "n/a",
        policyFile: join(productRoot, "docs", "grace", "policies", "transition-policy.json"),
        currentState: null,
        approvalDecision: null,
        transitionHistory: [],
        artifactHistory: [],
        issueReportRefs: [],
      },
      { configurable: { thread_id: "grace-thread-legacy" } },
    ),
  );

  assert.equal(result.currentState, "LEGACY_SLICE_READY");
  assert.match(readFileSync(join(productRoot, "docs", "grace", "reports", "LegacySlicePlan.json"), "utf8"), /grace-legacy-slice-plan-v1/u);
  assert.match(readFileSync(join(productRoot, "docs", "grace", "reports", "LegacyEditDryRun.json"), "utf8"), /grace-legacy-edit-dry-run-v1/u);
});

test("FC-grace-graph-buildWorkflow routes living-doc failure into coder rejection and CWO reissue drafting", async () => {
  const dir = mkdtempSync(join(tmpdir(), "grace-graph-living-doc-fail-"));
  const graph = buildGraceWorkflow();
  const config = { configurable: { thread_id: "grace-thread-living-doc-fail" } };
  const brokenRequirements = join(dir, "RequirementsAnalysis.xml");
  writeFileSync(
    brokenRequirements,
    "<RequirementsAnalysis><UseCase id=\"UC-BROKEN\" /></RequirementsAnalysis>\n",
    "utf8",
  );

  await withMutedConsoleError(() =>
    collectStreamChunks(
      graph.stream(
        {
          ...buildInput(dir, "pass"),
          requirementsFile: brokenRequirements,
          currentState: null,
          approvalDecision: null,
          transitionHistory: [],
          artifactHistory: [],
          issueReportRefs: [],
        },
        config,
      ),
    ),
  );

  const result = await withMutedConsoleError(() =>
    graph.invoke(new Command({ resume: { approved: true } }), config),
  );

  assert.equal(result.currentState, "CWO_DRAFTING");
  assert.match(readFileSync(join(dir, "WorkflowState.json"), "utf8"), /CWO_DRAFTING/u);
});
