import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface ProductSummary {
  productId: string;
  productRoot: string;
  hasWorkflowState: boolean;
  currentState: string | null;
  traceId: string | null;
}

export interface WorkflowActionInput {
  repoRoot: string;
  productRoot: string;
  sourceRepoRoot?: string;
  productId?: string;
  threadId?: string;
  verificationMode?: "pass" | "fail";
}

export interface ResumeWorkflowInput extends WorkflowActionInput {
  approvalDecision: "approve" | "reject";
}

export interface AgentEvidenceInput {
  repoRoot: string;
  productRoot: string;
  productId?: string;
}

export interface AgentRunResumeInput {
  repoRoot: string;
  stateFile: string;
  logFile: string;
  status: "ACTIVE" | "SUCCEEDED" | "FAILED" | "BLOCKED";
  outputRefs?: string[];
  sessionId?: string;
  resumeToken?: string;
  failureReason?: string;
  failureCategory?: "TRANSIENT" | "TOOL_FAILURE" | "USER_INTERRUPT" | "SCOPE_VIOLATION" | "POLICY_BLOCK" | "UNKNOWN";
  retryReason?: string;
  resumeContextRef?: string;
  notes?: string[];
}

export interface ArtifactReadInput {
  productRoot: string;
  relativePath: string;
}

export interface ProductBootstrapInput {
  repoRoot: string;
  out: string;
  productId: string;
  productName: string;
  runtime?: "grace";
}

export interface ProductValidateInput {
  repoRoot: string;
  productRoot: string;
}

export interface LegacyBootstrapInput {
  repoRoot: string;
  productRoot: string;
  sourceRepoRoot: string;
  productId: string;
  productName?: string;
}

export interface LegacyValidateInput {
  repoRoot: string;
  productRoot: string;
}

export interface LegacyScanInput {
  repoRoot: string;
  productRoot: string;
}

export interface LegacyInferContractsInput {
  repoRoot: string;
  productRoot: string;
}

export interface LegacyTraceSeedInput {
  repoRoot: string;
  productRoot: string;
}

export interface LegacySliceProposeInput {
  repoRoot: string;
  productRoot: string;
}

export interface LegacyStartOnboardingInput {
  repoRoot: string;
  productRoot: string;
  productId?: string;
  threadId?: string;
}

export interface LegacyEditDryRunInput {
  repoRoot: string;
  productRoot: string;
  productId?: string;
  sliceId: string;
  requestedWritePaths: string[];
  writeModeAuthorized: boolean;
}

export interface ValidatorInput {
  repoRoot: string;
  productRoot: string;
}

export interface WorkflowValidateInput {
  repoRoot: string;
  productRoot: string;
  productId?: string;
}

export interface WorkflowTransitionEvent {
  schemaVersion: string;
  id: string;
  traceId: string;
  productId: string;
  transition: string;
  from: string;
  to: string;
  actor: string;
  createdAt: string;
  artifactRefs: string[];
  notes: string[];
}

interface InferredDeliveryTargets {
  executionsDir: string;
  handoffFile: string | null;
  cwoFile: string | null;
  envelopeFile: string | null;
  memoryFile: string | null;
  forcedContextFile: string | null;
  loopGuardFile: string | null;
}

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "out"]);

function frameworkRoot(repoRoot: string): string {
  return resolve(repoRoot);
}

function frameworkToolsOut(repoRoot: string): string {
  return resolve(frameworkRoot(repoRoot), "out", "tools");
}

function runNpm(repoRoot: string, args: string[]): void {
  if (process.platform === "win32") {
    execFileSync("cmd.exe", ["/d", "/s", "/c", `npm.cmd ${args.join(" ")}`], {
      cwd: repoRoot,
      stdio: "pipe",
      encoding: "utf8",
    });
    return;
  }

  execFileSync("npm", args, {
    cwd: repoRoot,
    stdio: "pipe",
    encoding: "utf8",
  });
}

function isProductWorkspace(dirPath: string): boolean {
  return existsSync(join(dirPath, "docs", "grace", "RequirementsAnalysis.xml"));
}

function readWorkflowStateFile(productRoot: string): { currentState: string | null; traceId: string | null; productId: string | null } {
  const stateFile = join(productRoot, "docs", "grace", "state", "WorkflowState.json");
  if (!existsSync(stateFile)) {
    return { currentState: null, traceId: null, productId: null };
  }
  const parsed = JSON.parse(readFileSync(stateFile, "utf8")) as Record<string, unknown>;
  return {
    currentState: typeof parsed.currentState === "string" ? parsed.currentState : null,
    traceId: typeof parsed.traceId === "string" ? parsed.traceId : null,
    productId: typeof parsed.productId === "string" ? parsed.productId : null,
  };
}

