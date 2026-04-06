import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const nodeCmd = process.execPath;
const executionProofScript = resolve("out/tools/grace-execution-proof.js");
const executionSchemaScript = resolve("out/tools/grace-execution-schema.js");

function runScript(scriptPath: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(nodeCmd, [scriptPath, ...args], {
    encoding: "utf8",
    cwd: resolve("."),
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function writeExecutionFixture(dir: string, fileName: string, xml: string): void {
  writeFileSync(join(dir, fileName), `${xml}\n`, "utf8");
}

function writeSkillTraceFixture(dir: string, fileName: string, payload: string): void {
  writeFileSync(join(dir, fileName), `${payload}\n`, "utf8");
}

test("execution proof and schema pass when matching skill traces are materialized", () => {
  const dir = mkdtempSync(join(tmpdir(), "grace-execution-proof-"));
  const traceId = "TRACE-TEST-CORE";

  writeExecutionFixture(dir, "ArchitectExecution.xml", `<?xml version="1.0" encoding="UTF-8"?>
<ArchitectExecution id="ARCH-EXEC-test-01" traceId="${traceId}" actorRole="ARCHITECT" sequence="1">
  <InputRefs><Ref value="RequirementsAnalysis.xml#UC-TEST-01" /></InputRefs>
  <OutputRefs><Ref value="DevelopmentPlan.xml#DP-SVC-test" /></OutputRefs>
  <RequiredSkillRefs>
    <Skill name="mode-architect" />
    <Skill name="protocol-grace-markup" />
    <Skill name="protocol-decision-collapse" />
  </RequiredSkillRefs>
</ArchitectExecution>`);
  writeExecutionFixture(dir, "CoordinatorExecution.xml", `<?xml version="1.0" encoding="UTF-8"?>
<CoordinatorExecution id="COORD-EXEC-test-01" traceId="${traceId}" actorRole="COORDINATOR" sequence="2">
  <InputRefs><Ref value="docs/grace/handoffs/Handoff-test.xml#Handoff-test" /></InputRefs>
  <OutputRefs><Ref value="docs/grace/cwo/CWO-test.xml#CWO-test" /></OutputRefs>
  <RequiredSkillRefs>
    <Skill name="mode-coordinator" />
    <Skill name="protocol-grace-traceability" />
    <Skill name="coordinator-work-orders" />
  </RequiredSkillRefs>
</CoordinatorExecution>`);
  writeExecutionFixture(dir, "CoderExecution.xml", `<?xml version="1.0" encoding="UTF-8"?>
<CoderExecution id="CODER-EXEC-test-01" traceId="${traceId}" actorRole="CODER" sequence="3">
  <InputRefs><Ref value="docs/grace/cwo/CWO-test.xml#CWO-test" /></InputRefs>
  <OutputRefs><Ref value="src/app.ts#MC-test" /></OutputRefs>
  <RequiredSkillRefs>
    <Skill name="mode-coder" />
    <Skill name="protocol-grace-patch-safety" />
    <Skill name="protocol-grace-runtime-logging" />
  </RequiredSkillRefs>
</CoderExecution>`);
  writeExecutionFixture(dir, "AutonomyCycleExecution.xml", `<?xml version="1.0" encoding="UTF-8"?>
<AutonomyCycleExecution id="AUTO-EXEC-test-01" traceId="${traceId}" actorRole="COORDINATOR" sequence="4">
  <InputRefs><Ref value="docs/grace/reports/test-envelope.json" /></InputRefs>
  <OutputRefs><Ref value="docs/grace/reports/test-envelope.loop-guard.json" /></OutputRefs>
  <RequiredSkillRefs>
    <Skill name="protocol-grace-retry-budget" />
    <Skill name="protocol-grace-forced-context" />
    <Skill name="protocol-grace-failure-memory" />
  </RequiredSkillRefs>
</AutonomyCycleExecution>`);

  writeSkillTraceFixture(dir, "ArchitectSkillTrace.json", `{
  "schemaVersion": "grace-skill-trace-v1",
  "traceId": "${traceId}",
  "executionId": "ARCH-EXEC-test-01",
  "actorRole": "ARCHITECT",
  "executionSequence": 1,
  "generatedAt": "2026-04-05T07:20:00+03:00",
  "events": [
    { "id": "ARCH-EXEC-test-01-SKILL-01", "skill": "mode-architect", "status": "LOADED", "source": "MANDATORY_MODE", "invokedAt": "2026-04-05T07:20:00+03:00", "trigger": "skill(name=\\"mode-architect\\")" },
    { "id": "ARCH-EXEC-test-01-SKILL-02", "skill": "protocol-grace-markup", "status": "LOADED", "source": "MANDATORY_PROTOCOL", "invokedAt": "2026-04-05T07:20:01+03:00", "trigger": "skill(name=\\"protocol-grace-markup\\")" },
    { "id": "ARCH-EXEC-test-01-SKILL-03", "skill": "protocol-decision-collapse", "status": "LOADED", "source": "MANDATORY_PROTOCOL", "invokedAt": "2026-04-05T07:20:02+03:00", "trigger": "skill(name=\\"protocol-decision-collapse\\")" }
  ]
}`);
  writeSkillTraceFixture(dir, "CoordinatorSkillTrace.json", `{
  "schemaVersion": "grace-skill-trace-v1",
  "traceId": "${traceId}",
  "executionId": "COORD-EXEC-test-01",
  "actorRole": "COORDINATOR",
  "executionSequence": 2,
  "generatedAt": "2026-04-05T07:20:03+03:00",
  "events": [
    { "id": "COORD-EXEC-test-01-SKILL-01", "skill": "mode-coordinator", "status": "LOADED", "source": "MANDATORY_MODE", "invokedAt": "2026-04-05T07:20:03+03:00", "trigger": "skill(name=\\"mode-coordinator\\")" },
    { "id": "COORD-EXEC-test-01-SKILL-02", "skill": "protocol-grace-traceability", "status": "LOADED", "source": "MANDATORY_PROTOCOL", "invokedAt": "2026-04-05T07:20:04+03:00", "trigger": "skill(name=\\"protocol-grace-traceability\\")" },
    { "id": "COORD-EXEC-test-01-SKILL-03", "skill": "coordinator-work-orders", "status": "LOADED", "source": "OPTIONAL", "invokedAt": "2026-04-05T07:20:05+03:00", "trigger": "skill(name=\\"coordinator-work-orders\\")" }
  ]
}`);
  writeSkillTraceFixture(dir, "CoderSkillTrace.json", `{
  "schemaVersion": "grace-skill-trace-v1",
  "traceId": "${traceId}",
  "executionId": "CODER-EXEC-test-01",
  "actorRole": "CODER",
  "executionSequence": 3,
  "generatedAt": "2026-04-05T07:20:06+03:00",
  "events": [
    { "id": "CODER-EXEC-test-01-SKILL-01", "skill": "mode-coder", "status": "LOADED", "source": "MANDATORY_MODE", "invokedAt": "2026-04-05T07:20:06+03:00", "trigger": "skill(name=\\"mode-coder\\")" },
    { "id": "CODER-EXEC-test-01-SKILL-02", "skill": "protocol-grace-patch-safety", "status": "LOADED", "source": "MANDATORY_PROTOCOL", "invokedAt": "2026-04-05T07:20:07+03:00", "trigger": "skill(name=\\"protocol-grace-patch-safety\\")" },
    { "id": "CODER-EXEC-test-01-SKILL-03", "skill": "protocol-grace-runtime-logging", "status": "LOADED", "source": "MANDATORY_PROTOCOL", "invokedAt": "2026-04-05T07:20:08+03:00", "trigger": "skill(name=\\"protocol-grace-runtime-logging\\")" }
  ]
}`);
  writeSkillTraceFixture(dir, "AutonomyCycleSkillTrace.json", `{
  "schemaVersion": "grace-skill-trace-v1",
  "traceId": "${traceId}",
  "executionId": "AUTO-EXEC-test-01",
  "actorRole": "COORDINATOR",
  "executionSequence": 4,
  "generatedAt": "2026-04-05T07:20:09+03:00",
  "events": [
    { "id": "AUTO-EXEC-test-01-SKILL-01", "skill": "protocol-grace-retry-budget", "status": "LOADED", "source": "MANDATORY_PROTOCOL", "invokedAt": "2026-04-05T07:20:09+03:00", "trigger": "skill(name=\\"protocol-grace-retry-budget\\")" },
    { "id": "AUTO-EXEC-test-01-SKILL-02", "skill": "protocol-grace-forced-context", "status": "LOADED", "source": "MANDATORY_PROTOCOL", "invokedAt": "2026-04-05T07:20:10+03:00", "trigger": "skill(name=\\"protocol-grace-forced-context\\")" },
    { "id": "AUTO-EXEC-test-01-SKILL-03", "skill": "protocol-grace-failure-memory", "status": "LOADED", "source": "MANDATORY_PROTOCOL", "invokedAt": "2026-04-05T07:20:11+03:00", "trigger": "skill(name=\\"protocol-grace-failure-memory\\")" }
  ]
}`);

  const proof = runScript(executionProofScript, ["--dir", dir, "--json"]);
  assert.equal(proof.status, 0, proof.stderr || proof.stdout);
  const proofPayload = JSON.parse(proof.stdout) as { valid: boolean };
  assert.equal(proofPayload.valid, true);

  const schema = runScript(executionSchemaScript, ["--dir", dir, "--json"]);
  assert.equal(schema.status, 0, schema.stderr || schema.stdout);
  const schemaPayload = JSON.parse(schema.stdout) as { valid: boolean };
  assert.equal(schemaPayload.valid, true);
});
