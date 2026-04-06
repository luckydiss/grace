import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import type { ProductTargetConfig } from "../runtime/product-target.js";
import type {
  LegacyBlockAnchorDraft,
  LegacyContractDrafts,
  LegacyFunctionContractDraft,
  LegacyModuleContractDraft,
} from "./contracts.js";
import { readLegacyRiskReport, readLegacyScanReport } from "./scan.js";

export interface InferLegacyContractsInput {
  target: ProductTargetConfig;
  scanReportFile?: string;
  riskReportFile?: string;
  draftsFile?: string;
}

export interface InferLegacyContractsResult {
  draftsFile: string;
  drafts: LegacyContractDrafts;
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

function inferModuleRef(fileRef: string): string {
  if (!fileRef.includes("/")) {
    return ".";
  }
  return fileRef.slice(0, fileRef.lastIndexOf("/"));
}

function inferIntent(fileRef: string): string {
  const fileName = fileRef.split("/").at(-1) ?? fileRef;
  const stem = fileName.replace(/\.[^.]+$/u, "");
  return `Legacy function draft inferred from ${stem} to preserve a bounded semantic entry point for future edits.`;
}

function inferAnchorKind(fileRef: string, role: string | undefined): LegacyBlockAnchorDraft["kind"] {
  if (role === "entrypoint") {
    return "entrypoint-flow";
  }
  if (role === "test") {
    return "test-surface";
  }
  if (role === "dependency-surface") {
    return "dependency-surface";
  }
  return "source-file";
}

function buildDrafts(target: ProductTargetConfig, scanReportFile: string, riskReportFile: string): LegacyContractDrafts {
  const scan = readLegacyScanReport(scanReportFile);
  const risk = readLegacyRiskReport(riskReportFile);

  const moduleMap = new Map<string, LegacyModuleContractDraft>();
  const functionContracts: LegacyFunctionContractDraft[] = [];
  const blockAnchors: LegacyBlockAnchorDraft[] = [];

  const relevantFiles = scan.topology.filter(
    (entry) =>
      entry.kind === "file" &&
      (entry.role === "entrypoint" ||
        entry.role === "test" ||
        entry.role === "dependency-surface" ||
        entry.role === "source"),
  );

  for (const file of relevantFiles) {
    const moduleRef = inferModuleRef(file.ref);
    const moduleId = `MC-legacy-${sanitizeIdFragment(moduleRef === "." ? "root" : moduleRef)}`;
    if (!moduleMap.has(moduleId)) {
      const moduleRiskCount = risk.findings.filter(
        (finding) => finding.ref === moduleRef || finding.ref.startsWith(`${moduleRef}/`) || moduleRef === ".",
      ).length;
      moduleMap.set(moduleId, {
        id: moduleId,
        ref: moduleRef,
        language: file.language,
        rationale:
          moduleRiskCount > 0
            ? `Legacy module draft inferred from scan topology and ${moduleRiskCount} related risk findings.`
            : "Legacy module draft inferred from scan topology to preserve semantic grouping before edits.",
        functionContractIds: [],
      });
    }

    const functionId = `FC-legacy-${sanitizeIdFragment(file.ref)}`;
    const anchorId = `BA-legacy-${sanitizeIdFragment(file.ref)}-${file.role ?? "source"}`;
    functionContracts.push({
      id: functionId,
      ref: file.ref,
      language: file.language,
      moduleContractId: moduleId,
      blockAnchorIds: [anchorId],
      intent: inferIntent(file.ref),
    });
    blockAnchors.push({
      id: anchorId,
      ownerFunctionContractId: functionId,
      kind: inferAnchorKind(file.ref, file.role),
      ref: file.ref,
      rationale: `Draft anchor inferred from scan role ${file.role ?? "source"} for ${file.ref}.`,
    });

    moduleMap.get(moduleId)?.functionContractIds.push(functionId);
  }

  const moduleContracts = Array.from(moduleMap.values()).sort((left, right) => left.id.localeCompare(right.id));
  functionContracts.sort((left, right) => left.id.localeCompare(right.id));
  blockAnchors.sort((left, right) => left.id.localeCompare(right.id));

  return {
    schemaVersion: "grace-legacy-contract-drafts-v1",
    productId: target.productId,
    traceId: target.traceId,
    sourceRepoRoot: target.sourceRepoRoot,
    generatedAt: new Date().toISOString(),
    moduleContracts,
    functionContracts,
    blockAnchors,
    summary: {
      moduleContractCount: moduleContracts.length,
      functionContractCount: functionContracts.length,
      blockAnchorCount: blockAnchors.length,
    },
  };
}

export function inferLegacyContracts(input: InferLegacyContractsInput): InferLegacyContractsResult {
  const scanReportFile =
    input.scanReportFile ?? resolve(input.target.productRoot, "docs", "grace", "reports", "LegacyScanReport.json");
  const riskReportFile =
    input.riskReportFile ?? resolve(input.target.productRoot, "docs", "grace", "reports", "LegacyRiskReport.json");
  const draftsFile =
    input.draftsFile ?? resolve(input.target.productRoot, "docs", "grace", "reports", "LegacyContractDrafts.json");

  const sourceRepoStatusBefore = statSync(input.target.sourceRepoRoot).mtimeMs;
  const drafts = buildDrafts(input.target, scanReportFile, riskReportFile);

  mkdirSync(dirname(draftsFile), { recursive: true });
  writeFileSync(draftsFile, `${JSON.stringify(drafts, null, 2)}\n`, "utf8");

  const sourceRepoStatusAfter = statSync(input.target.sourceRepoRoot).mtimeMs;
  if (sourceRepoStatusAfter !== sourceRepoStatusBefore) {
    throw new Error("legacy contract inference must not mutate the source repository");
  }

  return {
    draftsFile,
    drafts,
  };
}

export function readLegacyContractDrafts(draftsFile: string): LegacyContractDrafts {
  return JSON.parse(readFileSync(draftsFile, "utf8")) as LegacyContractDrafts;
}
