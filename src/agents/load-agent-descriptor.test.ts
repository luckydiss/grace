import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { loadAgentDescriptor } from "./load-agent-descriptor.js";

const repoRoot = process.cwd();

test("FC-grace-agents-loadDescriptor resolves canonical coordinator descriptor from repository specs", () => {
  const descriptor = loadAgentDescriptor({
    repoRoot,
    roleName: "coordinator",
  });

  assert.equal(descriptor.actorRole, "COORDINATOR");
  assert.equal(descriptor.systemRef, "agents/coordinator/SYSTEM.md");
  assert.ok(descriptor.mandatorySkillRefs.includes("mode-coordinator"));
  assert.ok(descriptor.mandatorySkillRefs.includes("protocol-grace-markup"));
  assert.ok(descriptor.availableSkillRefs.includes("coordinator-work-orders"));
  assert.ok(descriptor.availableSkillRefs.includes("protocol-grace-traceability"));
});