function walkProducts(rootDir: string, depth: number, found: ProductSummary[]): void {
  if (depth < 0) {
    return;
  }
  if (isProductWorkspace(rootDir)) {
    const state = readWorkflowStateFile(rootDir);
    found.push({
      productId: state.productId ?? basename(rootDir),
      productRoot: rootDir,
      hasWorkflowState: existsSync(join(rootDir, "docs", "grace", "state", "WorkflowState.json")),
      currentState: state.currentState,
      traceId: state.traceId,
    });
  }

  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) {
      continue;
    }
    walkProducts(join(rootDir, entry.name), depth - 1, found);
  }
}

export function listProducts(repoRoot: string): ProductSummary[] {
  const found: ProductSummary[] = [];
  walkProducts(resolve(repoRoot), 3, found);
  return found.sort((left, right) => left.productRoot.localeCompare(right.productRoot));
}

export function getWorkflowState(productRoot: string): Record<string, unknown> {
  const stateFile = join(resolve(productRoot), "docs", "grace", "state", "WorkflowState.json");
  return JSON.parse(readFileSync(stateFile, "utf8")) as Record<string, unknown>;
}

export function getWorkflowHistory(productRoot: string): WorkflowTransitionEvent[] {
  const logFile = join(resolve(productRoot), "docs", "grace", "state", "TransitionLog.jsonl");
  if (!existsSync(logFile)) {
    return [];
  }
  return readFileSync(logFile, "utf8")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as WorkflowTransitionEvent);
}

export function getWorkflowBlockers(productRoot: string): Record<string, unknown> {
  const state = getWorkflowState(productRoot);
  const reportsDir = join(resolve(productRoot), "docs", "grace", "reports");
  const issuesDir = join(reportsDir, "issues");
  const issueReports = existsSync(issuesDir)
    ? readdirSync(issuesDir).map((file) => join(issuesDir, file))
    : [];
  const livingDocReport = join(reportsDir, "living-doc-report.json");
  const liveReports = existsSync(livingDocReport)
    ? [JSON.parse(readFileSync(livingDocReport, "utf8")) as Record<string, unknown>]
    : [];

  return {
    blocked: Boolean(state.blocked),
    currentState: state.currentState ?? null,
    blockReasons: Array.isArray(state.blockReasons) ? state.blockReasons : [],
    issueReports,
    reports: liveReports,
  };
}

export function getWorkflowTrace(productRoot: string): Record<string, unknown> {
  const root = resolve(productRoot);
  const state = getWorkflowState(root);
  const history = getWorkflowHistory(root);
  const executionsDir = join(root, "docs", "grace", "executions");
  const reportsDir = join(root, "docs", "grace", "reports");
  const executionArtifacts = existsSync(executionsDir) ? readdirSync(executionsDir) : [];
  const reportArtifacts = existsSync(reportsDir)
    ? readdirSync(reportsDir).filter((name) => name !== "issues")
    : [];
  const artifactRefs = Array.from(
    new Set(history.flatMap((event) => event.artifactRefs)),
  ).sort((left, right) => left.localeCompare(right));

  return {
    state,
    historyCount: history.length,
    recentTransitions: history.slice(-10),
    artifactRefs,
    executionArtifacts,
    reportArtifacts,
  };
}

function safeProductFile(productRoot: string, relativePath: string): string {
  const root = resolve(productRoot);
  const target = resolve(root, relativePath);
  const rootWithSep = `${root}${root.endsWith("\\") || root.endsWith("/") ? "" : "\\"}`;
  if (target !== root && !target.startsWith(rootWithSep) && !target.startsWith(`${root}/`)) {
    throw new Error(`Path escapes product root: ${relativePath}`);
  }
  return target;
}

function relativeArtifactPath(productRoot: string, filePath: string): string {
  return relative(resolve(productRoot), resolve(filePath)).replaceAll("\\", "/");
}

function listFiles(dirPath: string, extensions?: string[]): string[] {
  if (!existsSync(dirPath)) {
    return [];
  }
  return readdirSync(dirPath)
    .map((entry) => join(dirPath, entry))
    .filter((filePath) => {
      if (!statSync(filePath).isFile()) {
        return false;
      }
      if (!extensions || extensions.length === 0) {
        return true;
      }
      return extensions.some((extension) => filePath.endsWith(extension));
    })
    .sort((left, right) => left.localeCompare(right));
}

function parseJsonMaybe(filePath: string): unknown | null {
  if (!existsSync(filePath)) {
    return null;
  }
  return JSON.parse(readFileSync(filePath, "utf8")) as unknown;
}

function inferLatestFile(dirPath: string, include: RegExp, exclude?: RegExp): string | null {
  const candidates = listFiles(dirPath, [".xml", ".json", ".md"])
    .filter((filePath) => include.test(basename(filePath)))
    .filter((filePath) => (exclude ? !exclude.test(basename(filePath)) : true));
  return candidates.at(-1) ?? null;
}

