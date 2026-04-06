import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { toRepoArtifactRef } from "../runtime/product-target.js";
import type {
  AgentEvidenceFailure,
  AgentEvidenceValidationInput,
  AgentEvidenceValidationResult,
} from "./index.js";

/**
 * <!-- MODULE_MAP id="MM-grace-validators" -->
 * <Layers>
 *   <Layer name="domain" package="src/validators/index.ts">
 *     Deterministic validator contracts for workflow, swarm evidence, and governance artifacts.
 *   </Layer>
 *   <Layer name="application" package="src/validators/agent-evidence.ts">
 *     Verifies that every required swarm role emitted the full packet, invocation, execution, and skill-trace set.
 *   </Layer>
 * </Layers>
 * <Links>
 *   <Link ref="RequirementsAnalysis.xml#NFR-GRACE-AUDITABILITY" />
 *   <Link ref="DevelopmentPlan.xml#DP-SVC-grace-validators" />
 * </Links>
 * <!-- /MODULE_MAP -->
 */

/**
 * <MODULE_CONTRACT id="MC-grace-validators">
 *   <Purpose>Validate governed swarm evidence so workflow promotion depends on a complete auditable role trail.</Purpose>
 *   <Links>
 *     <Link ref="RequirementsAnalysis.xml#NFR-GRACE-AUDITABILITY" />
 *     <Link ref="RequirementsAnalysis.xml#UC-GRACE-TRACEABILITY" />
 *   </Links>
 * </MODULE_CONTRACT>
 */

const ROLE_FILE_PREFIX: Record<AgentEvidenceValidationInput["requiredRoles"][number], string> = {
  ARCHITECT: "Architect",
  COORDINATOR: "Coordinator",
  CODER: "Coder",
};

function buildFailure(code: AgentEvidenceFailure["code"], message: string): AgentEvidenceFailure {
  return { code, message };
}

function validateFile(filePath: string, expectedSnippet: string): AgentEvidenceFailure | null {
  if (!existsSync(filePath)) {
    return buildFailure("AGENT_ARTIFACT_MISSING", `Missing required agent artifact: ${filePath}`);
  }
  const content = readFileSync(filePath, "utf8");
  if (!content.includes(expectedSnippet)) {
    return buildFailure("AGENT_ARTIFACT_INVALID", `Agent artifact ${filePath} does not contain expected marker ${expectedSnippet}.`);
  }
  return null;
}

/**
 * <FUNCTION_CONTRACT id="FC-grace-validators-validateAgentEvidence">
 *   <Intent>Fail the workflow when any required swarm role is missing TaskPacket, Invocation, Execution, or SkillTrace evidence.</Intent>
 * </FUNCTION_CONTRACT>
 */
export function validateAgentEvidence(input: AgentEvidenceValidationInput): AgentEvidenceValidationResult {
  const executionDir = resolve(input.executionDir);
  const failures: AgentEvidenceFailure[] = [];
  const artifactRefs: string[] = [];

  for (const role of input.requiredRoles) {
    const prefix = ROLE_FILE_PREFIX[role];
    const taskPacketFile = join(executionDir, `${prefix}TaskPacket-Workflow-0001.json`);
    const invocationFile = join(executionDir, `${prefix}Invocation-Workflow-0001.json`);
    const executionFile = join(executionDir, `${prefix}Execution-Workflow-0001.xml`);
    const skillTraceFile = join(executionDir, `${prefix}SkillTrace-Workflow-0001.json`);

    const checks: Array<[string, string]> = [
      [taskPacketFile, "grace-agent-task-packet-v1"],
      [invocationFile, "grace-agent-invocation-v1"],
      [executionFile, `${prefix}Execution`],
      [skillTraceFile, "grace-skill-trace-v1"],
    ];

    for (const [filePath, expectedSnippet] of checks) {
      const failure = validateFile(filePath, expectedSnippet);
      if (failure !== null) {
        failures.push(failure);
      } else {
        artifactRefs.push(toRepoArtifactRef(input.repoRoot, filePath));
      }
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    artifactRefs,
  };
}
