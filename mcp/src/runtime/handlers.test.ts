import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  bootstrapAndStartProductWorkflow,
  approveWorkflow,
  bootstrapLegacyOverlay,
  bootstrapProduct,
  dryRunLegacyEdit,
  getAgentTrace,
  getAutonomyStatus,
  getLegacyOverlayMetadata,
  getProcessArtifacts,
  getWorkflowBlockers,
  getWorkflowHistory,
  getWorkflowState,
  getWorkflowTrace,
  listProducts,
  proposeLegacySlicesFromOverlay,
  readProductArtifact,
  rejectWorkflow,
  scanLegacyOverlay,
  seedLegacyTraceFromOverlay,
  startWorkflow,
  startLegacyOnboarding,
  inferLegacyContractsFromOverlay,
  validateAgentEvidence,
  validateDeliveryTrace,
  validateExecutionProof,
  validateLegacyOverlay,
  validateProductWorkspace,
  validateWorkflow,
} from "./handlers.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const frameworkProductRoot = repoRoot;
const mcpProductRoot = resolve(repoRoot, "mcp");

async function withBackedUpGraceDocs<T>(run: () => Promise<T> | T): Promise<T> {
  const backupRoot = mkdtempSync(join(tmpdir(), "grace-mcp-docs-backup-"));
  const backupDocs = join(backupRoot, basename(mcpProductRoot), "docs", "grace");
  cpSync(join(mcpProductRoot, "docs", "grace"), backupDocs, { recursive: true });

  try {
    return await run();
  } finally {
    rmSync(join(mcpProductRoot, "docs", "grace"), { recursive: true, force: true });
    cpSync(backupDocs, join(mcpProductRoot, "docs", "grace"), { recursive: true });
    rmSync(backupRoot, { recursive: true, force: true });
  }
}

test("grace-mcp lists product workspaces from the repository", () => {
  const products = listProducts(repoRoot);
  assert.equal(products.some((product) => product.productId === "grace"), true);
  assert.equal(products.some((product) => product.productId === "grace-mcp"), true);
});

test("grace-mcp reads workflow state from the framework product", () => {
  const state = getWorkflowState(frameworkProductRoot);
  assert.equal(typeof state.currentState, "string");
});

test("grace-mcp returns workflow history, blockers, and trace summaries", () => {
  const history = getWorkflowHistory(frameworkProductRoot);
  assert.equal(history.length > 0, true);
  assert.equal(typeof history[0]?.transition, "string");

  const blockers = getWorkflowBlockers(frameworkProductRoot);
  assert.equal(blockers.blocked, false);

  const trace = getWorkflowTrace(frameworkProductRoot);
  assert.equal(typeof trace.historyCount, "number");
  assert.equal(Array.isArray(trace.recentTransitions), true);
  assert.equal(Array.isArray(trace.artifactRefs), true);
});

test("grace-mcp returns process-artifact and agent-trace summaries", () => {
  const processArtifacts = getProcessArtifacts(frameworkProductRoot);
  assert.equal(Array.isArray(processArtifacts.handoffs), true);
  assert.equal(Array.isArray(processArtifacts.workOrders), true);

  const agentTrace = getAgentTrace(frameworkProductRoot) as {
    architect: { executions: unknown[] };
    coordinator: { skillTraces: unknown[] };
    coder: { taskPackets: unknown[] };
  };
  assert.equal(Array.isArray(agentTrace.architect.executions), true);
  assert.equal(Array.isArray(agentTrace.coordinator.skillTraces), true);
  assert.equal(Array.isArray(agentTrace.coder.taskPackets), true);
});

test("grace-mcp returns autonomy status deterministically when artifacts are absent", () => {
  const autonomy = getAutonomyStatus(mcpProductRoot);
  assert.equal(typeof autonomy.hasFailureMemory, "boolean");
  assert.equal(typeof autonomy.hasForcedContext, "boolean");
  assert.equal(typeof autonomy.hasLoopGuard, "boolean");
});

test("grace-mcp returns a unified workflow validation bundle", async () => {
  const verdict = await validateWorkflow({
    repoRoot,
    productRoot: frameworkProductRoot,
    productId: "grace",
  }) as {
    ok: boolean;
    state: { currentState: string };
    agentEvidence: { ok: boolean };
  };
  assert.equal(verdict.ok, true);
  assert.equal(typeof verdict.state.currentState, "string");
  assert.equal(verdict.agentEvidence.ok, true);
});