function inferDeliveryTargets(productRoot: string): InferredDeliveryTargets {
  const root = resolve(productRoot);
  const state = getWorkflowState(root);
  const reportsDir = join(root, "docs", "grace", "reports");
  const handoffsDir = join(root, "docs", "grace", "handoffs");
  const cwoDir = join(root, "docs", "grace", "cwo");

  const stateHandoff = typeof state.activeHandoffRef === "string" ? safeProductFile(root, state.activeHandoffRef) : null;
  const stateCwo = typeof state.activeCwoRef === "string" ? safeProductFile(root, state.activeCwoRef) : null;

  return {
    executionsDir: join(root, "docs", "grace", "executions"),
    handoffFile: stateHandoff && existsSync(stateHandoff) ? stateHandoff : inferLatestFile(handoffsDir, /^Handoff-.*\.xml$/u),
    cwoFile: stateCwo && existsSync(stateCwo) ? stateCwo : inferLatestFile(cwoDir, /^CWO-.*\.xml$/u),
    envelopeFile: inferLatestFile(reportsDir, /envelope.*\.json$/iu),
    memoryFile: existsSync(join(reportsDir, "failure-memory.json")) ? join(reportsDir, "failure-memory.json") : inferLatestFile(reportsDir, /failure-memory.*\.json$/iu),
    forcedContextFile: existsSync(join(reportsDir, "forced-context.json")) ? join(reportsDir, "forced-context.json") : inferLatestFile(reportsDir, /forced-context.*\.json$/iu),
    loopGuardFile: existsSync(join(reportsDir, "loop-guard.json")) ? join(reportsDir, "loop-guard.json") : inferLatestFile(reportsDir, /loop-guard.*\.json$/iu),
  };
}

export function readProductArtifact(input: ArtifactReadInput): Record<string, unknown> {
  const productRoot = resolve(input.productRoot);
  const filePath = safeProductFile(productRoot, input.relativePath);
  const content = readFileSync(filePath, "utf8");
  const stat = statSync(filePath);
  return {
    relativePath: relative(productRoot, filePath).replaceAll("\\", "/"),
    filePath,
    size: stat.size,
    content,
  };
}

export function getAutonomyStatus(productRoot: string): Record<string, unknown> {
  const root = resolve(productRoot);
  const targets = inferDeliveryTargets(root);

  const failureMemory = targets.memoryFile ? parseJsonMaybe(targets.memoryFile) : null;
  const forcedContext = targets.forcedContextFile ? parseJsonMaybe(targets.forcedContextFile) : null;
  const loopGuard = targets.loopGuardFile ? parseJsonMaybe(targets.loopGuardFile) : null;

  return {
    hasFailureMemory: failureMemory !== null,
    hasForcedContext: forcedContext !== null,
    hasLoopGuard: loopGuard !== null,
    failureMemory,
    forcedContext,
    loopGuard,
    artifactRefs: {
      failureMemory: targets.memoryFile ? relativeArtifactPath(root, targets.memoryFile) : null,
      forcedContext: targets.forcedContextFile ? relativeArtifactPath(root, targets.forcedContextFile) : null,
      loopGuard: targets.loopGuardFile ? relativeArtifactPath(root, targets.loopGuardFile) : null,
    },
  };
}

export function getProcessArtifacts(productRoot: string): Record<string, unknown> {
  const root = resolve(productRoot);
  const handoffsDir = join(root, "docs", "grace", "handoffs");
  const cwoDir = join(root, "docs", "grace", "cwo");
  const approvalsLog = join(root, "docs", "grace", "approvals.log");

  const handoffs = listFiles(handoffsDir, [".xml"])
    .filter((filePath) => /^Handoff-.*\.xml$/u.test(basename(filePath)))
    .map((filePath) => relativeArtifactPath(root, filePath));
  const workOrders = listFiles(cwoDir, [".xml"])
    .filter((filePath) => /^CWO-.*\.xml$/u.test(basename(filePath)))
    .map((filePath) => relativeArtifactPath(root, filePath));
  const branchSpecs = listFiles(cwoDir, [".xml"])
    .filter((filePath) => /^BS-.*\.xml$/u.test(basename(filePath)))
    .map((filePath) => relativeArtifactPath(root, filePath));

  return {
    handoffs,
    workOrders,
    branchSpecs,
    approvalsLog: existsSync(approvalsLog) ? relativeArtifactPath(root, approvalsLog) : null,
  };
}

