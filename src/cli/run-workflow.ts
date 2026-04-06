import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildGraceWorkflow, resumeGraceWorkflow } from "../graph/workflow.js";
import {
  buildProductArtifactRef,
  resolveProductTarget,
} from "../runtime/product-target.js";

interface CliArgs {
  mode: "start" | "resume";
  repoRoot: string;
  productRoot: string;
  sourceRepoRoot?: string;
  productId?: string;
  traceId?: string;
  threadId: string;
  verificationMode: "pass" | "fail";
  stateFile: string;
  transitionLogFile: string;
  issueReportFile: string;
  executionDir: string;
  policyFile: string;
  handoffRef?: string;
  approvalsRef?: string;
  approvalLogFile: string;
  requirementsFile: string;
  technologyFile: string;
  developmentPlanFile: string;
  executionPlanFile: string;
  livingDocReportFile: string;
  livingDocReportRef?: string;
  policySchemaReportFile: string;
  policySchemaReportRef?: string;
  branchSpecRef?: string;
  cwoRef?: string;
  failureMemoryFile: string;
  forcedContextFile: string;
  loopGuardFile: string;
  failureScope: string;
  failureTestId: string;
  failureErrorSignature: string;
  retryCount: number;
  retryBudget: number;
  proposedFix: string;
  approvalDecision?: "approve" | "reject";
  out: string;
  json: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    mode: "start",
    repoRoot: process.cwd(),
    productRoot: process.cwd(),
    threadId: "grace-thread-local",
    verificationMode: "pass",
    stateFile: "docs/grace/state/WorkflowState.json",
    transitionLogFile: "docs/grace/state/TransitionLog.jsonl",
    issueReportFile: "docs/grace/reports/issues/WorkflowIssueReport.xml",
    executionDir: "docs/grace/executions",
    policyFile: "docs/grace/policies/transition-policy.json",
    approvalLogFile: "docs/grace/approvals.log",
    requirementsFile: "docs/grace/RequirementsAnalysis.xml",
    technologyFile: "docs/grace/Technology.xml",
    developmentPlanFile: "docs/grace/DevelopmentPlan.xml",
    executionPlanFile: "docs/grace/DevelopmentExecutionPlan.xml",
    livingDocReportFile: "docs/grace/reports/living-doc-report.json",
    policySchemaReportFile: "docs/grace/reports/policy-schema-consistency.json",
    failureMemoryFile: "docs/grace/reports/failure-memory.json",
    forcedContextFile: "docs/grace/reports/forced-context.json",
    loopGuardFile: "docs/grace/reports/loop-guard.json",
    failureScope: "FC-grace-graph-buildWorkflow",
    failureTestId: "TC-GRACE-FAIL-01",
    failureErrorSignature: "verification failed",
    retryCount: 1,
    retryBudget: 2,
    proposedFix: "",
    out: "docs/grace/reports/workflow-run.json",
    json: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "start":
        args.mode = "start";
        break;
      case "resume":
        args.mode = "resume";
        break;
      case "--repo-root":
        args.repoRoot = argv[++i] ?? args.repoRoot;
        break;
      case "--product-root":
        args.productRoot = argv[++i] ?? args.productRoot;
        break;
      case "--source-repo-root":
        args.sourceRepoRoot = argv[++i] ?? args.sourceRepoRoot;
        break;
      case "--product-id":
        args.productId = argv[++i] ?? args.productId;
        break;
      case "--trace-id":
        args.traceId = argv[++i] ?? args.traceId;
        break;
      case "--thread-id":
        args.threadId = argv[++i] ?? args.threadId;
        break;
      case "--verification-mode":
        args.verificationMode = (argv[++i] as "pass" | "fail") ?? args.verificationMode;
        break;
      case "--state-file":
        args.stateFile = argv[++i] ?? args.stateFile;
        break;
      case "--transition-log-file":
        args.transitionLogFile = argv[++i] ?? args.transitionLogFile;
        break;
      case "--issue-report-file":
        args.issueReportFile = argv[++i] ?? args.issueReportFile;
        break;
      case "--execution-dir":
        args.executionDir = argv[++i] ?? args.executionDir;
        break;
      case "--policy-file":
        args.policyFile = argv[++i] ?? args.policyFile;
        break;
      case "--handoff-ref":
        args.handoffRef = argv[++i] ?? args.handoffRef;
        break;
      case "--approvals-ref":
        args.approvalsRef = argv[++i] ?? args.approvalsRef;
        break;
      case "--approval-log-file":
        args.approvalLogFile = argv[++i] ?? args.approvalLogFile;
        break;
      case "--requirements-file":
        args.requirementsFile = argv[++i] ?? args.requirementsFile;
        break;
      case "--technology-file":
        args.technologyFile = argv[++i] ?? args.technologyFile;
        break;
      case "--development-plan-file":
        args.developmentPlanFile = argv[++i] ?? args.developmentPlanFile;
        break;
      case "--execution-plan-file":
        args.executionPlanFile = argv[++i] ?? args.executionPlanFile;
        break;
      case "--living-doc-report-file":
        args.livingDocReportFile = argv[++i] ?? args.livingDocReportFile;
        break;
      case "--living-doc-report-ref":
        args.livingDocReportRef = argv[++i] ?? args.livingDocReportRef;
        break;
      case "--policy-schema-report-file":
        args.policySchemaReportFile = argv[++i] ?? args.policySchemaReportFile;
        break;
      case "--policy-schema-report-ref":
        args.policySchemaReportRef = argv[++i] ?? args.policySchemaReportRef;
        break;
      case "--branchspec-ref":
        args.branchSpecRef = argv[++i] ?? args.branchSpecRef;
        break;
      case "--cwo-ref":
        args.cwoRef = argv[++i] ?? args.cwoRef;
        break;
      case "--failure-memory-file":
        args.failureMemoryFile = argv[++i] ?? args.failureMemoryFile;
        break;
      case "--forced-context-file":
        args.forcedContextFile = argv[++i] ?? args.forcedContextFile;
        break;
      case "--loop-guard-file":
        args.loopGuardFile = argv[++i] ?? args.loopGuardFile;
        break;
      case "--failure-scope":
        args.failureScope = argv[++i] ?? args.failureScope;
        break;
      case "--failure-test-id":
        args.failureTestId = argv[++i] ?? args.failureTestId;
        break;
      case "--failure-error-signature":
        args.failureErrorSignature = argv[++i] ?? args.failureErrorSignature;
        break;
      case "--retry-count":
        args.retryCount = Number(argv[++i] ?? args.retryCount);
        break;
      case "--retry-budget":
        args.retryBudget = Number(argv[++i] ?? args.retryBudget);
        break;
      case "--proposed-fix":
        args.proposedFix = argv[++i] ?? "";
        break;
      case "--approval-decision":
        args.approvalDecision = (argv[++i] as "approve" | "reject") ?? args.approvalDecision;
        break;
      case "--out":
        args.out = argv[++i] ?? args.out;
        break;
      case "--json":
        args.json = true;
        break;
      default:
        break;
    }
  }

  return args;
}

