import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const nodeCmd = process.execPath;
const skillTraceScript = resolve("out/tools/grace-skill-trace.js");

function runSkillTrace(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(nodeCmd, [skillTraceScript, ...args], {
    encoding: "utf8",
    cwd: resolve("."),
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

test("grace-skill-trace appends invocation events for repeated skill loads", () => {
  const dir = mkdtempSync(join(tmpdir(), "grace-skill-trace-"));
  const file = join(dir, "CoderSkillTrace.json");

  const first = runSkillTrace([
    "--file", file,
    "--execution-id", "CODER-EXEC-test-01",
    "--trace-id", "TRACE-TEST-CORE",
    "--actor-role", "CODER",
    "--execution-sequence", "3",
    "--skill", "mode-coder",
    "--source", "MANDATORY_MODE",
    "--invoked-at", "2026-04-05T07:10:00+03:00",
    "--json",
  ]);
  assert.equal(first.status, 0, first.stderr || first.stdout);

  const second = runSkillTrace([
    "--file", file,
    "--execution-id", "CODER-EXEC-test-01",
    "--trace-id", "TRACE-TEST-CORE",
    "--actor-role", "CODER",
    "--execution-sequence", "3",
    "--skill", "protocol-grace-runtime-logging",
    "--source", "MANDATORY_PROTOCOL",
    "--invoked-at", "2026-04-05T07:10:01+03:00",
    "--json",
  ]);
  assert.equal(second.status, 0, second.stderr || second.stdout);

  const document = JSON.parse(readFileSync(file, "utf8")) as {
    executionId: string;
    events: Array<{ id: string; skill: string; source: string }>;
  };
  assert.equal(document.executionId, "CODER-EXEC-test-01");
  assert.equal(document.events.length, 2);
  assert.deepEqual(
    document.events.map((event) => ({ id: event.id, skill: event.skill, source: event.source })),
    [
      { id: "CODER-EXEC-test-01-SKILL-01", skill: "mode-coder", source: "MANDATORY_MODE" },
      { id: "CODER-EXEC-test-01-SKILL-02", skill: "protocol-grace-runtime-logging", source: "MANDATORY_PROTOCOL" },
    ],
  );
});