export function getLegacyOverlayMetadata(productRoot: string): Record<string, unknown> {
  const root = resolve(productRoot);
  const legacyWorkspaceFile = join(root, "docs", "grace", "LegacyWorkspace.json");
  const sourceRepoMapFile = join(root, "docs", "grace", "SourceRepoMap.json");

  return {
    hasLegacyWorkspace: existsSync(legacyWorkspaceFile),
    hasSourceRepoMap: existsSync(sourceRepoMapFile),
    legacyWorkspaceRef: existsSync(legacyWorkspaceFile) ? relativeArtifactPath(root, legacyWorkspaceFile) : null,
    sourceRepoMapRef: existsSync(sourceRepoMapFile) ? relativeArtifactPath(root, sourceRepoMapFile) : null,
    legacyWorkspace: existsSync(legacyWorkspaceFile)
      ? JSON.parse(readFileSync(legacyWorkspaceFile, "utf8"))
      : null,
    sourceRepoMap: existsSync(sourceRepoMapFile)
      ? JSON.parse(readFileSync(sourceRepoMapFile, "utf8"))
      : null,
  };
}

function loadLegacyTarget(repoRoot: string, productRoot: string): {
  repoRoot: string;
  productRoot: string;
  productId: string;
  traceId: string;
  sourceRepoRoot: string;
} {
  const root = resolve(productRoot);
  const state = getWorkflowState(root);
  const metadata = getLegacyOverlayMetadata(root) as {
    legacyWorkspace: { sourceRepoRoot?: string; productId?: string; traceId?: string } | null;
  };
  const sourceRepoRoot = metadata.legacyWorkspace?.sourceRepoRoot;
  if (typeof sourceRepoRoot !== "string" || sourceRepoRoot.length === 0) {
    throw new Error(`Product is not a legacy overlay workspace: ${root}`);
  }
  return {
    repoRoot: resolve(repoRoot),
    productRoot: root,
    productId:
      typeof metadata.legacyWorkspace?.productId === "string"
        ? metadata.legacyWorkspace.productId
        : basename(root),
    traceId:
      typeof state.traceId === "string"
        ? state.traceId
        : typeof metadata.legacyWorkspace?.traceId === "string"
          ? metadata.legacyWorkspace.traceId
          : `TRACE-${basename(root).toUpperCase()}-CORE`,
    sourceRepoRoot: resolve(sourceRepoRoot),
  };
}

export function getAgentTrace(productRoot: string): Record<string, unknown> {
  const root = resolve(productRoot);
  const executionsDir = join(root, "docs", "grace", "executions");
  const files = listFiles(executionsDir);
  const group = (role: string, suffix: string) =>
    files
      .filter((filePath) => basename(filePath).startsWith(role) && basename(filePath).includes(suffix))
      .map((filePath) => relativeArtifactPath(root, filePath));

  return {
    architect: {
      taskPackets: group("Architect", "TaskPacket"),
      invocations: group("Architect", "Invocation"),
      executions: group("Architect", "Execution"),
      skillTraces: group("Architect", "SkillTrace"),
    },
    coordinator: {
      taskPackets: group("Coordinator", "TaskPacket"),
      invocations: group("Coordinator", "Invocation"),
      executions: group("Coordinator", "Execution"),
      skillTraces: group("Coordinator", "SkillTrace"),
    },
    coder: {
      taskPackets: group("Coder", "TaskPacket"),
      invocations: group("Coder", "Invocation"),
      executions: group("Coder", "Execution"),
      skillTraces: group("Coder", "SkillTrace"),
    },
  };
}

function ensureGraceBuilt(repoRoot: string): void {
  if (
    !existsSync(resolve(frameworkRoot(repoRoot), "dist", "cli", "run-workflow.js")) ||
    !existsSync(resolve(frameworkRoot(repoRoot), "dist", "cli", "bootstrap-legacy-overlay.js"))
  ) {
    runNpm(frameworkRoot(repoRoot), ["run", "build"]);
  }
}

function runScriptJson(repoRoot: string, scriptName: string, args: string[]): Record<string, unknown> {
  ensureFrameworkToolsBuilt(repoRoot);
  try {
    const output = execFileSync(
      process.execPath,
      [resolve(frameworkToolsOut(repoRoot), scriptName), ...args, "--json"],
      {
        cwd: repoRoot,
        stdio: "pipe",
        encoding: "utf8",
      },
    );
    return JSON.parse(output) as Record<string, unknown>;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "stdout" in error &&
      typeof (error as { stdout?: unknown }).stdout === "string"
    ) {
      return JSON.parse((error as { stdout: string }).stdout) as Record<string, unknown>;
    }
    throw error;
  }
}

function ensureFrameworkToolsBuilt(repoRoot: string): void {
  const required = [
    resolve(frameworkToolsOut(repoRoot), "grace-init.js"),
    resolve(frameworkToolsOut(repoRoot), "grace-validate.js"),
  ];
  if (required.every((filePath) => existsSync(filePath))) {
    return;
  }
  runNpm(frameworkRoot(repoRoot), ["run", "build:tools"]);
}

