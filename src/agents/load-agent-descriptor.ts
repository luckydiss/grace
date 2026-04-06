import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { toRepoArtifactRef } from "../runtime/product-target.js";
import type { AgentDescriptor, AgentRoleName, LoadAgentDescriptorInput } from "./index.js";

/**
 * <!-- MODULE_MAP id="MM-grace-agent-descriptors" -->
 * <Layers>
 *   <Layer name="domain" package="src/agents/index.ts">
 *     Contracts for role descriptors loaded from canonical GRACE agent specs.
 *   </Layer>
 *   <Layer name="application" package="src/agents/load-agent-descriptor.ts">
 *     Resolves architect, coordinator, and coder descriptors from repository-owned SYSTEM.md and skills folders.
 *   </Layer>
 * </Layers>
 * <Links>
 *   <Link ref="RequirementsAnalysis.xml#UC-GRACE-BOUNDED-EXECUTION" />
 *   <Link ref="DevelopmentPlan.xml#DP-SVC-grace-executor-runtime" />
 * </Links>
 * <!-- /MODULE_MAP -->
 */

/**
 * <MODULE_CONTRACT id="MC-grace-agent-descriptors">
 *   <Purpose>Load canonical role descriptions and mandatory skills from the repository so workflow agents are assembled from durable specs rather than inline prompt fragments.</Purpose>
 *   <Links>
 *     <Link ref="RequirementsAnalysis.xml#UC-GRACE-BOUNDED-EXECUTION" />
 *   </Links>
 * </MODULE_CONTRACT>
 */

const ROLE_TO_ACTOR: Record<AgentRoleName, AgentDescriptor["actorRole"]> = {
  architect: "ARCHITECT",
  coordinator: "COORDINATOR",
  coder: "CODER",
};

const V2_AGENTS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "agents");

function extractSkillRefs(content: string): string[] {
  const refs = new Set<string>();
  const explicitSkillRegex = /skill\(name="([^"]+)"\)/gu;
  let explicitMatch = explicitSkillRegex.exec(content);
  while (explicitMatch !== null) {
    refs.add(explicitMatch[1]);
    explicitMatch = explicitSkillRegex.exec(content);
  }

  const codeSpanRegex = /`([^`]+)`/gu;
  let codeSpanMatch = codeSpanRegex.exec(content);
  while (codeSpanMatch !== null) {
    const skill = codeSpanMatch[1];
    if (skill.startsWith("mode-") || skill.startsWith("protocol-") || skill.startsWith("coordinator-")) {
      refs.add(skill);
    }
    codeSpanMatch = codeSpanRegex.exec(content);
  }
  return [...refs];
}

function listRoleSpecificSkills(roleRoot: string): string[] {
  const skillsDir = join(roleRoot, "skills");
  if (!existsSync(skillsDir)) {
    return [];
  }
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

function listSharedSkills(sharedSkillsRoot: string): string[] {
  return readdirSync(sharedSkillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

/**
 * <FUNCTION_CONTRACT id="FC-grace-agents-loadDescriptor">
 *   <Intent>Resolve one agent descriptor from canonical repository-owned role instructions and skills so workflow execution stays grounded in durable GRACE specs.</Intent>
 *   <Inputs>
 *     <Input name="input">Repository root and agent role name.</Input>
 *   </Inputs>
 *   <Outputs>
 *     <Output name="descriptor">Actor role mapping, SYSTEM.md ref, mandatory skill refs, and available skill refs.</Output>
 *   </Outputs>
 *   <Links>
 *     <Link ref="RequirementsAnalysis.xml#UC-GRACE-BOUNDED-EXECUTION" />
 *   </Links>
 * </FUNCTION_CONTRACT>
 */
export function loadAgentDescriptor(input: LoadAgentDescriptorInput): AgentDescriptor {
  const repoRoot = resolve(input.repoRoot);
  const roleRoot = resolve(V2_AGENTS_ROOT, input.roleName);
  const systemFile = resolve(roleRoot, "SYSTEM.md");
  const sharedSkillsRoot = resolve(V2_AGENTS_ROOT, "shared", "skills");

  if (!existsSync(systemFile)) {
    throw new Error(`Agent SYSTEM.md not found for role ${input.roleName}: ${systemFile}`);
  }

  const systemContent = readFileSync(systemFile, "utf8");
  const mandatorySkillRefs = extractSkillRefs(systemContent);
  const availableSkillRefs = Array.from(
    new Set([
      ...listSharedSkills(sharedSkillsRoot),
      ...listRoleSpecificSkills(roleRoot),
    ]),
  ).sort((left, right) => left.localeCompare(right));

  return {
    roleName: input.roleName,
    actorRole: ROLE_TO_ACTOR[input.roleName],
    systemFile,
    systemRef: toRepoArtifactRef(repoRoot, systemFile),
    mandatorySkillRefs,
    availableSkillRefs,
  };
}