function resolveMaybeRelative(baseDir: string, filePath: string): string {
  if (/^[A-Za-z]:\\/u.test(filePath) || filePath.startsWith("\\\\")) {
    return resolve(filePath);
  }
  if (filePath.startsWith("docs/") || filePath.startsWith("docs\\") || filePath.startsWith("src/") || filePath.startsWith("src\\")) {
    return resolve(baseDir, filePath);
  }
  return resolve(filePath);
}

function buildDefaultWorkflowRefs(repoRoot: string, productRoot: string, productId: string) {
  const graceDir = "docs/grace";
  return {
    handoffRef: buildProductArtifactRef(repoRoot, productRoot, `${graceDir}/handoffs/Handoff-bootstrap-${productId}.xml`),
    approvalsRef: buildProductArtifactRef(repoRoot, productRoot, `${graceDir}/approvals.log`),
    livingDocReportRef: buildProductArtifactRef(repoRoot, productRoot, `${graceDir}/reports/living-doc-report.json`),
    policySchemaReportRef: buildProductArtifactRef(repoRoot, productRoot, `${graceDir}/reports/policy-schema-consistency.json`),
    branchSpecRef: buildProductArtifactRef(repoRoot, productRoot, `${graceDir}/cwo/BS-bootstrap-${productId}.xml`),
    cwoRef: buildProductArtifactRef(repoRoot, productRoot, `${graceDir}/cwo/CWO-bootstrap-${productId}.xml`),
    requirementsRef: buildProductArtifactRef(repoRoot, productRoot, `${graceDir}/RequirementsAnalysis.xml`),
    technologyRef: buildProductArtifactRef(repoRoot, productRoot, `${graceDir}/Technology.xml`),
    developmentPlanRef: buildProductArtifactRef(repoRoot, productRoot, `${graceDir}/DevelopmentPlan.xml`),
    executionPlanRef: buildProductArtifactRef(repoRoot, productRoot, `${graceDir}/DevelopmentExecutionPlan.xml`),
  };
}

