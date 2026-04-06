import { basename, relative, resolve } from "node:path";

export type LivingDocDocument =
  | "RequirementsAnalysis.xml"
  | "Technology.xml"
  | "DevelopmentPlan.xml"
  | "DevelopmentExecutionPlan.xml";

export type ProductTargetMode = "product" | "legacy-overlay";

export interface ProductTargetInput {
  repoRoot: string;
  productRoot: string;
  productId?: string;
  traceId?: string;
  mode?: ProductTargetMode;
  sourceRepoRoot?: string;
}

export interface ProductTargetConfig {
  repoRoot: string;
  productRoot: string;
  productId: string;
  traceId: string;
  mode: ProductTargetMode;
  sourceRepoRoot: string;
}

export interface LegacyWorkspaceDescriptor {
  schemaVersion: "grace-legacy-workspace-v1";
  productId: string;
  traceId: string;
  mode: "legacy-overlay";
  repoRoot: string;
  productRoot: string;
  sourceRepoRoot: string;
  metadata: {
    overlayRelativeToRepoRoot: string;
    sourceRepoRelativeToRepoRoot: string;
    sourceRepoRelativeToProductRoot: string;
  };
}

export interface SourceRepoMap {
  schemaVersion: "grace-source-repo-map-v1";
  productId: string;
  traceId: string;
  productRoot: string;
  sourceRepoRoot: string;
  refs: {
    overlayRootRef: string;
    sourceRepoRootRef: string;
  };
}

export function inferTraceId(productId: string): string {
  return `TRACE-${productId.toUpperCase().replace(/[^A-Z0-9]+/g, "-")}-CORE`;
}

export function resolveProductTarget(input: ProductTargetInput): ProductTargetConfig {
  const repoRoot = resolve(input.repoRoot);
  const productRoot = resolve(input.productRoot);
  const productId = input.productId ?? basename(productRoot);
  const traceId = input.traceId ?? inferTraceId(productId);
  const mode = input.mode ?? "product";
  const sourceRepoRoot = resolve(input.sourceRepoRoot ?? productRoot);
  return {
    repoRoot,
    productRoot,
    productId,
    traceId,
    mode,
    sourceRepoRoot,
  };
}

export function resolveLegacyOverlayTarget(
  input: Omit<ProductTargetInput, "mode"> & { sourceRepoRoot: string },
): ProductTargetConfig {
  return resolveProductTarget({
    ...input,
    mode: "legacy-overlay",
  });
}

export function toRepoArtifactRef(repoRoot: string, filePath: string): string {
  return relative(resolve(repoRoot), resolve(filePath)).replaceAll("\\", "/");
}

export function buildProductArtifactRef(repoRoot: string, productRoot: string, relativeFile: string): string {
  return toRepoArtifactRef(repoRoot, resolve(productRoot, relativeFile));
}

export function buildLegacyWorkspaceDescriptor(target: ProductTargetConfig): LegacyWorkspaceDescriptor {
  return {
    schemaVersion: "grace-legacy-workspace-v1",
    productId: target.productId,
    traceId: target.traceId,
    mode: "legacy-overlay",
    repoRoot: target.repoRoot,
    productRoot: target.productRoot,
    sourceRepoRoot: target.sourceRepoRoot,
    metadata: {
      overlayRelativeToRepoRoot: toRepoArtifactRef(target.repoRoot, target.productRoot),
      sourceRepoRelativeToRepoRoot: toRepoArtifactRef(target.repoRoot, target.sourceRepoRoot),
      sourceRepoRelativeToProductRoot: relative(target.productRoot, target.sourceRepoRoot).replaceAll("\\", "/"),
    },
  };
}

export function buildSourceRepoMap(target: ProductTargetConfig): SourceRepoMap {
  return {
    schemaVersion: "grace-source-repo-map-v1",
    productId: target.productId,
    traceId: target.traceId,
    productRoot: target.productRoot,
    sourceRepoRoot: target.sourceRepoRoot,
    refs: {
      overlayRootRef: toRepoArtifactRef(target.repoRoot, target.productRoot),
      sourceRepoRootRef: toRepoArtifactRef(target.repoRoot, target.sourceRepoRoot),
    },
  };
}

export function buildDefaultLivingDocMarkers(productId: string): Record<LivingDocDocument, string[]> {
  if (productId === "grace") {
    return {
      "RequirementsAnalysis.xml": ["UC-GRACE-STATE-MACHINE", "UC-GRACE-POLICY-GUARDS"],
      "Technology.xml": ["DEC-GRACE-ENGINE-001", "DEC-GRACE-POLICY-001"],
      "DevelopmentPlan.xml": ["DP-SVC-grace-workflow-core", "DP-SVC-grace-policy-engine"],
      "DevelopmentExecutionPlan.xml": ["W1-T1", "W2-T1"],
    };
  }

  return {
    "RequirementsAnalysis.xml": ["<UseCase id=", "<NonFunctionalRequirements>"],
    "Technology.xml": ["<Decision id=", "<Framework"],
    "DevelopmentPlan.xml": ["<Module id=", "<FunctionContract id="],
    "DevelopmentExecutionPlan.xml": ["<Task", "<DeliveryPolicy"],
  };
}
