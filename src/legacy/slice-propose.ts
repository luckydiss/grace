import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { evaluateGuards } from "../policies/guard-engine.js";
import type { ProductTargetConfig } from "../runtime/product-target.js";
import { readLegacyContractDrafts } from "./infer-contracts.js";
import { readLegacyRiskReport, readLegacyScanReport } from "./scan.js";
import { readLegacyGraphRegistry } from "./trace-seed.js";

export interface LegacySliceCandidate {
  id: string;
  title: string;
  moduleContractId: string;
  functionContractId: string;
  blockAnchorIds: string[];
  writablePathHints: string[];
  rationale: string;
  riskCodes: string[];
}

export interface LegacySlicePlan {
  schemaVersion: "grace-legacy-slice-plan-v1";
  productId: string;
  traceId: string;
  sourceRepoRoot: string;
  generatedAt: string;
  candidates: LegacySliceCandidate[];
  summary: {
    candidateCount: number;
    highRiskCandidateCount: number;
  };
}

export interface LegacyEditDryRun {
  schemaVersion: "grace-legacy-edit-dry-run-v1";
  productId: string;
  traceId: string;
  sourceRepoRoot: string;
  generatedAt: string;
  sliceId: string;
  writeModeAuthorized: boolean;
  editablePathWhitelist: string[];
  requestedWritePaths: string[];
  ok: boolean;
  failures: Array<{ code: string; message: string }>;
}

export interface ProposeLegacySliceInput {
  target: ProductTargetConfig;
  scanReportFile?: string;
  riskReportFile?: string;
  draftsFile?: string;
  registryFile?: string;
  planFile?: string;
}

export interface ProposeLegacySliceResult {
  planFile: string;
  plan: LegacySlicePlan;
}

export interface ProposeLegacyEditDryRunInput {
  target: ProductTargetConfig;
  planFile?: string;
  policyFile?: string;
  dryRunFile?: string;
  sliceId: string;
  requestedWritePaths: string[];
  writeModeAuthorized: boolean;
}

export interface ProposeLegacyEditDryRunResult {
  dryRunFile: string;
  dryRun: LegacyEditDryRun;
}

