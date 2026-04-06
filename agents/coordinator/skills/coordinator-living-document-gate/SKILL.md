---
name: coordinator-living-document-gate
description: Verifies that semantic contracts (MC, FC, BA) embedded in source code are synchronized with actual code behavior using grace-sync-contracts --check; blocks on drift.
---

# Skill: coordinator-living-document-gate

## Purpose
Enforce the "Code as Living Document" principle by verifying that GRACE semantic contracts (MODULE_CONTRACT, FUNCTION_CONTRACT, BLOCK_ANCHOR) remain synchronized with the code they describe. Detect and block on drift before release or approval.

This gate answers: **"Do the contracts still match the code?"**

## Relationship to Other Gates
- **coordinator-traceability-gate** (GATE-TRACEABILITY-CHAIN): checks structural linkage completeness (UC -> MC -> FC -> BA -> log).
- **coordinator-living-document-gate** (GATE-LIVING-DOCUMENT): checks semantic synchronization (contract body matches code behavior).

Both gates must PASS before approval. Traceability is a prerequisite; living-document runs after or in parallel.

## Trigger
Use when:
- Coder returns implementation code with embedded contracts
- Before any GRACE_APPROVAL is recorded in approvals.log
- After any code change that modifies methods carrying FUNCTION_CONTRACT or BLOCK_ANCHOR markers
- During periodic consistency sweeps across the codebase

## Tool
**Script**: `tools/grace-sync-contracts.ts`
**Mode**: `--check` (read-only; no files modified)
**Flags**: `--check --json --dir <scan-root> --glob "*.ts"` (or appropriate extension)

### Exit Codes
| Code | Meaning | Gate Action |
|------|---------|-------------|
| 0 | All contracts synchronized | PASS |
| 1 | Drift detected | BLOCK |
| 2 | Tool execution error | BLOCK (error) |

### Detected Drift Types
| Issue Type | Description | Severity |
|------------|-------------|----------|
| MISSING_BA | BA id declared in FC BlockAnchors but not found in code | BLOCKING |
| UNDECLARED_BA | BA marker exists in code but not declared in FC BlockAnchors | BLOCKING |
| EMPTY_BA_BLOCK | BA marker present but code block is empty or whitespace-only | BLOCKING |
| MISSING_PRECONDITION | Precondition in contract has no corresponding guard/validation in code | BLOCKING |

## Coordinator Validation Gate (PASS/FAIL)

### Gate: GATE-LIVING-DOCUMENT (BLOCKING)

**Precondition**: GATE-TRACEABILITY-CHAIN has passed (structural chain is complete).

**Check**:
1. Run `npx tsx tools/grace-sync-contracts.ts --check --json --dir <scan-root>`.
2. Parse JSON output: `{ synchronized: bool, issues: SyncIssue[], summary: { total, drifted, fixed } }`.
3. If `synchronized == true` and `issues.length == 0` -> **PASS**.
4. If `issues.length > 0` -> **BLOCK** with LivingDocumentIssueReport.

**Scope**: The scan directory defaults to the project root (`.`). The glob pattern defaults to `.ts` but SHOULD be extended to match all source extensions carrying GRACE markers (e.g., `.java`, `.ts`, `.py`).

### Multi-Extension Scan
When the project contains multiple languages, run the check per extension:
```
npx tsx tools/grace-sync-contracts.ts --check --json --dir . --glob "*.ts"
npx tsx tools/grace-sync-contracts.ts --check --json --dir . --glob "*.java"
```
Aggregate results. Any drift in any extension is BLOCKING.

## PASS Output
```
CoordinatorChecks: LIVING-DOCUMENT PASS
All semantic contracts are synchronized with code.
Contracts checked: <total>
Drift issues: 0
```

## FAIL Output
```
CoordinatorChecks: LIVING-DOCUMENT FAIL
Drift detected in <N> contract(s).
Producing LivingDocumentIssueReport...
```

Then produce LivingDocumentIssueReport XML and route to the responsible agent.

