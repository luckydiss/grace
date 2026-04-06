import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { resolveGraceMcpRuntimeConfig, type GraceMcpRuntimeConfig } from "./runtime/config.js";
import {
  bootstrapAndStartProductWorkflow,
  approveWorkflow,
  bootstrapLegacyOverlay,
  bootstrapProduct,
  dryRunLegacyEdit,
  getAgentRuns,
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
  resumeWorkflow,
  scanLegacyOverlay,
  seedLegacyTraceFromOverlay,
  startWorkflow,
  startLegacyOnboarding,
  inferLegacyContractsFromOverlay,
  validateAgentEvidence,
  validateAgentRuns,
  validateDeliveryTrace,
  validateExecutionProof,
  validateLegacyOverlay,
  validateProductWorkspace,
  validateWorkflow,
  resumeAgentRun,
} from "./runtime/handlers.js";

function jsonResult(payload: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function textResource(uri: string, payload: unknown) {
  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function detectMimeType(relativePath: string): string {
  if (relativePath.endsWith(".json") || relativePath.endsWith(".jsonl")) {
    return "application/json";
  }
  if (relativePath.endsWith(".xml")) {
    return "application/xml";
  }
  if (relativePath.endsWith(".md")) {
    return "text/markdown";
  }
  return "text/plain";
}

function defaultRepoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

export function buildGraceMcpServer(
  runtimeConfig: GraceMcpRuntimeConfig = resolveGraceMcpRuntimeConfig(),
): McpServer {
  const repoRoot = defaultRepoRoot();
  const server = new McpServer(
    { name: runtimeConfig.serverName, version: runtimeConfig.serverVersion },
    { capabilities: { logging: {}, resources: { listChanged: true } } },
  );
  const findProduct = (productId: string) => {
    const product = listProducts(repoRoot).find((candidate) => candidate.productId === productId);
    if (!product) {
      throw new Error(`Unknown product: ${productId}`);
    }
    return product;
  };
  const notifyResourcesChanged = () => {
    server.sendResourceListChanged();
  };

  server.registerResource(
    "grace-server-info",
    "grace://server/info",
    {
      mimeType: "application/json",
      description: "GRACE MCP server metadata including protocol and transport constraints.",
    },
    async () =>
      textResource("grace://server/info", {
        serverName: runtimeConfig.serverName,
        serverVersion: runtimeConfig.serverVersion,
        protocolVersion: runtimeConfig.protocolVersion,
        authRequired: runtimeConfig.authToken !== null,
        http: {
          requireVersionHeader: runtimeConfig.requireVersionHeader,
          maxBodyBytes: runtimeConfig.maxBodyBytes,
          rateLimitPerMinute: runtimeConfig.rateLimitPerMinute,
          requestTimeoutMs: runtimeConfig.requestTimeoutMs,
        },
      }),
  );

  server.registerResource(
    "grace-products",
    "grace://products",
    {
      mimeType: "application/json",
      description: "Repository-wide list of GRACE product workspaces discovered by grace-mcp.",
    },
    async () => textResource("grace://products", listProducts(repoRoot)),
  );

  server.registerResource(
    "grace-product-state",
    new ResourceTemplate("grace://product/{productId}/state", {
      list: async () => ({
        resources: listProducts(repoRoot).map((product) => ({
          uri: `grace://product/${product.productId}/state`,
          name: `${product.productId}-state`,
        })),
      }),
    }),
    {
      mimeType: "application/json",
      description: "Current WorkflowState.json for a GRACE product.",
      title: "GRACE Product State",
    },
    async (_uri: URL, variables: Record<string, string | string[]>) => {
      const productId = String(variables.productId);
      const product = findProduct(productId);
      return textResource(`grace://product/${productId}/state`, getWorkflowState(product.productRoot));
    },
  );

  server.registerResource(
    "grace-product-history",
    new ResourceTemplate("grace://product/{productId}/history", {
      list: async () => ({
        resources: listProducts(repoRoot).map((product) => ({
          uri: `grace://product/${product.productId}/history`,
          name: `${product.productId}-history`,
        })),
      }),
    }),
    {
      mimeType: "application/json",
      description: "Durable transition history for a GRACE product.",
      title: "GRACE Product History",
    },
    async (_uri: URL, variables: Record<string, string | string[]>) => {
      const productId = String(variables.productId);
      const product = findProduct(productId);
      return textResource(`grace://product/${productId}/history`, getWorkflowHistory(product.productRoot));
    },
  );

  server.registerResource(
    "grace-product-trace",
    new ResourceTemplate("grace://product/{productId}/trace", {
      list: async () => ({
        resources: listProducts(repoRoot).map((product) => ({
          uri: `grace://product/${product.productId}/trace`,
          name: `${product.productId}-trace`,
        })),
      }),
    }),
    {
      mimeType: "application/json",
      description: "Compact workflow trace summary for a GRACE product.",
      title: "GRACE Product Trace",
    },
    async (_uri: URL, variables: Record<string, string | string[]>) => {
      const productId = String(variables.productId);
      const product = findProduct(productId);
      return textResource(`grace://product/${productId}/trace`, getWorkflowTrace(product.productRoot));
    },
  );

  server.registerResource(
    "grace-product-blockers",
    new ResourceTemplate("grace://product/{productId}/blockers", {
      list: async () => ({
        resources: listProducts(repoRoot).map((product) => ({
          uri: `grace://product/${product.productId}/blockers`,
          name: `${product.productId}-blockers`,
        })),
      }),
    }),
    {
      mimeType: "application/json",
      description: "Current blockers and issue pointers for a GRACE product.",
      title: "GRACE Product Blockers",
    },
    async (_uri: URL, variables: Record<string, string | string[]>) => {
      const productId = String(variables.productId);
      const product = findProduct(productId);
      return textResource(`grace://product/${productId}/blockers`, getWorkflowBlockers(product.productRoot));
    },
  );

  server.registerResource(
    "grace-product-autonomy",
    new ResourceTemplate("grace://product/{productId}/autonomy", {
      list: async () => ({
        resources: listProducts(repoRoot).map((product) => ({
          uri: `grace://product/${product.productId}/autonomy`,
          name: `${product.productId}-autonomy`,
        })),
      }),
    }),
    {
      mimeType: "application/json",
      description: "Failure-memory, forced-context, and loop-guard status for a GRACE product.",
      title: "GRACE Product Autonomy",
    },
    async (_uri: URL, variables: Record<string, string | string[]>) => {
      const productId = String(variables.productId);
      const product = findProduct(productId);
      return textResource(`grace://product/${productId}/autonomy`, getAutonomyStatus(product.productRoot));
    },
  );

  server.registerResource(
    "grace-product-agents",
    new ResourceTemplate("grace://product/{productId}/agents", {
      list: async () => ({
        resources: listProducts(repoRoot).map((product) => ({
          uri: `grace://product/${product.productId}/agents`,
          name: `${product.productId}-agents`,
        })),
      }),
    }),
    {
      mimeType: "application/json",
      description: "Grouped architect/coordinator/coder execution evidence for a GRACE product.",
      title: "GRACE Product Agents",
    },
    async (_uri: URL, variables: Record<string, string | string[]>) => {
      const productId = String(variables.productId);
      const product = findProduct(productId);
      return textResource(`grace://product/${productId}/agents`, getAgentTrace(product.productRoot));
    },
  );

  server.registerResource(
    "grace-product-agent-runs",
    new ResourceTemplate("grace://product/{productId}/agent-runs", {
      list: async () => ({
        resources: listProducts(repoRoot).map((product) => ({
          uri: `grace://product/${product.productId}/agent-runs`,
          name: `${product.productId}-agent-runs`,
        })),
      }),
    }),
    {
      mimeType: "application/json",
      description: "Durable external-agent run state and retry surface for a GRACE product.",
      title: "GRACE Product Agent Runs",
    },
    async (_uri: URL, variables: Record<string, string | string[]>) => {
      const productId = String(variables.productId);
      const product = findProduct(productId);
      return textResource(`grace://product/${productId}/agent-runs`, getAgentRuns(product.productRoot));
    },
  );

  server.registerResource(
    "grace-product-process",
    new ResourceTemplate("grace://product/{productId}/process", {
      list: async () => ({
        resources: listProducts(repoRoot).map((product) => ({
          uri: `grace://product/${product.productId}/process`,
          name: `${product.productId}-process`,
        })),
      }),
    }),
    {
      mimeType: "application/json",
      description: "Process artifacts such as handoffs, branch specs, work orders, and approvals for a GRACE product.",
      title: "GRACE Product Process",
    },
    async (_uri: URL, variables: Record<string, string | string[]>) => {
      const productId = String(variables.productId);
      const product = findProduct(productId);
      return textResource(`grace://product/${productId}/process`, getProcessArtifacts(product.productRoot));
    },
  );

  server.registerResource(
    "grace-product-legacy-overlay",
    new ResourceTemplate("grace://product/{productId}/legacy/overlay", {
      list: async () => ({
        resources: listProducts(repoRoot).map((product) => ({
          uri: `grace://product/${product.productId}/legacy/overlay`,
          name: `${product.productId}-legacy-overlay`,
        })),
      }),
    }),
    {
      mimeType: "application/json",
      description: "Legacy overlay metadata for a GRACE product when the workspace governs an external source repository.",
      title: "GRACE Product Legacy Overlay",
    },
    async (_uri: URL, variables: Record<string, string | string[]>) => {
      const productId = String(variables.productId);
      const product = findProduct(productId);
      return textResource(`grace://product/${productId}/legacy/overlay`, getLegacyOverlayMetadata(product.productRoot));
    },
  );

  server.registerResource(
    "grace-product-legacy-source-map",
    new ResourceTemplate("grace://product/{productId}/legacy/source-map", {
      list: async () => ({
        resources: listProducts(repoRoot).map((product) => ({
          uri: `grace://product/${product.productId}/legacy/source-map`,
          name: `${product.productId}-legacy-source-map`,
        })),
      }),
    }),
    {
      mimeType: "application/json",
      description: "Source repository mapping for a GRACE legacy overlay product.",
      title: "GRACE Product Legacy Source Map",
    },
    async (_uri: URL, variables: Record<string, string | string[]>) => {
      const productId = String(variables.productId);
      const product = findProduct(productId);
      const metadata = getLegacyOverlayMetadata(product.productRoot);
      return textResource(`grace://product/${productId}/legacy/source-map`, {
        hasSourceRepoMap: metadata.hasSourceRepoMap,
        sourceRepoMapRef: metadata.sourceRepoMapRef,
        sourceRepoMap: metadata.sourceRepoMap,
      });
    },
  );

  server.registerResource(
    "grace-product-legacy-scan",
    new ResourceTemplate("grace://product/{productId}/legacy/scan", {
      list: async () => ({
        resources: listProducts(repoRoot).map((product) => ({
          uri: `grace://product/${product.productId}/legacy/scan`,
          name: `${product.productId}-legacy-scan`,
        })),
      }),
    }),
    {
      mimeType: "application/json",
      description: "Legacy scan and risk reports for a GRACE legacy overlay.",
      title: "GRACE Product Legacy Scan",
    },
    async (_uri: URL, variables: Record<string, string | string[]>) => {
      const product = findProduct(String(variables.productId));
      return textResource(`grace://product/${variables.productId}/legacy/scan`, {
        scan: readProductArtifact({ productRoot: product.productRoot, relativePath: "docs/grace/reports/LegacyScanReport.json" }).content,
        risk: readProductArtifact({ productRoot: product.productRoot, relativePath: "docs/grace/reports/LegacyRiskReport.json" }).content,
      });
    },
  );

  server.registerResource(
    "grace-product-legacy-contracts",
    new ResourceTemplate("grace://product/{productId}/legacy/contracts", {
      list: async () => ({
        resources: listProducts(repoRoot).map((product) => ({
          uri: `grace://product/${product.productId}/legacy/contracts`,
          name: `${product.productId}-legacy-contracts`,
        })),
      }),
    }),
    {
      mimeType: "application/json",
      description: "Legacy draft contracts for a GRACE legacy overlay.",
      title: "GRACE Product Legacy Contracts",
    },
    async (_uri: URL, variables: Record<string, string | string[]>) => {
      const product = findProduct(String(variables.productId));
      return textResource(
        `grace://product/${variables.productId}/legacy/contracts`,
        JSON.parse(String(readProductArtifact({ productRoot: product.productRoot, relativePath: "docs/grace/reports/LegacyContractDrafts.json" }).content)),
      );
    },
  );

  server.registerResource(
    "grace-product-legacy-graph",
    new ResourceTemplate("grace://product/{productId}/legacy/graph", {
      list: async () => ({
        resources: listProducts(repoRoot).map((product) => ({
          uri: `grace://product/${product.productId}/legacy/graph`,
          name: `${product.productId}-legacy-graph`,
        })),
      }),
    }),
    {
      mimeType: "application/json",
      description: "Legacy graph registry for a GRACE legacy overlay.",
      title: "GRACE Product Legacy Graph",
    },
    async (_uri: URL, variables: Record<string, string | string[]>) => {
      const product = findProduct(String(variables.productId));
      return textResource(
        `grace://product/${variables.productId}/legacy/graph`,
        JSON.parse(String(readProductArtifact({ productRoot: product.productRoot, relativePath: "docs/grace/reports/LegacyGraphRegistry.json" }).content)),
      );
    },
  );

  server.registerResource(
    "grace-product-legacy-slices",
    new ResourceTemplate("grace://product/{productId}/legacy/slices", {
      list: async () => ({
        resources: listProducts(repoRoot).map((product) => ({
          uri: `grace://product/${product.productId}/legacy/slices`,
          name: `${product.productId}-legacy-slices`,
        })),
      }),
    }),
    {
      mimeType: "application/json",
      description: "Legacy slice proposal plan for a GRACE legacy overlay.",
      title: "GRACE Product Legacy Slices",
    },
    async (_uri: URL, variables: Record<string, string | string[]>) => {
      const product = findProduct(String(variables.productId));
      return textResource(
        `grace://product/${variables.productId}/legacy/slices`,
        JSON.parse(String(readProductArtifact({ productRoot: product.productRoot, relativePath: "docs/grace/reports/LegacySlicePlan.json" }).content)),
      );
    },
  );

  server.registerTool(
    "grace.server.info",
    {
      description: "Return GRACE MCP server metadata including protocol version and HTTP runtime constraints.",
      inputSchema: {},
    },
    async () =>
      jsonResult({
        serverName: runtimeConfig.serverName,
        serverVersion: runtimeConfig.serverVersion,
        protocolVersion: runtimeConfig.protocolVersion,
        authRequired: runtimeConfig.authToken !== null,
        http: {
          requireVersionHeader: runtimeConfig.requireVersionHeader,
          maxBodyBytes: runtimeConfig.maxBodyBytes,
          rateLimitPerMinute: runtimeConfig.rateLimitPerMinute,
          requestTimeoutMs: runtimeConfig.requestTimeoutMs,
        },
      }),
  );

  server.registerTool(
    "grace.products.list",
    {
      description: "List GRACE product workspaces available under the repository root.",
      inputSchema: { repoRoot: z.string().min(1) },
    },
    async ({ repoRoot }) => jsonResult(listProducts(repoRoot)),
  );

  server.registerTool(
    "grace.products.bootstrap",
    {
      description: "Create a new GRACE product workspace by running the canonical grace-init bootstrap and immediately validate the result.",
      inputSchema: {
        repoRoot: z.string().min(1),
        out: z.string().min(1),
        productId: z.string().min(1),
        productName: z.string().min(1),
        runtime: z.literal("grace").optional(),
      },
    },
    async (args) => {
      const result = bootstrapProduct(args);
      notifyResourcesChanged();
      return jsonResult(result);
    },
  );

  server.registerTool(
    "grace.products.start_workflow",
    {
      description: "Bootstrap a new GRACE product workspace and immediately start its workflow to the approval boundary.",
      inputSchema: {
        repoRoot: z.string().min(1),
        out: z.string().min(1),
        productId: z.string().min(1),
        productName: z.string().min(1),
        runtime: z.literal("grace").optional(),
        threadId: z.string().optional(),
        verificationMode: z.enum(["pass", "fail"]).optional(),
      },
    },
    async (args) => {
      const result = bootstrapAndStartProductWorkflow(args);
      notifyResourcesChanged();
      return jsonResult(result);
    },
  );

  server.registerTool(
    "grace.products.validate",
    {
      description: "Run the canonical grace-validate product mode and return the structured validation report.",
      inputSchema: {
        repoRoot: z.string().min(1),
        productRoot: z.string().min(1),
      },
    },
    async (args) => jsonResult(validateProductWorkspace(args)),
  );

  server.registerTool(
    "grace.legacy.bootstrap",
    {
      description: "Create a read-only GRACE overlay workspace over an existing legacy repository and immediately validate the overlay.",
      inputSchema: {
        repoRoot: z.string().min(1),
        productRoot: z.string().min(1),
        sourceRepoRoot: z.string().min(1),
        productId: z.string().min(1),
        productName: z.string().optional(),
      },
    },
    async (args) => {
      const result = bootstrapLegacyOverlay(args);
      notifyResourcesChanged();
      return jsonResult(result);
    },
  );

  server.registerTool(
    "grace.legacy.validate",
    {
      description: "Validate a legacy overlay workspace and return both canonical GRACE validation and overlay metadata presence.",
      inputSchema: {
        repoRoot: z.string().min(1),
        productRoot: z.string().min(1),
      },
    },
    async (args) => jsonResult(validateLegacyOverlay(args)),
  );

  server.registerTool(
    "grace.legacy.scan",
    {
      description: "Run structural discovery on a legacy overlay repository and emit scan plus risk reports.",
      inputSchema: {
        repoRoot: z.string().min(1),
        productRoot: z.string().min(1),
      },
    },
    async (args) => {
      const result = await scanLegacyOverlay(args);
      notifyResourcesChanged();
      return jsonResult(result);
    },
  );

  server.registerTool(
    "grace.legacy.infer_contracts",
    {
      description: "Infer draft MC, FC, and BA contracts for a legacy overlay repository.",
      inputSchema: {
        repoRoot: z.string().min(1),
        productRoot: z.string().min(1),
      },
    },
    async (args) => {
      const result = await inferLegacyContractsFromOverlay(args);
      notifyResourcesChanged();
      return jsonResult(result);
    },
  );

  server.registerTool(
    "grace.legacy.trace_seed",
    {
      description: "Seed a legacy graph registry from inferred contracts.",
      inputSchema: {
        repoRoot: z.string().min(1),
        productRoot: z.string().min(1),
      },
    },
    async (args) => {
      const result = await seedLegacyTraceFromOverlay(args);
      notifyResourcesChanged();
      return jsonResult(result);
    },
  );

  server.registerTool(
    "grace.legacy.slice_propose",
    {
      description: "Derive bounded first-slice proposals for a legacy overlay repository.",
      inputSchema: {
        repoRoot: z.string().min(1),
        productRoot: z.string().min(1),
      },
    },
    async (args) => {
      const result = await proposeLegacySlicesFromOverlay(args);
      notifyResourcesChanged();
      return jsonResult(result);
    },
  );

  server.registerTool(
    "grace.legacy.start_onboarding",
    {
      description: "Run the governed legacy onboarding happy path up to the slice-ready boundary.",
      inputSchema: {
        repoRoot: z.string().min(1),
        productRoot: z.string().min(1),
        productId: z.string().optional(),
        threadId: z.string().optional(),
      },
    },
    async (args) => {
      const result = startLegacyOnboarding(args);
      notifyResourcesChanged();
      return jsonResult(result);
    },
  );

  server.registerTool(
    "grace.legacy.edit_dry_run",
    {
      description: "Validate a proposed legacy edit against write-mode authorization and editable path whitelist without touching the source repository.",
      inputSchema: {
        repoRoot: z.string().min(1),
        productRoot: z.string().min(1),
        productId: z.string().optional(),
        sliceId: z.string().min(1),
        requestedWritePaths: z.array(z.string().min(1)).min(1),
        writeModeAuthorized: z.boolean(),
      },
    },
    async (args) => {
      const result = await dryRunLegacyEdit(args);
      notifyResourcesChanged();
      return jsonResult(result);
    },
  );

  server.registerTool(
    "grace.process.artifacts",
    {
      description: "List handoffs, branch specs, work orders, and approvals log for a GRACE product workspace.",
      inputSchema: {
        productRoot: z.string().min(1),
      },
    },
    async ({ productRoot }) => jsonResult(getProcessArtifacts(productRoot)),
  );

  server.registerTool(
    "grace.report.read",
    {
      description: "Read a report file under docs/grace/reports for a GRACE product.",
      inputSchema: {
        productRoot: z.string().min(1),
        reportPath: z.string().min(1),
      },
    },
    async ({ productRoot, reportPath }) =>
      jsonResult(readProductArtifact({ productRoot, relativePath: `docs/grace/reports/${reportPath}` })),
  );

  server.registerTool(
    "grace.artifact.read",
    {
      description: "Read a GRACE product artifact by relative path under the product workspace.",
      inputSchema: {
        productRoot: z.string().min(1),
        relativePath: z.string().min(1),
      },
    },
    async ({ productRoot, relativePath }) =>
      jsonResult({
        ...readProductArtifact({ productRoot, relativePath }),
        mimeType: detectMimeType(relativePath),
      }),
  );

  server.registerTool(
    "grace.autonomy.status",
    {
      description: "Return failure-memory, forced-context, and loop-guard status for a GRACE product workspace.",
      inputSchema: {
        productRoot: z.string().min(1),
      },
    },
    async ({ productRoot }) => jsonResult(getAutonomyStatus(productRoot)),
  );

  server.registerTool(
    "grace.agent.trace",
    {
      description: "Return grouped architect/coordinator/coder task packet, invocation, execution, and skill-trace artifacts.",
      inputSchema: {
        productRoot: z.string().min(1),
      },
    },
    async ({ productRoot }) => jsonResult(getAgentTrace(productRoot)),
  );

  server.registerTool(
    "grace.agent.runs",
    {
      description: "Return durable agent run state, retry budgets, and next-action summaries for a GRACE product.",
      inputSchema: {
        productRoot: z.string().min(1),
      },
    },
    async ({ productRoot }) => jsonResult(getAgentRuns(productRoot)),
  );

  server.registerTool(
    "grace.workflow.execution_proof",
    {
      description: "Run the canonical execution-proof validator for a GRACE product workspace.",
      inputSchema: {
        repoRoot: z.string().min(1),
        productRoot: z.string().min(1),
      },
    },
    async (args) => jsonResult(validateExecutionProof(args)),
  );

  server.registerTool(
    "grace.workflow.delivery_trace",
    {
      description: "Run the canonical delivery-trace validator using inferred handoff, CWO, and W11 artifact paths when available.",
      inputSchema: {
        repoRoot: z.string().min(1),
        productRoot: z.string().min(1),
      },
    },
    async (args) => jsonResult(validateDeliveryTrace(args)),
  );

  server.registerTool(
    "grace.workflow.validate",
    {
      description: "Return a single governed validation bundle for a GRACE product including state, blockers, trace, and agent evidence.",
      inputSchema: {
        repoRoot: z.string().min(1),
        productRoot: z.string().min(1),
        productId: z.string().optional(),
      },
    },
    async (args) => jsonResult(await validateWorkflow(args)),
  );

  server.registerTool(
    "grace.workflow.history",
    {
      description: "Read the durable transition history for a GRACE product.",
      inputSchema: { productRoot: z.string().min(1) },
    },
    async ({ productRoot }) => jsonResult(getWorkflowHistory(productRoot)),
  );

  server.registerTool(
    "grace.workflow.blockers",
    {
      description: "Return current blocked status, block reasons, and issue-report pointers for a GRACE product.",
      inputSchema: { productRoot: z.string().min(1) },
    },
    async ({ productRoot }) => jsonResult(getWorkflowBlockers(productRoot)),
  );

  server.registerTool(
    "grace.workflow.trace",
    {
      description: "Return a compact workflow trace summary including state, recent transitions, and emitted artifacts.",
      inputSchema: { productRoot: z.string().min(1) },
    },
    async ({ productRoot }) => jsonResult(getWorkflowTrace(productRoot)),
  );

  server.registerTool(
    "grace.workflow.state",
    {
      description: "Read the current WorkflowState.json for a GRACE product.",
      inputSchema: { productRoot: z.string().min(1) },
    },
    async ({ productRoot }) => jsonResult(getWorkflowState(productRoot)),
  );

  server.registerTool(
    "grace.workflow.start",
    {
      description: "Start a GRACE workflow for a product and persist the interrupt/start report.",
      inputSchema: {
        repoRoot: z.string().min(1),
        productRoot: z.string().min(1),
        productId: z.string().optional(),
        threadId: z.string().optional(),
        verificationMode: z.enum(["pass", "fail"]).optional(),
      },
    },
    async (args) => {
      const result = startWorkflow(args);
      notifyResourcesChanged();
      return jsonResult(result);
    },
  );

  server.registerTool(
    "grace.workflow.resume",
    {
      description: "Resume a GRACE workflow after interrupt with explicit approval decision.",
      inputSchema: {
        repoRoot: z.string().min(1),
        productRoot: z.string().min(1),
        productId: z.string().optional(),
        threadId: z.string().optional(),
        verificationMode: z.enum(["pass", "fail"]).optional(),
        approvalDecision: z.enum(["approve", "reject"]),
      },
    },
    async (args) => {
      const result = resumeWorkflow(args);
      notifyResourcesChanged();
      return jsonResult(result);
    },
  );

  server.registerTool(
    "grace.workflow.approve",
    {
      description: "Resume a GRACE workflow with approval decision preset to approve.",
      inputSchema: {
        repoRoot: z.string().min(1),
        productRoot: z.string().min(1),
        productId: z.string().optional(),
        threadId: z.string().optional(),
        verificationMode: z.enum(["pass", "fail"]).optional(),
      },
    },
    async (args) => {
      const result = approveWorkflow(args);
      notifyResourcesChanged();
      return jsonResult(result);
    },
  );

  server.registerTool(
    "grace.workflow.reject",
    {
      description: "Resume a GRACE workflow with approval decision preset to reject.",
      inputSchema: {
        repoRoot: z.string().min(1),
        productRoot: z.string().min(1),
        productId: z.string().optional(),
        threadId: z.string().optional(),
        verificationMode: z.enum(["pass", "fail"]).optional(),
      },
    },
    async (args) => {
      const result = rejectWorkflow(args);
      notifyResourcesChanged();
      return jsonResult(result);
    },
  );

  server.registerTool(
    "grace.agent.evidence",
    {
      description: "Validate that architect, coordinator, and coder left full swarm evidence for a product.",
      inputSchema: {
        repoRoot: z.string().min(1),
        productRoot: z.string().min(1),
        productId: z.string().optional(),
      },
    },
    async (args) => jsonResult(await validateAgentEvidence(args)),
  );

  server.registerTool(
    "grace.agent.validate_runs",
    {
      description: "Validate durable agent run lifecycle artifacts including retry-budget and transition policy checks.",
      inputSchema: {
        repoRoot: z.string().min(1),
        productRoot: z.string().min(1),
        productId: z.string().optional(),
      },
    },
    async (args) => jsonResult(await validateAgentRuns(args)),
  );

  server.registerTool(
    "grace.agent.resume_run",
    {
      description: "Apply a governed lifecycle update to an existing agent run artifact pair.",
      inputSchema: {
        repoRoot: z.string().min(1),
        stateFile: z.string().min(1),
        logFile: z.string().min(1),
        status: z.enum(["ACTIVE", "SUCCEEDED", "FAILED", "BLOCKED"]),
        outputRefs: z.array(z.string().min(1)).optional(),
        sessionId: z.string().optional(),
        resumeToken: z.string().optional(),
        failureReason: z.string().optional(),
        failureCategory: z.enum(["TRANSIENT", "TOOL_FAILURE", "USER_INTERRUPT", "SCOPE_VIOLATION", "POLICY_BLOCK", "UNKNOWN"]).optional(),
        retryReason: z.string().optional(),
        resumeContextRef: z.string().optional(),
        notes: z.array(z.string()).optional(),
      },
    },
    async (args) => jsonResult(await resumeAgentRun(args)),
  );

  return server;
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return resolve(entry) === fileURLToPath(import.meta.url);
}

async function main(): Promise<void> {
  const server = buildGraceMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (isMainModule()) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