function defaultThreadId(productId: string): string {
  return `grace-mcp-${productId}`;
}

function runWorkflowCli(mode: "start" | "resume", input: WorkflowActionInput | ResumeWorkflowInput): Record<string, unknown> {
  const repoRoot = resolve(input.repoRoot);
  const productRoot = resolve(input.productRoot);
  const productId = input.productId ?? basename(productRoot);
  const outFile = join(productRoot, "docs", "grace", "reports", `mcp-workflow-${mode}.json`);

  ensureGraceBuilt(repoRoot);

  const args = [
    resolve(frameworkRoot(repoRoot), "dist", "cli", "run-workflow.js"),
    mode,
    "--repo-root",
    repoRoot,
    "--product-root",
    productRoot,
    "--product-id",
    productId,
    "--thread-id",
    input.threadId ?? defaultThreadId(productId),
    "--verification-mode",
    input.verificationMode ?? "pass",
    "--out",
    outFile,
  ];

  if (mode === "resume") {
    args.push("--approval-decision", (input as ResumeWorkflowInput).approvalDecision);
  }
  if (input.sourceRepoRoot) {
    args.push("--source-repo-root", resolve(input.sourceRepoRoot));
  }

  execFileSync(process.execPath, args, {
    cwd: frameworkRoot(repoRoot),
    stdio: "pipe",
    encoding: "utf8",
  });

  return JSON.parse(readFileSync(outFile, "utf8")) as Record<string, unknown>;
}

export function startWorkflow(input: WorkflowActionInput): Record<string, unknown> {
  return runWorkflowCli("start", input);
}

export function resumeWorkflow(input: ResumeWorkflowInput): Record<string, unknown> {
  return runWorkflowCli("resume", input);
}

export function approveWorkflow(input: WorkflowActionInput): Record<string, unknown> {
  return resumeWorkflow({ ...input, approvalDecision: "approve" });
}

export function rejectWorkflow(input: WorkflowActionInput): Record<string, unknown> {
  return resumeWorkflow({ ...input, approvalDecision: "reject" });
}

async function importGraceModule<T>(repoRoot: string, relativePath: string): Promise<T> {
  const moduleUrl = pathToFileURL(resolve(frameworkRoot(repoRoot), "dist", relativePath)).href;
  return (await import(moduleUrl)) as T;
}

export async function validateAgentEvidence(input: AgentEvidenceInput): Promise<Record<string, unknown>> {
  const repoRoot = resolve(input.repoRoot);
  const productRoot = resolve(input.productRoot);
  const state = getWorkflowState(productRoot);
  const traceId = typeof state.traceId === "string" ? state.traceId : `TRACE-${basename(productRoot).toUpperCase()}-CORE`;

  const module = await importGraceModule<{
    validateAgentEvidence: (args: {
      repoRoot: string;
      productId: string;
      traceId: string;
      executionDir: string;
      requiredRoles: Array<"ARCHITECT" | "COORDINATOR" | "CODER">;
    }) => { ok: boolean; failures: unknown[]; artifactRefs: string[] };
  }>(repoRoot, "validators/agent-evidence.js");

  return module.validateAgentEvidence({
    repoRoot,
    productId: input.productId ?? basename(productRoot),
    traceId,
    executionDir: join(productRoot, "docs", "grace", "executions"),
    requiredRoles: ["ARCHITECT", "COORDINATOR", "CODER"],
  });
}

export async function validateAgentRuns(input: AgentEvidenceInput): Promise<Record<string, unknown>> {
  const repoRoot = resolve(input.repoRoot);
  const productRoot = resolve(input.productRoot);
  const state = getWorkflowState(productRoot);
  const traceId = typeof state.traceId === "string" ? state.traceId : `TRACE-${basename(productRoot).toUpperCase()}-CORE`;

  const module = await importGraceModule<{
    validateAgentRunEvidence: (args: {
      repoRoot: string;
      productId: string;
      traceId: string;
      executionDir: string;
      requiredRoles: Array<"ARCHITECT" | "COORDINATOR" | "CODER">;
    }) => { ok: boolean; failures: unknown[]; artifactRefs: string[] };
  }>(repoRoot, "validators/agent-run-evidence.js");

  return module.validateAgentRunEvidence({
    repoRoot,
    productId: input.productId ?? basename(productRoot),
    traceId,
    executionDir: join(productRoot, "docs", "grace", "executions"),
    requiredRoles: ["ARCHITECT", "COORDINATOR", "CODER"],
  });
}

