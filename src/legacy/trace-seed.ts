import { readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureParentDir } from "../runtime/fs-utils.js";
import type { ProductTargetConfig } from "../runtime/product-target.js";
import type { LegacyContractDrafts } from "./contracts.js";
import { readLegacyContractDrafts } from "./infer-contracts.js";

export interface LegacyGraphNode {
  id: string;
  kind: "module-contract" | "function-contract" | "block-anchor";
  ref: string;
  ownerId?: string;
}

export interface LegacyGraphEdge {
  from: string;
  to: string;
  relation: "owns-function" | "owns-anchor";
}

export interface LegacyGraphRegistry {
  schemaVersion: "grace-legacy-graph-registry-v1";
  productId: string;
  traceId: string;
  sourceRepoRoot: string;
  generatedAt: string;
  nodes: LegacyGraphNode[];
  edges: LegacyGraphEdge[];
  summary: {
    nodeCount: number;
    edgeCount: number;
    moduleNodeCount: number;
    functionNodeCount: number;
    anchorNodeCount: number;
  };
}

export interface SeedLegacyTraceabilityInput {
  target: ProductTargetConfig;
  draftsFile?: string;
  registryFile?: string;
}

export interface SeedLegacyTraceabilityResult {
  registryFile: string;
  registry: LegacyGraphRegistry;
}

function buildLegacyGraphRegistry(target: ProductTargetConfig, drafts: LegacyContractDrafts): LegacyGraphRegistry {
  const nodes: LegacyGraphNode[] = [];
  const edges: LegacyGraphEdge[] = [];

  for (const moduleContract of drafts.moduleContracts) {
    nodes.push({
      id: moduleContract.id,
      kind: "module-contract",
      ref: moduleContract.ref,
    });

    for (const functionId of moduleContract.functionContractIds) {
      edges.push({
        from: moduleContract.id,
        to: functionId,
        relation: "owns-function",
      });
    }
  }

  for (const functionContract of drafts.functionContracts) {
    nodes.push({
      id: functionContract.id,
      kind: "function-contract",
      ref: functionContract.ref,
      ownerId: functionContract.moduleContractId,
    });

    for (const anchorId of functionContract.blockAnchorIds) {
      edges.push({
        from: functionContract.id,
        to: anchorId,
        relation: "owns-anchor",
      });
    }
  }

  for (const anchor of drafts.blockAnchors) {
    nodes.push({
      id: anchor.id,
      kind: "block-anchor",
      ref: anchor.ref,
      ownerId: anchor.ownerFunctionContractId,
    });
  }

  return {
    schemaVersion: "grace-legacy-graph-registry-v1",
    productId: target.productId,
    traceId: target.traceId,
    sourceRepoRoot: target.sourceRepoRoot,
    generatedAt: new Date().toISOString(),
    nodes,
    edges,
    summary: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      moduleNodeCount: drafts.moduleContracts.length,
      functionNodeCount: drafts.functionContracts.length,
      anchorNodeCount: drafts.blockAnchors.length,
    },
  };
}

export function seedLegacyTraceability(input: SeedLegacyTraceabilityInput): SeedLegacyTraceabilityResult {
  const draftsFile =
    input.draftsFile ?? resolve(input.target.productRoot, "docs", "grace", "reports", "LegacyContractDrafts.json");
  const registryFile =
    input.registryFile ?? resolve(input.target.productRoot, "docs", "grace", "reports", "LegacyGraphRegistry.json");

  const sourceRepoStatusBefore = statSync(input.target.sourceRepoRoot).mtimeMs;
  const drafts = readLegacyContractDrafts(draftsFile);
  const registry = buildLegacyGraphRegistry(input.target, drafts);

  ensureParentDir(registryFile);
  writeFileSync(registryFile, `${JSON.stringify(registry, null, 2)}\n`, "utf8");

  const sourceRepoStatusAfter = statSync(input.target.sourceRepoRoot).mtimeMs;
  if (sourceRepoStatusAfter !== sourceRepoStatusBefore) {
    throw new Error("legacy trace seeding must not mutate the source repository");
  }

  return {
    registryFile,
    registry,
  };
}

export function readLegacyGraphRegistry(registryFile: string): LegacyGraphRegistry {
  return JSON.parse(readFileSync(registryFile, "utf8")) as LegacyGraphRegistry;
}
