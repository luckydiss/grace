/**
 * <!-- MODULE_MAP id="MM-grace-v1-adapters" -->
 * <Layers>
 *   <Layer name="application" package="src/adapters/legacy-validator.ts">
 *     Bounded adapter surface that invokes legacy v1 validators and emits deterministic reports under v2 control.
 *   </Layer>
 * </Layers>
 * <Links>
 *   <Link ref="RequirementsAnalysis.xml#UC-GRACE-ADAPTER-COMPATIBILITY" />
 *   <Link ref="DevelopmentPlan.xml#DP-SVC-grace-v1-adapters" />
 * </Links>
 * <!-- /MODULE_MAP -->
 */

/**
 * <MODULE_CONTRACT id="MC-grace-v1-adapters">
 *   <Purpose>Provide bounded compatibility adapters for mature v1 GRACE validators during v2 migration.</Purpose>
 *   <Responsibilities>
 *     <Item>Define typed adapter inputs and outputs.</Item>
 *     <Item>Constrain legacy command execution to explicit commands and files.</Item>
 *     <Item>Persist deterministic adapter reports for audit and later workflow integration.</Item>
 *   </Responsibilities>
 *   <Links>
 *     <Link ref="RequirementsAnalysis.xml#UC-GRACE-ADAPTER-COMPATIBILITY" />
 *     <Link ref="RequirementsAnalysis.xml#NFR-GRACE-COMPATIBILITY" />
 *   </Links>
 * </MODULE_CONTRACT>
 */

export interface LegacyValidatorCommandSpec {
  command: string;
  args: string[];
  cwd?: string;
}

export type LegacyVerificationToolName =
  | "grace-validate-product"
  | "grace-execution-proof"
  | "grace-delivery-trace"
  | "grace-traceability-coverage";

export interface LegacyVerificationTarget {
  repoRoot: string;
  productRoot: string;
  executionsDir?: string;
  sourceDir?: string;
  runtimeLogFile?: string;
  handoffFile?: string;
  cwoFile?: string;
  envelopeFile?: string;
  memoryFile?: string;
  forcedContextFile?: string;
  loopGuardFile?: string;
}

export interface LegacyValidatorInput {
  productId: string;
  traceId: string;
  adapterId: string;
  toolName: string;
  command: LegacyValidatorCommandSpec;
  allowedCommands: string[];
  reportFile: string;
  reportRef: string;
  now?: string;
}

export type LegacyValidatorFailureCode =
  | "COMMAND_NOT_ALLOWED"
  | "COMMAND_FAILED"
  | "NAMED_TOOL_INPUT_MISSING"
  | "NAMED_TOOL_UNKNOWN";

export interface LegacyValidatorFailure {
  code: LegacyValidatorFailureCode;
  message: string;
}

export interface LegacyValidatorReport {
  schemaVersion: "grace-legacy-validator-report-v1";
  productId: string;
  traceId: string;
  adapterId: string;
  toolName: string;
  executedAt: string;
  ok: boolean;
  exitCode: number;
  command: {
    command: string;
    args: string[];
    cwd: string | null;
  };
  stdout: string;
  stderr: string;
  failures: LegacyValidatorFailure[];
}

export interface LegacyValidatorResult {
  ok: boolean;
  artifactRef: string;
  reportFile: string;
  report: LegacyValidatorReport;
  failures: LegacyValidatorFailure[];
}

export interface NamedLegacyVerificationAdapterInput {
  productId: string;
  traceId: string;
  adapterId: string;
  toolName: LegacyVerificationToolName;
  target: LegacyVerificationTarget;
  reportFile: string;
  reportRef: string;
  now?: string;
}

export interface Text2SqlCompatibilityPilotInput {
  productId: string;
  traceId: string;
  adapterId: string;
  repoRoot: string;
  targetProductRoot: string;
  reportFile: string;
  reportRef: string;
  markdownReportFile: string;
  markdownReportRef: string;
  now?: string;
}

export interface Text2SqlCompatibilityPilotCheck {
  toolName: LegacyVerificationToolName;
  ok: boolean;
  exitCode: number;
  artifactRef: string;
  failureCodes: LegacyValidatorFailureCode[];
}

export interface Text2SqlCompatibilityPilotReport {
  schemaVersion: "grace-text2sql-compatibility-report-v1";
  productId: string;
  traceId: string;
  adapterId: string;
  targetProductId: "text2sql";
  executedAt: string;
  targetProductRoot: string;
  v1EvidenceRefs: string[];
  checks: Text2SqlCompatibilityPilotCheck[];
  summary: {
    supportedChecks: number;
    blockedChecks: number;
    verificationStatusAligned: boolean;
    traceabilityStatusAligned: boolean;
  };
}