export async function validateWorkflow(input: WorkflowValidateInput): Promise<Record<string, unknown>> {
  const productRoot = resolve(input.productRoot);
  const state = getWorkflowState(productRoot);
  const blockers = getWorkflowBlockers(productRoot);
  const trace = getWorkflowTrace(productRoot);
  const agentEvidence = await validateAgentEvidence({
    repoRoot: input.repoRoot,
    productRoot,
    productId: input.productId,
  });
  const agentRuns = await validateAgentRuns({
    repoRoot: input.repoRoot,
    productRoot,
    productId: input.productId,
  });

  const ok =
    (blockers.blocked === false || blockers.blocked === undefined) &&
    Array.isArray(blockers.blockReasons) &&
    blockers.blockReasons.length === 0 &&
    agentEvidence.ok === true;

  return {
    ok,
    state,
    blockers,
    trace,
    agentEvidence,
    agentRuns,
  };
}

export function getAgentRuns(productRoot: string): Record<string, unknown> {
  const root = resolve(productRoot);
  const executionsDir = join(root, "docs", "grace", "executions");
  const files = listFiles(executionsDir);
  const stateSummaries = (role: string) =>
    files
      .filter((filePath) => basename(filePath).startsWith(role) && basename(filePath).includes("RunState"))
      .map((filePath) => {
        const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
        return {
          file: relativeArtifactPath(root, filePath),
          runId: parsed.runId ?? null,
          currentStatus: parsed.currentStatus ?? null,
          nextAction: parsed.nextAction ?? null,
          retryCount: parsed.retryCount ?? null,
          retryBudget: parsed.retryBudget ?? null,
          failureCategory: parsed.failureCategory ?? null,
          resumeContextRef: parsed.resumeContextRef ?? null,
          sessionId: parsed.sessionId ?? null,
          resumeToken: parsed.resumeToken ?? null,
        };
      });
  const group = (role: string, suffix: string) =>
    files
      .filter((filePath) => basename(filePath).startsWith(role) && basename(filePath).includes(suffix))
      .map((filePath) => relativeArtifactPath(root, filePath));

  return {
    architect: {
      states: group("Architect", "RunState"),
      logs: group("Architect", "RunLog"),
      summaries: stateSummaries("Architect"),
    },
    coordinator: {
      states: group("Coordinator", "RunState"),
      logs: group("Coordinator", "RunLog"),
      summaries: stateSummaries("Coordinator"),
    },
    coder: {
      states: group("Coder", "RunState"),
      logs: group("Coder", "RunLog"),
      summaries: stateSummaries("Coder"),
    },
  };
}

export async function resumeAgentRun(input: AgentRunResumeInput): Promise<Record<string, unknown>> {
  const module = await importGraceModule<{
    updateAgentRun: (args: {
      stateFile: string;
      logFile: string;
      status: "ACTIVE" | "SUCCEEDED" | "FAILED" | "BLOCKED";
      outputRefs?: string[];
      sessionId?: string | null;
      resumeToken?: string | null;
      failureReason?: string | null;
      failureCategory?: "TRANSIENT" | "TOOL_FAILURE" | "USER_INTERRUPT" | "SCOPE_VIOLATION" | "POLICY_BLOCK" | "UNKNOWN" | null;
      retryReason?: string | null;
      resumeContextRef?: string | null;
      notes?: string[];
    }) => unknown;
  }>(input.repoRoot, "agents/agent-run.js");

  return module.updateAgentRun({
    stateFile: input.stateFile,
    logFile: input.logFile,
    status: input.status,
    outputRefs: input.outputRefs,
    sessionId: input.sessionId ?? null,
    resumeToken: input.resumeToken ?? null,
    failureReason: input.failureReason ?? null,
    failureCategory: input.failureCategory ?? null,
    retryReason: input.retryReason ?? null,
    resumeContextRef: input.resumeContextRef ?? null,
    notes: input.notes,
  }) as Record<string, unknown>;
}

export function bootstrapProduct(input: ProductBootstrapInput): Record<string, unknown> {
  const repoRoot = resolve(input.repoRoot);
  ensureFrameworkToolsBuilt(repoRoot);

  const args = [
    resolve(frameworkToolsOut(repoRoot), "grace-init.js"),
    "--out",
    input.out,
    "--product-id",
    input.productId,
    "--product-name",
    input.productName,
    "--runtime",
    input.runtime ?? "grace",
  ];

  const output = execFileSync(process.execPath, args, {
    cwd: repoRoot,
    stdio: "pipe",
    encoding: "utf8",
  }).trim();

  const productRoot = resolve(repoRoot, input.out, input.productId);
  const validation = validateProductWorkspace({ repoRoot, productRoot });

  return {
    ok: validation.valid === true,
    output,
    productRoot,
    validation,
  };
}