test("grace-mcp exposes execution-proof and delivery-trace validator surfaces", () => {
  const executionProof = validateExecutionProof({
    repoRoot,
    productRoot: frameworkProductRoot,
  }) as { valid: boolean; roles?: string[] };
  assert.equal(typeof executionProof.valid, "boolean");
  assert.equal(Array.isArray(executionProof.roles), true);

  const deliveryTrace = validateDeliveryTrace({
    repoRoot,
    productRoot: frameworkProductRoot,
  }) as { valid: boolean; issues?: unknown[] };
  assert.equal(typeof deliveryTrace.valid, "boolean");
  assert.equal(Array.isArray(deliveryTrace.issues), true);
});

test("grace-mcp reads report and execution artifacts from a product workspace", () => {
  const report = readProductArtifact({
    productRoot: frameworkProductRoot,
    relativePath: "docs/grace/reports/workflow-run.json",
  });
  assert.equal(typeof report.content, "string");

  const artifact = readProductArtifact({
    productRoot: frameworkProductRoot,
    relativePath: "docs/grace/executions/CoderExecution-Workflow-0001.xml",
  });
  assert.match(String(artifact.content), /CoderExecution/u);
});

test("grace-mcp bootstraps and validates a new product workspace", () => {
  const outDir = ".tmp-products";
  const productId = `mcp-e2e-${Date.now().toString(36)}`;
  const createdRoot = resolve(repoRoot, outDir, productId);

  try {
    const bootstrap = bootstrapProduct({
      repoRoot,
      out: outDir,
      productId,
      productName: "MCP E2E Product",
      runtime: "grace",
    }) as {
      ok: boolean;
      productRoot: string;
      validation: { valid: boolean };
    };

    assert.equal(bootstrap.ok, true);
    assert.equal(bootstrap.validation.valid, true);
    assert.equal(existsSync(resolve(createdRoot, "docs", "grace", "state", "WorkflowState.json")), true);

    const validation = validateProductWorkspace({
      repoRoot,
      productRoot: createdRoot,
    }) as { valid: boolean; mode: string };
    assert.equal(validation.valid, true);
    assert.equal(validation.mode, "product");
  } finally {
    rmSync(createdRoot, { recursive: true, force: true });
  }
});

test("grace-mcp bootstraps and starts a new product workflow to the approval boundary", () => {
  const outDir = ".tmp-products";
  const productId = `mcp-start-${Date.now().toString(36)}`;
  const createdRoot = resolve(repoRoot, outDir, productId);

  try {
    const result = bootstrapAndStartProductWorkflow({
      repoRoot,
      out: outDir,
      productId,
      productName: "MCP Start Product",
      runtime: "grace",
      threadId: "mcp-bootstrap-start-thread",
    }) as {
      ok: boolean;
      start: Array<Record<string, unknown>>;
    };

    assert.equal(result.ok, true);
    assert.equal(Array.isArray(result.start), true);

    const state = getWorkflowState(createdRoot) as { currentState: string };
    assert.equal(state.currentState, "HANDOFF_APPROVAL_PENDING");
  } finally {
    rmSync(createdRoot, { recursive: true, force: true });
  }
});

