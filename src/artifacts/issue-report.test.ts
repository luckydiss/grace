import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { emitIssueReport } from "./issue-report.js";

test("FC-grace-artifacts-emitIssueReport persists deterministic XML issue-report evidence", () => {
  const dir = mkdtempSync(join(tmpdir(), "grace-issue-report-"));
  const reportFile = join(dir, "IssueReport-TRANS-0007.xml");

  const result = emitIssueReport({
    productId: "grace",
    traceId: "TRACE-GRACE-CORE",
    transitionId: "TRANS-0007",
    actor: "CODER",
    transition: "issue_cwo",
    fromState: "INTAKE_RECEIVED",
    toState: "BLOCKED",
    createdAt: "2026-04-05T10:00:00+03:00",
    failures: [{ code: "ACTOR_NOT_ALLOWED", message: "Actor CODER is not allowed for transition issue_cwo." }],
    artifactRefs: ["docs/grace/state/TransitionLog.jsonl"],
    reportFile,
  });

  assert.equal(result.issueReportId, "ISSUE-RPT-TRANS-0007");
  assert.match(readFileSync(reportFile, "utf8"), /WorkflowIssueReport/u);
  assert.match(readFileSync(reportFile, "utf8"), /ACTOR_NOT_ALLOWED/u);
});