export function bootstrapLegacyOverlay(input: LegacyBootstrapInput): Record<string, unknown> {
  const repoRoot = resolve(input.repoRoot);
  const productRoot = resolve(input.productRoot);
  const sourceRepoRoot = resolve(input.sourceRepoRoot);
  ensureGraceBuilt(repoRoot);

  const output = execFileSync(
    process.execPath,
    [
      resolve(repoRoot, "dist", "cli", "bootstrap-legacy-overlay.js"),
      "--repo-root",
      repoRoot,
      "--product-root",
      productRoot,
      "--source-repo-root",
      sourceRepoRoot,
      "--product-id",
      input.productId,
      "--product-name",
      input.productName ?? `${input.productId} Legacy Overlay`,
      "--json",
    ],
    {
      cwd: repoRoot,
      stdio: "pipe",
      encoding: "utf8",
    },
  );

  const bootstrap = JSON.parse(output) as Record<string, unknown>;
  const validation = validateLegacyOverlay({ repoRoot, productRoot });
  return {
    ok: validation.valid === true,
    bootstrap,
    productRoot,
    sourceRepoRoot,
    validation,
  };
}

export function bootstrapAndStartProductWorkflow(input: ProductBootstrapInput & {
  threadId?: string;
  verificationMode?: "pass" | "fail";
}): Record<string, unknown> {
  const bootstrap = bootstrapProduct(input);
  const start = startWorkflow({
    repoRoot: input.repoRoot,
    productRoot: String(bootstrap.productRoot),
    productId: input.productId,
    threadId: input.threadId,
    verificationMode: input.verificationMode,
  });

  return {
    ok: bootstrap.ok === true,
    bootstrap,
    start,
  };
}

export function validateProductWorkspace(input: ProductValidateInput): Record<string, unknown> {
  const repoRoot = resolve(input.repoRoot);
  const productRoot = resolve(input.productRoot);
  ensureFrameworkToolsBuilt(repoRoot);

  const output = execFileSync(
    process.execPath,
    [
      resolve(repoRoot, "out", "tools", "grace-validate.js"),
      "--mode",
      "product",
      "--root",
      productRoot,
      "--json",
    ],
    {
      cwd: repoRoot,
      stdio: "pipe",
      encoding: "utf8",
    },
  );

  return JSON.parse(output) as Record<string, unknown>;
}

export function validateLegacyOverlay(input: LegacyValidateInput): Record<string, unknown> {
  const productRoot = resolve(input.productRoot);
  const validation = validateProductWorkspace(input);
  const legacyWorkspaceFile = join(productRoot, "docs", "grace", "LegacyWorkspace.json");
  const sourceRepoMapFile = join(productRoot, "docs", "grace", "SourceRepoMap.json");

  return {
    ...validation,
    legacyOverlay: {
      hasLegacyWorkspace: existsSync(legacyWorkspaceFile),
      hasSourceRepoMap: existsSync(sourceRepoMapFile),
      legacyWorkspace: existsSync(legacyWorkspaceFile)
        ? JSON.parse(readFileSync(legacyWorkspaceFile, "utf8"))
        : null,
      sourceRepoMap: existsSync(sourceRepoMapFile)
        ? JSON.parse(readFileSync(sourceRepoMapFile, "utf8"))
        : null,
    },
  };
}

export async function scanLegacyOverlay(input: LegacyScanInput): Promise<Record<string, unknown>> {
  const target = loadLegacyTarget(input.repoRoot, input.productRoot);
  const module = await importGraceModule<{
    scanLegacyRepository: (args: {
      target: {
        repoRoot: string;
        productRoot: string;
        productId: string;
        traceId: string;
        mode: "legacy-overlay";
        sourceRepoRoot: string;
      };
    }) => { scanReportFile: string; riskReportFile: string; scan: unknown; risk: unknown };
  }>(input.repoRoot, "legacy/scan.js");
  return module.scanLegacyRepository({
    target: { ...target, mode: "legacy-overlay" },
  }) as unknown as Record<string, unknown>;
}

export async function inferLegacyContractsFromOverlay(input: LegacyInferContractsInput): Promise<Record<string, unknown>> {
  const target = loadLegacyTarget(input.repoRoot, input.productRoot);
  const module = await importGraceModule<{
    inferLegacyContracts: (args: {
      target: {
        repoRoot: string;
        productRoot: string;
        productId: string;
        traceId: string;
        mode: "legacy-overlay";
        sourceRepoRoot: string;
      };
    }) => { draftsFile: string; drafts: unknown };
  }>(input.repoRoot, "legacy/infer-contracts.js");
  return module.inferLegacyContracts({
    target: { ...target, mode: "legacy-overlay" },
  }) as unknown as Record<string, unknown>;
}