test("grace-mcp bootstraps and validates a legacy overlay workspace", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "grace-mcp-legacy-"));
  const productRoot = resolve(tempRoot, "legacy-overlay");
  const sourceRepoRoot = resolve(tempRoot, "legacy-source");
  const sourceDir = resolve(sourceRepoRoot, "src");

  try {
    rmSync(productRoot, { recursive: true, force: true });
    rmSync(sourceRepoRoot, { recursive: true, force: true });
    mkdirSync(resolve(sourceRepoRoot, "src"), { recursive: true });
    writeFileSync(resolve(sourceRepoRoot, "src", "main.ts"), "export const main = true;\n", "utf8");
    writeFileSync(resolve(sourceRepoRoot, "src", "main.test.ts"), "export const testMain = true;\n", "utf8");
    writeFileSync(resolve(sourceRepoRoot, "package.json"), '{ "name": "legacy-bootstrap-source" }\n', "utf8");

    const bootstrap = bootstrapLegacyOverlay({
      repoRoot,
      productRoot,
      sourceRepoRoot,
      productId: "legacy-mcp-e2e",
      productName: "Legacy MCP Overlay",
    }) as {
      ok: boolean;
      validation: { valid: boolean; legacyOverlay: { hasLegacyWorkspace: boolean; hasSourceRepoMap: boolean } };
    };

    assert.equal(bootstrap.ok, true);
    assert.equal(bootstrap.validation.valid, true);
    assert.equal(bootstrap.validation.legacyOverlay.hasLegacyWorkspace, true);
    assert.equal(bootstrap.validation.legacyOverlay.hasSourceRepoMap, true);
    assert.equal(existsSync(resolve(productRoot, "docs", "grace", "LegacyWorkspace.json")), true);
    assert.equal(existsSync(sourceDir), true);

    const validation = validateLegacyOverlay({
      repoRoot,
      productRoot,
    }) as {
      valid: boolean;
      legacyOverlay: {
        hasLegacyWorkspace: boolean;
        hasSourceRepoMap: boolean;
        legacyWorkspace: { mode: string } | null;
      };
    };
    assert.equal(validation.valid, true);
    assert.equal(validation.legacyOverlay.hasLegacyWorkspace, true);
    assert.equal(validation.legacyOverlay.hasSourceRepoMap, true);
    assert.equal(validation.legacyOverlay.legacyWorkspace?.mode, "legacy-overlay");
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("grace-mcp reads legacy overlay metadata deterministically", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "grace-mcp-legacy-meta-"));
  const productRoot = resolve(tempRoot, "legacy-overlay");
  const sourceRepoRoot = resolve(tempRoot, "legacy-source");

  try {
    mkdirSync(resolve(sourceRepoRoot, "src"), { recursive: true });
    writeFileSync(resolve(sourceRepoRoot, "src", "main.ts"), "export const main = true;\n", "utf8");
    writeFileSync(resolve(sourceRepoRoot, "package.json"), '{ "name": "legacy-mcp-flow" }\n', "utf8");
    bootstrapLegacyOverlay({
      repoRoot,
      productRoot,
      sourceRepoRoot,
      productId: "legacy-metadata",
      productName: "Legacy Metadata Overlay",
    });

    const metadata = getLegacyOverlayMetadata(productRoot) as {
      hasLegacyWorkspace: boolean;
      hasSourceRepoMap: boolean;
      legacyWorkspace: { mode: string } | null;
      sourceRepoMap: { refs: { sourceRepoRootRef: string } } | null;
    };

    assert.equal(metadata.hasLegacyWorkspace, true);
    assert.equal(metadata.hasSourceRepoMap, true);
    assert.equal(metadata.legacyWorkspace?.mode, "legacy-overlay");
    assert.equal(typeof metadata.sourceRepoMap?.refs.sourceRepoRootRef, "string");
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("grace-mcp runs the legacy scan to slice proposal chain on an overlay workspace", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "grace-mcp-legacy-flow-"));
  const legacyProductRoot = resolve(tempRoot, "legacy-overlay");
  const sourceRepoRoot = resolve(tempRoot, "legacy-source");

  try {
    mkdirSync(resolve(sourceRepoRoot, "src"), { recursive: true });
    writeFileSync(resolve(sourceRepoRoot, "src", "main.ts"), "export const main = true;\n", "utf8");
    writeFileSync(resolve(sourceRepoRoot, "src", "task-create.ts"), "export const createTask = () => true;\n", "utf8");
    writeFileSync(resolve(sourceRepoRoot, "src", "task-create.test.ts"), "export const createTaskTest = true;\n", "utf8");
    writeFileSync(resolve(sourceRepoRoot, "package.json"), '{ "name": "legacy-flow-source" }\n', "utf8");
    bootstrapLegacyOverlay({
      repoRoot,
      productRoot: legacyProductRoot,
      sourceRepoRoot,
      productId: "legacy-mcp-flow",
      productName: "Legacy MCP Flow",
    });

    const scan = await scanLegacyOverlay({ repoRoot, productRoot: legacyProductRoot }) as { report: { summary?: { totalFiles?: number } } };
    assert.equal(typeof scan.report.summary?.totalFiles, "number");

    const drafts = await inferLegacyContractsFromOverlay({ repoRoot, productRoot: legacyProductRoot }) as { drafts: { summary?: { moduleContractCount?: number } } };
    assert.equal(typeof drafts.drafts.summary?.moduleContractCount, "number");

    const graph = await seedLegacyTraceFromOverlay({ repoRoot, productRoot: legacyProductRoot }) as { registry: { nodes?: unknown[] } };
    assert.equal(Array.isArray(graph.registry.nodes), true);

    const plan = await proposeLegacySlicesFromOverlay({ repoRoot, productRoot: legacyProductRoot }) as { plan: { candidates?: Array<{ id: string }> } };
    assert.equal(Array.isArray(plan.plan.candidates), true);
    assert.equal(typeof plan.plan.candidates?.length, "number");
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("grace-mcp starts legacy onboarding and supports dry-run legacy edit validation", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "grace-mcp-legacy-onboarding-"));
  const legacyProductRoot = resolve(tempRoot, "legacy-overlay");
  const sourceRepoRoot = resolve(tempRoot, "legacy-source");

  try {
    mkdirSync(resolve(sourceRepoRoot, "src"), { recursive: true });
    writeFileSync(resolve(sourceRepoRoot, "src", "main.ts"), "export const main = true;\n", "utf8");
    writeFileSync(resolve(sourceRepoRoot, "package.json"), '{ "name": "legacy-mcp-onboarding" }\n', "utf8");
    bootstrapLegacyOverlay({
      repoRoot,
      productRoot: legacyProductRoot,
      sourceRepoRoot,
      productId: "legacy-mcp-onboarding",
      productName: "Legacy MCP Onboarding",
    });

    const started = startLegacyOnboarding({
      repoRoot,
      productRoot: legacyProductRoot,
      productId: "legacy-mcp-onboarding",
      threadId: "legacy-mcp-onboarding-thread",
    });

    const finalChunk = Array.isArray(started) ? JSON.stringify(started.at(-1)) : JSON.stringify(started);
    assert.match(finalChunk, /LEGACY_SLICE_READY/u);

    const slicePlan = JSON.parse(
      String(readProductArtifact({
        productRoot: legacyProductRoot,
        relativePath: "docs/grace/reports/LegacySlicePlan.json",
      }).content),
    ) as { candidates: Array<{ id: string }> };
    const dryRun = await dryRunLegacyEdit({
      repoRoot,
      productRoot: legacyProductRoot,
      productId: "legacy-mcp-onboarding",
      sliceId: slicePlan.candidates[0].id,
      requestedWritePaths: [join(sourceRepoRoot, "src", "task-create.ts")],
      writeModeAuthorized: false,
    }) as { dryRun: { ok: boolean; failures: Array<{ code: string }> } };

    assert.equal(dryRun.dryRun.ok, false);
    assert.equal(dryRun.dryRun.failures.some((failure) => failure.code === "LEGACY_WRITE_MODE_REQUIRED"), true);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("grace-mcp starts and approves a workflow on a temp copied product", async () => {
  await withBackedUpGraceDocs(async () => {
    const started = startWorkflow({
      repoRoot,
      productRoot: mcpProductRoot,
      productId: "grace-mcp",
      threadId: "grace-mcp-test-thread",
    });
    assert.equal(Array.isArray(started), true);

    const resumed = approveWorkflow({
      repoRoot,
      productRoot: mcpProductRoot,
      productId: "grace-mcp",
      threadId: "grace-mcp-test-thread",
    });
    assert.equal(resumed.currentState, "READY_FOR_RELEASE");

    const evidence = await validateAgentEvidence({
      repoRoot,
      productRoot: mcpProductRoot,
      productId: "grace-mcp",
    });
    assert.equal(evidence.ok, true);
  });
});

test("grace-mcp resumes a workflow through the reject path", async () => {
  await withBackedUpGraceDocs(async () => {
    startWorkflow({
      repoRoot,
      productRoot: mcpProductRoot,
      productId: "grace-mcp",
      threadId: "grace-mcp-reject-thread",
    });

    const rejected = rejectWorkflow({
      repoRoot,
      productRoot: mcpProductRoot,
      productId: "grace-mcp",
      threadId: "grace-mcp-reject-thread",
    }) as { currentState: string; transitionHistory?: string[] };

    assert.equal(rejected.currentState, "HANDOFF_REJECTED");
    assert.equal(rejected.transitionHistory?.includes("reject_handoff"), true);
  });
});