async function collectStream(streamPromise: Promise<AsyncIterable<unknown>>): Promise<unknown[]> {
  const chunks: unknown[] = [];
  const stream = await streamPromise;
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

function ensureParentDir(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

function resetPath(filePath: string): void {
  if (existsSync(filePath)) {
    rmSync(filePath, { force: true, recursive: false });
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const target = resolveProductTarget({
    repoRoot: args.repoRoot,
    productRoot: args.productRoot,
    sourceRepoRoot: args.sourceRepoRoot,
    productId: args.productId,
    traceId: args.traceId,
  });
  const workflowRefs = buildDefaultWorkflowRefs(target.repoRoot, target.productRoot, target.productId);
  const graph = buildGraceWorkflow();
  const config = { configurable: { thread_id: args.threadId } };
  const isLegacyOverlay = target.sourceRepoRoot !== target.productRoot;

  let payload: unknown;
  if (args.mode === "start") {
    if (!isLegacyOverlay) {
      resetPath(resolveMaybeRelative(target.productRoot, args.stateFile));
      resetPath(resolveMaybeRelative(target.productRoot, args.transitionLogFile));
    }
    resetPath(resolveMaybeRelative(target.productRoot, args.issueReportFile));
    resetPath(resolveMaybeRelative(target.productRoot, args.failureMemoryFile));
    resetPath(resolveMaybeRelative(target.productRoot, args.forcedContextFile));
    resetPath(resolveMaybeRelative(target.productRoot, args.loopGuardFile));
    payload = await collectStream(
      graph.stream(
        {
          repoRoot: target.repoRoot,
          productRoot: target.productRoot,
          sourceRepoRoot: target.sourceRepoRoot,
          productId: target.productId,
          traceId: target.traceId,
          stateFile: resolveMaybeRelative(target.productRoot, args.stateFile),
          transitionLogFile: resolveMaybeRelative(target.productRoot, args.transitionLogFile),
          issueReportFile: resolveMaybeRelative(target.productRoot, args.issueReportFile),
          executionDir: resolveMaybeRelative(target.productRoot, args.executionDir),
          verificationMode: args.verificationMode,
          handoffRef: args.handoffRef || workflowRefs.handoffRef,
          requirementsRef: workflowRefs.requirementsRef,
          technologyRef: workflowRefs.technologyRef,
          developmentPlanRef: workflowRefs.developmentPlanRef,
          executionPlanRef: workflowRefs.executionPlanRef,
          approvalsRef: args.approvalsRef || workflowRefs.approvalsRef,
          approvalLogFile: resolveMaybeRelative(target.productRoot, args.approvalLogFile),
          requirementsFile: resolveMaybeRelative(target.productRoot, args.requirementsFile),
          technologyFile: resolveMaybeRelative(target.productRoot, args.technologyFile),
          developmentPlanFile: resolveMaybeRelative(target.productRoot, args.developmentPlanFile),
          executionPlanFile: resolveMaybeRelative(target.productRoot, args.executionPlanFile),
          livingDocReportFile: resolveMaybeRelative(target.productRoot, args.livingDocReportFile),
          livingDocReportRef: args.livingDocReportRef || workflowRefs.livingDocReportRef,
          policySchemaReportFile: resolveMaybeRelative(target.productRoot, args.policySchemaReportFile),
          policySchemaReportRef: args.policySchemaReportRef || workflowRefs.policySchemaReportRef,
          branchSpecRef: args.branchSpecRef || workflowRefs.branchSpecRef,
          cwoRef: args.cwoRef || workflowRefs.cwoRef,
          failureMemoryFile: resolveMaybeRelative(target.productRoot, args.failureMemoryFile),
          forcedContextFile: resolveMaybeRelative(target.productRoot, args.forcedContextFile),
          loopGuardFile: resolveMaybeRelative(target.productRoot, args.loopGuardFile),
          failureScope: args.failureScope,
          failureTestId: args.failureTestId,
          failureErrorSignature: args.failureErrorSignature,
          retryCount: args.retryCount,
          retryBudget: args.retryBudget,
          proposedFix: args.proposedFix,
          policyFile: resolveMaybeRelative(target.productRoot, args.policyFile),
          currentState: null,
          approvalDecision: null,
          transitionHistory: [],
          artifactHistory: [],
          issueReportRefs: [],
        },
        config,
      ),
    );
  } else {
    if (!args.approvalDecision) {
      throw new Error("resume requires --approval-decision approve|reject");
    }
    payload = resumeGraceWorkflow(
      {
        repoRoot: target.repoRoot,
        productRoot: target.productRoot,
        sourceRepoRoot: target.sourceRepoRoot,
        productId: target.productId,
        traceId: target.traceId,
        stateFile: resolveMaybeRelative(target.productRoot, args.stateFile),
        transitionLogFile: resolveMaybeRelative(target.productRoot, args.transitionLogFile),
        issueReportFile: resolveMaybeRelative(target.productRoot, args.issueReportFile),
        executionDir: resolveMaybeRelative(target.productRoot, args.executionDir),
        verificationMode: args.verificationMode,
        handoffRef: args.handoffRef || workflowRefs.handoffRef,
        requirementsRef: workflowRefs.requirementsRef,
        technologyRef: workflowRefs.technologyRef,
        developmentPlanRef: workflowRefs.developmentPlanRef,
        executionPlanRef: workflowRefs.executionPlanRef,
        approvalsRef: args.approvalsRef || workflowRefs.approvalsRef,
        approvalLogFile: resolveMaybeRelative(target.productRoot, args.approvalLogFile),
        requirementsFile: resolveMaybeRelative(target.productRoot, args.requirementsFile),
        technologyFile: resolveMaybeRelative(target.productRoot, args.technologyFile),
        developmentPlanFile: resolveMaybeRelative(target.productRoot, args.developmentPlanFile),
        executionPlanFile: resolveMaybeRelative(target.productRoot, args.executionPlanFile),
        livingDocReportFile: resolveMaybeRelative(target.productRoot, args.livingDocReportFile),
        livingDocReportRef: args.livingDocReportRef || workflowRefs.livingDocReportRef,
        policySchemaReportFile: resolveMaybeRelative(target.productRoot, args.policySchemaReportFile),
        policySchemaReportRef: args.policySchemaReportRef || workflowRefs.policySchemaReportRef,
        branchSpecRef: args.branchSpecRef || workflowRefs.branchSpecRef,
        cwoRef: args.cwoRef || workflowRefs.cwoRef,
        failureMemoryFile: resolveMaybeRelative(target.productRoot, args.failureMemoryFile),
        forcedContextFile: resolveMaybeRelative(target.productRoot, args.forcedContextFile),
        loopGuardFile: resolveMaybeRelative(target.productRoot, args.loopGuardFile),
        failureScope: args.failureScope,
        failureTestId: args.failureTestId,
        failureErrorSignature: args.failureErrorSignature,
        retryCount: args.retryCount,
        retryBudget: args.retryBudget,
        proposedFix: args.proposedFix,
        policyFile: resolveMaybeRelative(target.productRoot, args.policyFile),
      },
      { approvalDecision: args.approvalDecision },
    );
  }

  const outPath = resolveMaybeRelative(target.productRoot, args.out);
  ensureParentDir(outPath);
  writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else if (Array.isArray(payload)) {
    console.log(`GRACE_WORKFLOW_STARTED chunks=${payload.length} out=${outPath}`);
  } else {
    const currentState =
      typeof payload === "object" && payload !== null && "currentState" in payload
        ? String((payload as { currentState?: unknown }).currentState ?? "")
        : "UNKNOWN";
    console.log(`GRACE_WORKFLOW_RESUMED state=${currentState} out=${outPath}`);
  }

  return 0;
}

void main()
  .then((code) => {
    process.exit(code);
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`GRACE_WORKFLOW_ERROR ${message}`);
    process.exit(1);
  });
