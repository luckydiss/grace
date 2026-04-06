export type { LegacyWorkspaceDescriptor, SourceRepoMap } from "../runtime/product-target.js";
export {
  buildLegacyWorkspaceDescriptor,
  buildSourceRepoMap,
  resolveLegacyOverlayTarget,
} from "../runtime/product-target.js";
export { bootstrapLegacyOverlayWorkspace, persistLegacyOverlayMetadata } from "./bootstrap.js";
export type {
  LegacyBlockAnchorDraft,
  LegacyContractDrafts,
  LegacyFunctionContractDraft,
  LegacyModuleContractDraft,
} from "./contracts.js";
export { inferLegacyContracts, readLegacyContractDrafts } from "./infer-contracts.js";
export { readLegacyRiskReport, readLegacyScanReport, scanLegacyRepository } from "./scan.js";
export type { LegacyEditDryRun, LegacySliceCandidate, LegacySlicePlan } from "./slice-propose.js";
export { proposeLegacyDryRunEdit, proposeLegacySlice, readLegacySlicePlan } from "./slice-propose.js";
export { readLegacyGraphRegistry, seedLegacyTraceability } from "./trace-seed.js";
