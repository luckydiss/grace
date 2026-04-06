import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { validateAgentEvidence } from "./agent-evidence.js";

const repoRoot = process.cwd();

function writeRoleFiles(dir: string, prefix: string): void {
  writeFileSync(join(dir, `${prefix}TaskPacket-Workflow-0001.json`), '{ "schemaVersion": "grace-agent-task-packet-v1" }\n', "utf8");
  writeFileSync(join(dir, `${prefix}Invocation-Workflow-0001.json`), '{ "schemaVersion": "grace-agent-invocation-v1" }\n', "utf8");
  writeFileSync(join(dir, `${prefix}Execution-Workflow-0001.xml`), `<${prefix}Execution />\n`, "utf8");
  writeFileSync(join(dir, `${prefix}SkillTrace-Workflow-0001.json`), '{ "schemaVersion": "grace-skill-trace-v1" }\n', "utf8");
}

test("FC-grace-validators-validateAgentEvidence accepts full swarm evidence", () => {
  const dir = mkdtempSync(join(tmpdir(), "grace-agent-evidence-"));
  mkdirSync(dir, { recursive: true });
  writeRoleFiles(dir, "Architect");
  writeRoleFiles(dir, "Coordinator");
  writeRoleFiles(dir, "Coder");

  const result = validateAgentEvidence({
    repoRoot,
    productId: "notes-api",
    traceId: "TRACE-NOTES-API-CORE",
    executionDir: dir,
    requiredRoles: ["ARCHITECT", "COORDINATOR", "CODER"],
  });

  assert.equal(result.ok, true);
  assert.equal(result.failures.length, 0);
  assert.equal(result.artifactRefs.length, 12);
});

test("FC-grace-validators-validateAgentEvidence blocks when one role artifact is missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "grace-agent-evidence-"));
  mkdirSync(dir, { recursive: true });
  writeRoleFiles(dir, "Architect");
  writeRoleFiles(dir, "Coordinator");

  const result = validateAgentEvidence({
    repoRoot,
    productId: "notes-api",
    traceId: "TRACE-NOTES-API-CORE",
    executionDir: dir,
    requiredRoles: ["ARCHITECT", "COORDINATOR", "CODER"],
  });

  assert.equal(result.ok, false);
  assert.equal(result.failures.some((failure) => failure.code === "AGENT_ARTIFACT_MISSING"), true);
});