## LivingDocumentIssueReport Template
```xml
<LivingDocumentIssueReport
  id="LIVEDOC-RPT-YYYYMMDD-##"
  handoffRef="Handoff-YYYYMMDD-##[-suffix]"
  gateStatus="FAIL|PASS_WITH_WARNINGS"
  created="YYYY-MM-DDTHH:mm:ss(+|-)HH:MM"
  validatedBy="GRACE-COORDINATOR"
>
  <Summary>
    Semantic contract drift detected. Contracts no longer match code behavior.
  </Summary>
  <DriftStats>
    <TotalContractsChecked>...</TotalContractsChecked>
    <DriftedFiles>...</DriftedFiles>
    <TotalIssues>...</TotalIssues>
  </DriftStats>
  <Issue id="LDI-...">
    <Type>MISSING_BA|UNDECLARED_BA|EMPTY_BA_BLOCK|MISSING_PRECONDITION</Type>
    <Severity>BLOCKING</Severity>
    <File>relative/path/to/file</File>
    <Line>...</Line>
    <FunctionContract id="FC-...">affected FC id</FunctionContract>
    <Description>...</Description>
    <ProposedFix>...</ProposedFix>
    <RequiredAgent>GRACE-CODER</RequiredAgent>
  </Issue>
  <Recommendation>
    [Instructions: Coder must resolve drift by updating code to match contracts
     or updating contracts to match intended code behavior, then re-run gate.]
  </Recommendation>
</LivingDocumentIssueReport>
```

## Gate Rule (for embedding in GRACE_MARKUP_STANDARD.md or handoffs)

```xml
<GateRule id="GATE-LIVING-DOCUMENT">
  <Name>Living Document Gate</Name>
  <Description>
    Verify that semantic contracts (MC, FC, BA) embedded in source code
    remain synchronized with actual code behavior. Run grace-sync-contracts
    in --check mode; any drift issue is BLOCKING.
  </Description>

  <Prerequisites>
    <Prereq id="TRACEABILITY-PASS">
      GATE-TRACEABILITY-CHAIN must pass first (structural chain complete).
    </Prereq>
  </Prerequisites>

  <Checks>
    <Check id="CHK-SYNC-EXIT-CODE">
      grace-sync-contracts --check exits with code 0 (synchronized).
    </Check>
    <Check id="CHK-NO-MISSING-BA">
      No FUNCTION_CONTRACT declares a BlockAnchor ref that is absent from code.
    </Check>
    <Check id="CHK-NO-UNDECLARED-BA">
      No BLOCK_ANCHOR marker exists in code without being declared in the owning FC.
    </Check>
    <Check id="CHK-NO-EMPTY-BA">
      Every BLOCK_ANCHOR has a non-empty code block after it.
    </Check>
  </Checks>

  <OnFailure>
    <Action>BLOCK approval and release</Action>
    <Action>Produce LivingDocumentIssueReport with specific drift issues</Action>
    <Action>Route to GRACE-CODER to resolve drift (update code or contracts)</Action>
    <Action>Require re-run of gate after fixes</Action>
  </OnFailure>
</GateRule>
```

## Execution Pseudocode

```
function runLivingDocumentGate(scanRoot, extensions):
  allIssues = []
  totalContracts = 0

  for ext in extensions:
    result = exec("npx tsx tools/grace-sync-contracts.ts --check --json --dir {scanRoot} --glob '*.{ext}'")

    if result.exitCode == 2:
      return BLOCK("Tool error: " + result.stderr)

    report = parseJSON(result.stdout)
    totalContracts += report.summary.total
    allIssues += report.issues

  if allIssues.isEmpty():
    return PASS("LIVING-DOCUMENT PASS. {totalContracts} contracts synchronized.")
  else:
    report = buildLivingDocumentIssueReport(allIssues, totalContracts)
    return BLOCK("LIVING-DOCUMENT FAIL. {allIssues.length} drift issues.", report)
```
