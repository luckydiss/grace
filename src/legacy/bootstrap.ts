import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import {
  type ProductTargetConfig,
  buildProductArtifactRef,
  buildLegacyWorkspaceDescriptor,
  buildSourceRepoMap,
} from "../runtime/product-target.js";

export interface PersistLegacyOverlayMetadataInput {
  target: ProductTargetConfig;
  legacyWorkspaceFile: string;
  sourceRepoMapFile: string;
}

export interface PersistLegacyOverlayMetadataResult {
  legacyWorkspace: ReturnType<typeof buildLegacyWorkspaceDescriptor>;
  sourceRepoMap: ReturnType<typeof buildSourceRepoMap>;
}

export interface BootstrapLegacyOverlayInput {
  target: ProductTargetConfig;
  frameworkRoot: string;
  productName?: string;
}

export interface BootstrapLegacyOverlayResult extends PersistLegacyOverlayMetadataResult {
  docsGraceRoot: string;
  stateFile: string;
  policyFile: string;
  approvalsFile: string;
}

function ensureParentDir(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

function copyTemplateTree(sourceDir: string, targetDir: string, replacements: Array<[string, string]>): void {
  mkdirSync(targetDir, { recursive: true });
  for (const entry of readdirSync(sourceDir)) {
    const srcPath = join(sourceDir, entry);
    const destPath = join(targetDir, entry);
    const st = statSync(srcPath);
    if (st.isDirectory()) {
      copyTemplateTree(srcPath, destPath, replacements);
      continue;
    }
    let content = readFileSync(srcPath, "utf8");
    for (const [needle, value] of replacements) {
      content = content.replaceAll(needle, value);
    }
    writeFileSync(destPath, content, "utf8");
  }
}

function buildWorkflowState(productId: string): string {
  const traceId = `TRACE-${productId.toUpperCase().replace(/[^A-Z0-9]+/g, "-")}-CORE`;
  return `${JSON.stringify(
    {
      schemaVersion: "grace-workflow-state-v1",
      productId,
      traceId,
      currentState: "INTAKE_RECEIVED",
      currentActor: "COORDINATOR",
      updatedAt: new Date().toISOString(),
      activeHandoffRef: null,
      activeCwoRef: null,
      blocked: false,
      blockReasons: [],
    },
    null,
    2,
  )}\n`;
}

function buildTransitionPolicy(productId: string, artifactBaseRef: string): string {
  const traceId = `TRACE-${productId.toUpperCase().replace(/[^A-Z0-9]+/g, "-")}-CORE`;
  const docRef = (suffix: string) => `${artifactBaseRef}/docs/grace/${suffix}`;
  return `${JSON.stringify(
    {
      schemaVersion: "grace-transition-policy-v1",
      productId,
      traceId,
      transitions: {
        classify_intake: { allowedActors: ["COORDINATOR", "SYSTEM"], requiredArtifactRefs: [] },
        block_intake: { allowedActors: ["COORDINATOR", "SYSTEM"], requiredArtifactRefs: [] },
        bootstrap_legacy_overlay: {
          allowedActors: ["COORDINATOR", "SYSTEM"],
          requiredArtifactRefs: [docRef("LegacyWorkspace.json"), docRef("SourceRepoMap.json")],
        },
        scan_legacy_repo: {
          allowedActors: ["COORDINATOR", "SYSTEM"],
          requiredArtifactRefs: [docRef("reports/LegacyScanReport.json"), docRef("reports/LegacyRiskReport.json")],
        },
        infer_legacy_contracts: {
          allowedActors: ["ARCHITECT", "SYSTEM"],
          requiredArtifactRefs: [docRef("reports/LegacyContractDrafts.json")],
        },
        seed_legacy_traceability: {
          allowedActors: ["ARCHITECT", "SYSTEM"],
          requiredArtifactRefs: [docRef("reports/LegacyGraphRegistry.json")],
        },
        propose_legacy_slice: {
          allowedActors: ["CODER", "SYSTEM"],
          requiredArtifactRefs: [docRef("reports/LegacySlicePlan.json")],
        },
        start_blueprint: {
          allowedActors: ["ARCHITECT", "COORDINATOR"],
          requiredArtifactRefs: [docRef("RequirementsAnalysis.xml"), docRef("Technology.xml")],
        },
        submit_blueprint_for_review: {
          allowedActors: ["ARCHITECT"],
          requiredArtifactRefs: [docRef("DevelopmentPlan.xml"), docRef("DevelopmentExecutionPlan.xml")],
        },
        approve_blueprint: {
          allowedActors: ["COORDINATOR", "HUMAN"],
          requiredArtifactRefs: [docRef("DevelopmentPlan.xml")],
        },
        reject_blueprint: {
          allowedActors: ["COORDINATOR", "HUMAN"],
          requiredArtifactRefs: [docRef("DevelopmentPlan.xml")],
        },
        start_handoff: {
          allowedActors: ["COORDINATOR", "ARCHITECT"],
          requiredArtifactRefs: [docRef("handoffs/")],
        },
        propose_handoff: {
          allowedActors: ["COORDINATOR", "ARCHITECT"],
          requiredArtifactRefs: [docRef("handoffs/")],
        },
        request_handoff_approval: {
          allowedActors: ["COORDINATOR", "ARCHITECT"],
          requiredArtifactRefs: [docRef("handoffs/")],
        },
        approve_handoff: {
          allowedActors: ["HUMAN"],
          requiredArtifactRefs: [docRef("handoffs/")],
        },
        reject_handoff: {
          allowedActors: ["HUMAN", "COORDINATOR"],
          requiredArtifactRefs: [docRef("handoffs/")],
        },
        draft_cwo: {
          allowedActors: ["COORDINATOR"],
          requiredArtifactRefs: [docRef("handoffs/")],
        },
        issue_branchspec: {
          allowedActors: ["COORDINATOR"],
          requiredArtifactRefs: [docRef("cwo/")],
        },
        issue_cwo: {
          allowedActors: ["COORDINATOR"],
          requiredArtifactRefs: [docRef("approvals.log"), docRef("cwo/")],
        },
        reject_cwo: {
          allowedActors: ["COORDINATOR"],
          requiredArtifactRefs: [docRef("cwo/")],
        },
        activate_coder: {
          allowedActors: ["COORDINATOR", "SYSTEM"],
          requiredArtifactRefs: [docRef("cwo/")],
        },
        pause_coder: {
          allowedActors: ["COORDINATOR", "SYSTEM"],
          requiredArtifactRefs: [docRef("cwo/")],
        },
        submit_coder_output: {
          allowedActors: ["CODER"],
          requiredArtifactRefs: [],
        },
        reject_coder_output: {
          allowedActors: ["COORDINATOR", "SYSTEM"],
          requiredArtifactRefs: [docRef("cwo/")],
        },
        split_scope_and_reissue_cwo: {
          allowedActors: ["COORDINATOR"],
          requiredArtifactRefs: [docRef("cwo/")],
        },
        start_verification: {
          allowedActors: ["COORDINATOR", "SYSTEM"],
          requiredArtifactRefs: [],
        },
        record_verification_pass: {
          allowedActors: ["COORDINATOR", "SYSTEM"],
          requiredArtifactRefs: [],
        },
        record_verification_fail: {
          allowedActors: ["COORDINATOR", "SYSTEM"],
          requiredArtifactRefs: [],
        },
        record_traceability_pass: {
          allowedActors: ["COORDINATOR", "SYSTEM"],
          requiredArtifactRefs: [],
        },
        record_traceability_fail: {
          allowedActors: ["COORDINATOR", "SYSTEM"],
          requiredArtifactRefs: [],
        },
        record_living_doc_fail: {
          allowedActors: ["COORDINATOR", "SYSTEM"],
          requiredArtifactRefs: [docRef("reports/living-doc-report.json")],
        },
        capture_failure: {
          allowedActors: ["COORDINATOR", "SYSTEM"],
          requiredArtifactRefs: [],
        },
        append_failure_memory: {
          allowedActors: ["COORDINATOR", "SYSTEM"],
          requiredArtifactRefs: [docRef("reports/failure-memory.json")],
        },
        inject_forced_context: {
          allowedActors: ["COORDINATOR", "SYSTEM"],
          requiredArtifactRefs: [docRef("reports/failure-memory.json"), docRef("reports/forced-context.json")],
        },
        evaluate_loop_guard: {
          allowedActors: ["COORDINATOR", "SYSTEM"],
          requiredArtifactRefs: [docRef("reports/loop-guard.json")],
        },
        allow_remediation: {
          allowedActors: ["COORDINATOR", "SYSTEM"],
          requiredArtifactRefs: [docRef("reports/loop-guard.json")],
        },
        block_remediation: {
          allowedActors: ["COORDINATOR", "SYSTEM"],
          requiredArtifactRefs: [docRef("reports/loop-guard.json")],
        },
        mark_ready_for_release: {
          allowedActors: ["COORDINATOR", "SYSTEM"],
          requiredArtifactRefs: [],
        },
        mark_delivered: {
          allowedActors: ["COORDINATOR", "SYSTEM"],
          requiredArtifactRefs: [],
        },
        archive_delivery: {
          allowedActors: ["COORDINATOR", "SYSTEM"],
          requiredArtifactRefs: [],
        },
        block_workflow: {
          allowedActors: ["COORDINATOR", "SYSTEM"],
          requiredArtifactRefs: [],
        },
        escalate_to_human: {
          allowedActors: ["COORDINATOR", "SYSTEM"],
          requiredArtifactRefs: [],
        },
        cancel_workflow: {
          allowedActors: ["HUMAN", "COORDINATOR"],
          requiredArtifactRefs: [],
        },
      },
    },
    null,
    2,
  )}\n`;
}

export function persistLegacyOverlayMetadata(
  input: PersistLegacyOverlayMetadataInput,
): PersistLegacyOverlayMetadataResult {
  const legacyWorkspace = buildLegacyWorkspaceDescriptor(input.target);
  const sourceRepoMap = buildSourceRepoMap(input.target);

  ensureParentDir(input.legacyWorkspaceFile);
  ensureParentDir(input.sourceRepoMapFile);
  writeFileSync(input.legacyWorkspaceFile, `${JSON.stringify(legacyWorkspace, null, 2)}\n`, "utf8");
  writeFileSync(input.sourceRepoMapFile, `${JSON.stringify(sourceRepoMap, null, 2)}\n`, "utf8");

  return {
    legacyWorkspace,
    sourceRepoMap,
  };
}

export function bootstrapLegacyOverlayWorkspace(
  input: BootstrapLegacyOverlayInput,
): BootstrapLegacyOverlayResult {
  const frameworkRoot = resolve(input.frameworkRoot);
  const docsGraceRoot = resolve(input.target.productRoot, "docs", "grace");
  const templatesDir = resolve(frameworkRoot, "docs", "grace", "templates");
  const productName = input.productName ?? `${input.target.productId} Legacy Overlay`;
  const artifactBaseRef = relative(frameworkRoot, input.target.productRoot).replaceAll("\\", "/");

  mkdirSync(resolve(input.target.productRoot, "src"), { recursive: true });
  mkdirSync(resolve(docsGraceRoot, "state"), { recursive: true });
  mkdirSync(resolve(docsGraceRoot, "policies"), { recursive: true });
  mkdirSync(resolve(docsGraceRoot, "reports", "issues"), { recursive: true });
  mkdirSync(resolve(docsGraceRoot, "executions"), { recursive: true });

  copyTemplateTree(templatesDir, docsGraceRoot, [
    ["__PRODUCT_ID__", input.target.productId],
    ["__PRODUCT_NAME__", productName],
  ]);

  const stateFile = resolve(docsGraceRoot, "state", "WorkflowState.json");
  const transitionLogFile = resolve(docsGraceRoot, "state", "TransitionLog.jsonl");
  const policyFile = resolve(docsGraceRoot, "policies", "transition-policy.json");
  const approvalsFile = resolve(docsGraceRoot, "approvals.log");
  const legacyWorkspaceFile = resolve(docsGraceRoot, "LegacyWorkspace.json");
  const sourceRepoMapFile = resolve(docsGraceRoot, "SourceRepoMap.json");

  writeFileSync(stateFile, buildWorkflowState(input.target.productId), "utf8");
  writeFileSync(transitionLogFile, "", "utf8");
  writeFileSync(policyFile, buildTransitionPolicy(input.target.productId, artifactBaseRef), "utf8");
  const metadata = persistLegacyOverlayMetadata({
    target: input.target,
    legacyWorkspaceFile,
    sourceRepoMapFile,
  });

  const readmeFile = resolve(input.target.productRoot, "README.md");
  writeFileSync(
    readmeFile,
    [
      `# ${productName}`,
      "",
      "Bootstrapped as a GRACE legacy overlay workspace.",
      "",
      `- Product id: \`${input.target.productId}\``,
      `- Overlay workspace: \`${buildProductArtifactRef(input.target.repoRoot, input.target.productRoot, ".")}\``,
      `- Source repository: \`${metadata.sourceRepoMap.refs.sourceRepoRootRef}\``,
      "- This bootstrap is read-only with respect to the source repository.",
    ].join("\n"),
    "utf8",
  );

  return {
    ...metadata,
    docsGraceRoot,
    stateFile,
    policyFile,
    approvalsFile,
  };
}
