import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import {
  buildLegacyWorkspaceDescriptor,
  buildSourceRepoMap,
  inferTraceId,
  resolveLegacyOverlayTarget,
  resolveProductTarget,
} from "./product-target.js";

test("resolveProductTarget defaults sourceRepoRoot to productRoot", () => {
  const target = resolveProductTarget({
    repoRoot: "C:/repo",
    productRoot: "C:/repo/products/test-project",
    productId: "test-project",
  });

  assert.equal(target.mode, "product");
  assert.equal(target.sourceRepoRoot, resolve("C:/repo/products/test-project"));
  assert.equal(target.traceId, inferTraceId("test-project"));
});

test("resolveLegacyOverlayTarget preserves separate source repository root", () => {
  const target = resolveLegacyOverlayTarget({
    repoRoot: "C:/repo",
    productRoot: "C:/repo/products/legacy-overlay",
    sourceRepoRoot: "C:/legacy/apps/billing-service",
    productId: "billing-legacy",
  });

  assert.equal(target.mode, "legacy-overlay");
  assert.equal(target.sourceRepoRoot, resolve("C:/legacy/apps/billing-service"));
  assert.equal(target.productRoot, resolve("C:/repo/products/legacy-overlay"));
});

test("legacy workspace descriptor captures overlay and source repository topology", () => {
  const target = resolveLegacyOverlayTarget({
    repoRoot: "C:/repo",
    productRoot: "C:/repo/products/legacy-overlay",
    sourceRepoRoot: "C:/repo/legacy/billing-service",
    productId: "billing-legacy",
  });

  const descriptor = buildLegacyWorkspaceDescriptor(target);
  const sourceRepoMap = buildSourceRepoMap(target);

  assert.equal(descriptor.schemaVersion, "grace-legacy-workspace-v1");
  assert.equal(descriptor.mode, "legacy-overlay");
  assert.equal(descriptor.metadata.overlayRelativeToRepoRoot, "products/legacy-overlay");
  assert.equal(descriptor.metadata.sourceRepoRelativeToRepoRoot, "legacy/billing-service");
  assert.equal(sourceRepoMap.refs.overlayRootRef, "products/legacy-overlay");
  assert.equal(sourceRepoMap.refs.sourceRepoRootRef, "legacy/billing-service");
});