export async function seedLegacyTraceFromOverlay(input: LegacyTraceSeedInput): Promise<Record<string, unknown>> {
  const target = loadLegacyTarget(input.repoRoot, input.productRoot);
  const module = await importGraceModule<{
    seedLegacyTraceability: (args: {
      target: {
        repoRoot: string;
        productRoot: string;
        productId: string;
        traceId: string;
        mode: "legacy-overlay";
        sourceRepoRoot: string;
      };
    }) => { registryFile: string; registry: unknown };
  }>(input.repoRoot, "legacy/trace-seed.js");
  return module.seedLegacyTraceability({
    target: { ...target, mode: "legacy-overlay" },
  }) as unknown as Record<string, unknown>;
}

export async function proposeLegacySlicesFromOverlay(input: LegacySliceProposeInput): Promise<Record<string, unknown>> {
  const target = loadLegacyTarget(input.repoRoot, input.productRoot);
  const module = await importGraceModule<{
    proposeLegacySlice: (args: {
      target: {
        repoRoot: string;
        productRoot: string;
        productId: string;
        traceId: string;
        mode: "legacy-overlay";
        sourceRepoRoot: string;
      };
    }) => { planFile: string; plan: unknown };
  }>(input.repoRoot, "legacy/slice-propose.js");
  return module.proposeLegacySlice({
    target: { ...target, mode: "legacy-overlay" },
  }) as unknown as Record<string, unknown>;
}

export function startLegacyOnboarding(input: LegacyStartOnboardingInput): Record<string, unknown> {
  const target = loadLegacyTarget(input.repoRoot, input.productRoot);
  return startWorkflow({
    repoRoot: target.repoRoot,
    productRoot: target.productRoot,
    sourceRepoRoot: target.sourceRepoRoot,
    productId: input.productId ?? target.productId,
    threadId: input.threadId,
    verificationMode: "pass",
  });
}

export async function dryRunLegacyEdit(input: LegacyEditDryRunInput): Promise<Record<string, unknown>> {
  const target = loadLegacyTarget(input.repoRoot, input.productRoot);
  const module = await importGraceModule<{
    proposeLegacyDryRunEdit: (args: {
      target: {
        repoRoot: string;
        productRoot: string;
        productId: string;
        traceId: string;
        mode: "legacy-overlay";
        sourceRepoRoot: string;
      };
      sliceId: string;
      requestedWritePaths: string[];
      writeModeAuthorized: boolean;
    }) => { dryRunFile: string; dryRun: unknown };
  }>(input.repoRoot, "legacy/slice-propose.js");
  return module.proposeLegacyDryRunEdit({
    target: { ...target, mode: "legacy-overlay" },
    sliceId: input.sliceId,
    requestedWritePaths: input.requestedWritePaths,
    writeModeAuthorized: input.writeModeAuthorized,
  }) as unknown as Record<string, unknown>;
}

export function validateExecutionProof(input: ValidatorInput): Record<string, unknown> {
  const repoRoot = resolve(input.repoRoot);
  const productRoot = resolve(input.productRoot);
  return runScriptJson(repoRoot, "grace-execution-proof.js", [
    "--dir",
    join(productRoot, "docs", "grace", "executions"),
  ]);
}

export function validateDeliveryTrace(input: ValidatorInput): Record<string, unknown> {
  const repoRoot = resolve(input.repoRoot);
  const productRoot = resolve(input.productRoot);
  const targets = inferDeliveryTargets(productRoot);
  const missingTargets = Object.entries(targets)
    .filter(([key, value]) => key !== "executionsDir" && !value)
    .map(([key]) => key);

  if (missingTargets.length > 0) {
    return {
      valid: false,
      checks: 0,
      issues: missingTargets.map((key) => ({
        code: "MISSING_DELIVERY_TRACE_TARGET",
        file: key,
        detail: `Could not infer ${key} for delivery-trace validation.`,
      })),
      traceId: "TRACE-MISSING",
    };
  }

  return runScriptJson(repoRoot, "grace-delivery-trace.js", [
    "--root",
    productRoot,
    "--executions",
    targets.executionsDir,
    "--handoff",
    targets.handoffFile as string,
    "--cwo",
    targets.cwoFile as string,
    "--envelope",
    targets.envelopeFile as string,
    "--memory",
    targets.memoryFile as string,
    "--context",
    targets.forcedContextFile as string,
    "--guard",
    targets.loopGuardFile as string,
  ]);
}

export function makeTempProductCopy(repoRoot: string, sourceRelativePath: string): string {
  const sourceDir = resolve(repoRoot, sourceRelativePath);
  const tempDir = mkdtempSync(join(tmpdir(), "grace-mcp-product-"));
  const productCopy = join(tempDir, basename(sourceDir));
  cpSync(sourceDir, productCopy, { recursive: true });
  return productCopy;
}
