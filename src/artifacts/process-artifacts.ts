import { existsSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { ensureParentDir } from "../runtime/fs-utils.js";
import { createGraceRuntimeLogger } from "../runtime/runtime-log.js";
import type {
  EmitWorkflowOwnedArtifactsInput,
  EmitWorkflowOwnedArtifactsResult,
  WorkflowOwnedArtifactSpec,
} from "./index.js";

const MC_GRACE_ARTIFACT_ADAPTERS = "MC-grace-artifact-adapters";
const FC_GRACE_ARTIFACTS_EMIT_WORKFLOW_OWNED = "FC-grace-artifacts-emitWorkflowOwnedArtifacts";
const BA_GRACE_BUILD_PROCESS_ARTIFACT = "BA-grace-build-process-artifact";
const BA_GRACE_PERSIST_PROCESS_ARTIFACT = "BA-grace-persist-process-artifact";

const graceRuntimeLog = createGraceRuntimeLogger({
  mc: MC_GRACE_ARTIFACT_ADAPTERS,
  fc: FC_GRACE_ARTIFACTS_EMIT_WORKFLOW_OWNED,
});

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function canonicalApprovalRef(handoffRef: string | undefined, fallbackRef: string): string {
  const candidate = handoffRef ?? fallbackRef;
  const fileName = basename(candidate);
  return fileName.endsWith(".xml") ? fileName.slice(0, -4) : fileName;
}

function canonicalArtifactId(artifactRef: string): string {
  const fileName = basename(artifactRef);
  return fileName.endsWith(".xml") ? fileName.slice(0, -4) : fileName;
}

function buildXml(spec: WorkflowOwnedArtifactSpec, input: EmitWorkflowOwnedArtifactsInput): string {
  const common = ` traceId="${xmlEscape(input.traceId)}" productId="${xmlEscape(input.productId)}" transitionId="${xmlEscape(input.transitionId)}" created="${xmlEscape(input.createdAt)}" emittedBy="GRACE-RUNTIME"`;
  switch (spec.kind) {
    case "handoff":
      return `<?xml version="1.0" encoding="UTF-8"?>
<GRACE_HANDOFF id="${xmlEscape(canonicalArtifactId(spec.ref))}" status="EMITTED" schemaVersion="grace-markup-v2" created="${xmlEscape(input.createdAt)}" author="GRACE-RUNTIME" taskRef="${xmlEscape(input.transition)}" planRef="DevelopmentExecutionPlan.xml#W1-T1" blueprintRef="DevelopmentPlan.xml#DP-SVC-grace-workflow-core" techRef="Technology.xml#DEC-GRACE-LANGGRAPH-001" requirementsRef="RequirementsAnalysis.xml#UC-GRACE-TRACEABILITY" traceId="${xmlEscape(input.traceId)}">
  <Summary>${xmlEscape(spec.title ?? "Workflow-owned handoff artifact")}</Summary>
  <Artifacts>
    <Artifact ref="${xmlEscape(spec.ref)}" version="workflow-owned" />
  </Artifacts>
</GRACE_HANDOFF>
`;
    case "branchspec":
      return `<?xml version="1.0" encoding="UTF-8"?>
<BRANCH_SPEC id="${xmlEscape(canonicalArtifactId(spec.ref))}" status="ISSUED">
  <ChangeClassification>workflow-owned</ChangeClassification>
  <BranchName>${xmlEscape(canonicalArtifactId(spec.ref))}</BranchName>
  <BaseBranch>develop</BaseBranch>
  <PRTarget>develop</PRTarget>
  <PreferredMergeMethod>squash</PreferredMergeMethod>
  <RequiresBackMergeToDevelop>false</RequiresBackMergeToDevelop>
</BRANCH_SPEC>
`;
    case "cwo":
      return `<?xml version="1.0" encoding="UTF-8"?>
<CODER_WORK_ORDER id="${xmlEscape(canonicalArtifactId(spec.ref))}" status="EMITTED" traceId="${xmlEscape(input.traceId)}">
  <Scope>
    <HandoffRef>${xmlEscape(canonicalApprovalRef(spec.handoffRef, spec.ref))}</HandoffRef>
  </Scope>
  <RequiredOutputs>
    <Item>${xmlEscape(spec.title ?? "Workflow-owned coder work order")}</Item>
  </RequiredOutputs>
</CODER_WORK_ORDER>
`;
    case "approval-log":
      return `<GRACE_APPROVAL
  ref="${xmlEscape(canonicalApprovalRef(spec.handoffRef, spec.ref))}"
  status="APPROVED"
  approved="${xmlEscape(input.createdAt)}"
  approver="${xmlEscape(input.actor)}"
  transitionId="${xmlEscape(input.transitionId)}"
/>
`;
  }
}

/**
 * <FUNCTION_CONTRACT id="FC-grace-artifacts-emitWorkflowOwnedArtifacts">
 *   <Intent>Materialize workflow-owned process artifacts so key governance evidence is emitted by transition effects instead of manual edits.</Intent>
 *   <Inputs>
 *     <Input name="input">Transition context and one or more process artifact specs for handoff, branchspec, cwo, or approval-log emission.</Input>
 *   </Inputs>
 *   <Outputs>
 *     <Output name="result">Persisted workflow-owned artifact paths and refs that can be appended to transition evidence.</Output>
 *   </Outputs>
 *   <BlockAnchors>
 *     <BA ref="BA-grace-build-process-artifact" />
 *     <BA ref="BA-grace-persist-process-artifact" />
 *   </BlockAnchors>
 *   <Links>
 *     <Link ref="RequirementsAnalysis.xml#UC-GRACE-TRACEABILITY" />
 *     <Link ref="RequirementsAnalysis.xml#UC-GRACE-HUMAN-APPROVAL" />
 *   </Links>
 * </FUNCTION_CONTRACT>
 */
export function emitWorkflowOwnedArtifacts(input: EmitWorkflowOwnedArtifactsInput): EmitWorkflowOwnedArtifactsResult {
  /* <BLOCK_ANCHOR id="BA-grace-build-process-artifact" purpose="Build deterministic workflow-owned process artifacts from one explicit transition context" /> */
  graceRuntimeLog({
    ba: BA_GRACE_BUILD_PROCESS_ARTIFACT,
    belief: "Workflow-owned process artifacts must be derived deterministically from one transition context instead of manual edits",
    fact: {
      transitionId: input.transitionId,
      transition: input.transition,
      kinds: input.specs.map((spec) => spec.kind),
    },
  });

  /* <BLOCK_ANCHOR id="BA-grace-persist-process-artifact" purpose="Persist each workflow-owned artifact before its ref is appended to transition evidence" /> */
  const emitted = input.specs.map((spec) => {
    const absoluteFile = resolve(spec.outputFile);
    ensureParentDir(absoluteFile);
    if (spec.kind === "approval-log") {
      const content = buildXml(spec, input);
      writeFileSync(absoluteFile, content, { encoding: "utf8", flag: existsSync(absoluteFile) ? "a" : "w" });
    } else if (!existsSync(absoluteFile)) {
      const content = buildXml(spec, input);
      writeFileSync(absoluteFile, content, "utf8");
    }
    return {
      kind: spec.kind,
      outputFile: absoluteFile,
      artifactRef: spec.ref,
    };
  });

  graceRuntimeLog({
    ba: BA_GRACE_PERSIST_PROCESS_ARTIFACT,
    belief: "Each workflow-owned process artifact must be durably persisted before its ref enters the transition evidence chain",
    fact: {
      emittedCount: emitted.length,
      artifactRefs: emitted.map((item) => item.artifactRef),
    },
  });

  return { emitted };
}