function sanitizeIdFragment(value: string): string {
  return value
    .replaceAll("\\", "-")
    .replaceAll("/", "-")
    .replaceAll(".", "-")
    .replace(/[^A-Za-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function buildSlicePlan(input: ProposeLegacySliceInput): LegacySlicePlan {
  const scan = readLegacyScanReport(
    input.scanReportFile ?? resolve(input.target.productRoot, "docs", "grace", "reports", "LegacyScanReport.json"),
  );
  const risk = readLegacyRiskReport(
    input.riskReportFile ?? resolve(input.target.productRoot, "docs", "grace", "reports", "LegacyRiskReport.json"),
  );
  const drafts = readLegacyContractDrafts(
    input.draftsFile ?? resolve(input.target.productRoot, "docs", "grace", "reports", "LegacyContractDrafts.json"),
  );
  const registry = readLegacyGraphRegistry(
    input.registryFile ?? resolve(input.target.productRoot, "docs", "grace", "reports", "LegacyGraphRegistry.json"),
  );

  const candidates: LegacySliceCandidate[] = [];
  const functionContracts = drafts.functionContracts.filter(
    (contract) =>
      scan.entrypoints.includes(contract.ref) || scan.tests.includes(contract.ref) || contract.ref.startsWith("src/"),
  );

  for (const contract of functionContracts) {
    const moduleContract = drafts.moduleContracts.find((candidate) => candidate.id === contract.moduleContractId);
    if (!moduleContract) {
      continue;
    }

    const relatedRisks = risk.findings
      .filter((finding) => finding.ref === contract.ref || finding.ref === moduleContract.ref || finding.ref === ".")
      .map((finding) => finding.code);
    const anchorIds = registry.edges
      .filter((edge) => edge.from === contract.id && edge.relation === "owns-anchor")
      .map((edge) => edge.to);

    candidates.push({
      id: `SLICE-legacy-${sanitizeIdFragment(contract.ref)}`,
      title: `Stabilize ${contract.ref}`,
      moduleContractId: moduleContract.id,
      functionContractId: contract.id,
      blockAnchorIds: anchorIds,
      writablePathHints: [contract.ref],
      rationale:
        relatedRisks.length > 0
          ? `Bounded first slice selected from inferred contract ${contract.id} with related risks ${relatedRisks.join(", ")}.`
          : `Bounded first slice selected from inferred contract ${contract.id} as a low-coupling entry point.`,
      riskCodes: relatedRisks,
    });
  }

  const uniqueCandidates = candidates
    .sort((left, right) => left.id.localeCompare(right.id))
    .slice(0, 5);

  return {
    schemaVersion: "grace-legacy-slice-plan-v1",
    productId: input.target.productId,
    traceId: input.target.traceId,
    sourceRepoRoot: input.target.sourceRepoRoot,
    generatedAt: new Date().toISOString(),
    candidates: uniqueCandidates,
    summary: {
      candidateCount: uniqueCandidates.length,
      highRiskCandidateCount: uniqueCandidates.filter((candidate) => candidate.riskCodes.length > 0).length,
    },
  };
}

export function proposeLegacySlice(input: ProposeLegacySliceInput): ProposeLegacySliceResult {
  const planFile =
    input.planFile ?? resolve(input.target.productRoot, "docs", "grace", "reports", "LegacySlicePlan.json");

  const sourceRepoStatusBefore = statSync(input.target.sourceRepoRoot).mtimeMs;
  const plan = buildSlicePlan(input);

  mkdirSync(dirname(planFile), { recursive: true });
  writeFileSync(planFile, `${JSON.stringify(plan, null, 2)}\n`, "utf8");

  const sourceRepoStatusAfter = statSync(input.target.sourceRepoRoot).mtimeMs;
  if (sourceRepoStatusAfter !== sourceRepoStatusBefore) {
    throw new Error("legacy slice proposal must not mutate the source repository");
  }

  return {
    planFile,
    plan,
  };
}

export function readLegacySlicePlan(planFile: string): LegacySlicePlan {
  return JSON.parse(readFileSync(planFile, "utf8")) as LegacySlicePlan;
}

export function proposeLegacyDryRunEdit(input: ProposeLegacyEditDryRunInput): ProposeLegacyEditDryRunResult {
  const plan = readLegacySlicePlan(
    input.planFile ?? resolve(input.target.productRoot, "docs", "grace", "reports", "LegacySlicePlan.json"),
  );
  const candidate = plan.candidates.find((item) => item.id === input.sliceId);
  if (!candidate) {
    throw new Error(`unknown legacy slice candidate: ${input.sliceId}`);
  }

  const dryRunFile =
    input.dryRunFile ?? resolve(input.target.productRoot, "docs", "grace", "reports", "LegacyEditDryRun.json");
  const requestedWritePaths = input.requestedWritePaths.map((filePath) => resolve(filePath));
  const editablePathWhitelist = candidate.writablePathHints.map((filePath) => resolve(input.target.sourceRepoRoot, filePath));
  const guard = evaluateGuards({
    productId: input.target.productId,
    traceId: input.target.traceId,
    currentState: "LEGACY_SLICE_READY",
    actor: "COORDINATOR",
    transition: "block_workflow",
    artifactRefs: [],
    policyFile: input.policyFile ?? resolve(input.target.productRoot, "docs", "grace", "policies", "transition-policy.json"),
    sourceRepoRoot: input.target.sourceRepoRoot,
    requestedWritePaths,
    writeModeAuthorized: input.writeModeAuthorized,
    editablePathWhitelist,
  });

  const sourceRepoStatusBefore = statSync(input.target.sourceRepoRoot).mtimeMs;
  const dryRun: LegacyEditDryRun = {
    schemaVersion: "grace-legacy-edit-dry-run-v1",
    productId: input.target.productId,
    traceId: input.target.traceId,
    sourceRepoRoot: input.target.sourceRepoRoot,
    generatedAt: new Date().toISOString(),
    sliceId: input.sliceId,
    writeModeAuthorized: input.writeModeAuthorized,
    editablePathWhitelist,
    requestedWritePaths,
    ok: guard.ok,
    failures: guard.failures,
  };

  mkdirSync(dirname(dryRunFile), { recursive: true });
  writeFileSync(dryRunFile, `${JSON.stringify(dryRun, null, 2)}\n`, "utf8");

  const sourceRepoStatusAfter = statSync(input.target.sourceRepoRoot).mtimeMs;
  if (sourceRepoStatusAfter !== sourceRepoStatusBefore) {
    throw new Error("legacy edit dry-run must not mutate the source repository");
  }

  return {
    dryRunFile,
    dryRun,
  };
}
