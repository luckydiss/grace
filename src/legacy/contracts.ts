export interface LegacyModuleContractDraft {
  id: string;
  ref: string;
  language?: string;
  rationale: string;
  functionContractIds: string[];
}

export interface LegacyFunctionContractDraft {
  id: string;
  ref: string;
  language?: string;
  moduleContractId: string;
  blockAnchorIds: string[];
  intent: string;
}

export interface LegacyBlockAnchorDraft {
  id: string;
  ownerFunctionContractId: string;
  kind: "module-boundary" | "entrypoint-flow" | "test-surface" | "dependency-surface" | "source-file";
  ref: string;
  rationale: string;
}

export interface LegacyContractDrafts {
  schemaVersion: "grace-legacy-contract-drafts-v1";
  productId: string;
  traceId: string;
  sourceRepoRoot: string;
  generatedAt: string;
  moduleContracts: LegacyModuleContractDraft[];
  functionContracts: LegacyFunctionContractDraft[];
  blockAnchors: LegacyBlockAnchorDraft[];
  summary: {
    moduleContractCount: number;
    functionContractCount: number;
    blockAnchorCount: number;
  };
}
