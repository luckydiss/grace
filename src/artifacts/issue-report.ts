import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import type { EmitIssueReportInput, EmitIssueReportResult } from "./index.js";

/**
 * <!-- MODULE_MAP id="MM-grace-artifact-adapters" -->
 * <Layers>
 *   <Layer name="domain" package="src/artifacts/index.ts">
 *     Contracts for deterministic issue-report effects emitted by blocked workflow transitions.
 *   </Layer>
 *   <Layer name="application" package="src/artifacts/issue-report.ts">
 *     Materializes blocked transition failures into durable GRACE XML issue-report artifacts.
 *   </Layer>
 * </Layers>
 * <Links>
 *   <Link ref="RequirementsAnalysis.xml#DC-GRACE-ISSUE-REPORT" />
 *   <Link ref="DevelopmentPlan.xml#DP-SVC-grace-artifact-adapters" />
 * </Links>
 * <!-- /MODULE_MAP -->
 */

/**
 * <MODULE_CONTRACT id="MC-grace-artifact-adapters">
 *   <Purpose>Convert blocked workflow outcomes into durable GRACE evidence artifacts without relying on prompt-only reporting.</Purpose>
 *   <Links>
 *     <Link ref="RequirementsAnalysis.xml#DC-GRACE-ISSUE-REPORT" />
 *     <Link ref="RequirementsAnalysis.xml#NFR-GRACE-AUDITABILITY" />
 *   </Links>
 * </MODULE_CONTRACT>
 */

const DEFAULT_REPORT_DIR = "docs/grace/reports/issues";

function ensureParentDir(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function defaultReportFile(transitionId: string): string {
  return `${DEFAULT_REPORT_DIR}/IssueReport-${transitionId}.xml`;
}

/**
 * <FUNCTION_CONTRACT id="FC-grace-artifacts-emitIssueReport">
 *   <Intent>Emit one deterministic XML issue report whenever a workflow transition is blocked by machine-enforced guards.</Intent>
 *   <Inputs>
 *     <Input name="input">Blocked transition context, guard failures, and optional issue-report path override.</Input>
 *   </Inputs>
 *   <Outputs>
 *     <Output name="result">Issue-report identifier, persisted path, and artifact ref for downstream evidence chains.</Output>
 *   </Outputs>
 *   <BlockAnchors>
 *     <BA ref="BA-grace-build-issue-report" />
 *     <BA ref="BA-grace-persist-issue-report" />
 *   </BlockAnchors>
 *   <Links>
 *     <Link ref="RequirementsAnalysis.xml#DC-GRACE-ISSUE-REPORT" />
 *   </Links>
 * </FUNCTION_CONTRACT>
 */
export function emitIssueReport(input: EmitIssueReportInput): EmitIssueReportResult {
  /* <BLOCK_ANCHOR id="BA-grace-build-issue-report" purpose="Build a deterministic issue-report document from blocked transition failures" /> */
  const issueReportId = `ISSUE-RPT-${input.transitionId}`;
  const absoluteReportFile = resolve(input.reportFile ?? defaultReportFile(input.transitionId));
  const artifactRef = relative(resolve(input.productId), absoluteReportFile).replaceAll("\\", "/");
  const issueLines = input.failures
    .map(
      (failure, index) => `  <Issue id="ISS-${input.transitionId}-${String(index + 1).padStart(3, "0")}">
    <Severity>BLOCKING</Severity>
    <Description>${xmlEscape(failure.message)}</Description>
    <Evidence>code=${xmlEscape(failure.code)} transition=${xmlEscape(input.transition)} from=${xmlEscape(input.fromState)} to=${xmlEscape(input.toState)}</Evidence>
    <Impact>Workflow transition was deterministically blocked and global process state cannot progress until the guard failure is resolved.</Impact>
    <ProposedFix>Resolve the failing guard condition and resubmit the transition through the workflow engine.</ProposedFix>
    <RequiredAgent>GRACE-${xmlEscape(input.actor)}</RequiredAgent>
  </Issue>`,
    )
    .join("\n");
  const artifactLines = input.artifactRefs
    .map((artifactRefValue) => `    <Ref value="${xmlEscape(artifactRefValue)}" />`)
    .join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<WorkflowIssueReport
  id="${xmlEscape(issueReportId)}"
  traceId="${xmlEscape(input.traceId)}"
  productId="${xmlEscape(input.productId)}"
  transitionId="${xmlEscape(input.transitionId)}"
  gateStatus="FAIL"
  created="${xmlEscape(input.createdAt)}"
  validatedBy="GRACE-RUNTIME"
>
  <Summary>
    Transition ${xmlEscape(input.transition)} from ${xmlEscape(input.fromState)} to ${xmlEscape(input.toState)} was blocked by machine-enforced guards.
  </Summary>
  <WorkflowContext actor="${xmlEscape(input.actor)}" transition="${xmlEscape(input.transition)}" fromState="${xmlEscape(input.fromState)}" toState="${xmlEscape(input.toState)}" />
  <ArtifactRefs>
${artifactLines}
  </ArtifactRefs>
${issueLines}
</WorkflowIssueReport>
`;

  /* <BLOCK_ANCHOR id="BA-grace-persist-issue-report" purpose="Persist the issue-report XML as durable blocked-transition evidence" /> */
  ensureParentDir(absoluteReportFile);
  writeFileSync(absoluteReportFile, xml, "utf8");

  return {
    issueReportId,
    reportFile: absoluteReportFile,
    artifactRef,
  };
}
