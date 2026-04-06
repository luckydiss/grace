import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadAgentDescriptor } from "./load-agent-descriptor.js";
import { invokeAgent } from "./invoke-agent.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

test("FC-grace-agents-invokeAgent emits task packet and invocation records from v2-local descriptors", () => {
  const dir = mkdtempSync(join(tmpdir(), "grace-invoke-agent-"));
  const descriptor = loadAgentDescriptor({ repoRoot, roleName: "architect" });
  const result = invokeAgent({
    repoRoot,
    productId: "notes-api",
    traceId: "TRACE-NOTES-API-CORE",
    descriptor,
    executionSequence: 1,
    loadedSkillRefs: ["mode-architect", "protocol-grace-markup"],
    inputRefs: ["products/notes-api/docs/grace/RequirementsAnalysis.xml"],
    allowedStates: ["INTAKE_CLASSIFIED"],
    allowedFcIds: ["FC-grace-agents-runArchitectRole"],
    allowedBaIds: ["BA-grace-run-architect-role"],
    taskPacketFile: join(dir, "ArchitectTaskPacket.json"),
    invocationFile: join(dir, "ArchitectInvocation.json"),
  });

  assert.match(readFileSync(result.taskPacketFile, "utf8"), /grace-agent-task-packet-v1/u);
  assert.match(readFileSync(result.taskPacketFile, "utf8"), /grace\/agents\/architect\/SYSTEM\.md/u);
  assert.match(readFileSync(result.invocationFile, "utf8"), /DISPATCHED/u);
  assert.equal(typeof result.taskPacketRef, "string");
  assert.equal(typeof result.invocationRef, "string");
});
