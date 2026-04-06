---
name: coordinator-traceability-gate
description: Validates full traceability chain UC -> MC -> FC -> BA -> log across Architect and Coder outputs; emits TraceabilityIssueReport on failure.
---

# Skill: coordinator-traceability-gate

## Purpose
Enforce that every Use Case (UC) has a Module Contract (MC), every MC has a Function Contract (FC), every FC has Block Anchors (BA), and every BA generates a corresponding log entry. Produce a TraceabilityIssueReport when the chain is broken.

## Trigger
Use when:
- Architect provides updated RA/Tech/DP/Handoff
- Coder returns implementation code with embedded contracts
- Any validation pass that must confirm end-to-end traceability before approval or merge

## Traceability Chain
The canonical chain is:

  UC  -->  MC  -->  FC  -->  BA  -->  log

Each link must be verified bidirectionally:
- **UC -> MC**: For every UC in RequirementsAnalysis.xml, at least one MC exists whose SPECIFICATION or LINKS reference that UC.
- **MC -> FC**: For every MC, at least one FC exists that references that MC's id in its LINKS or metadata.
- **FC -> BA**: For every FC, every id declared in its BLOCK_ANCHORS section must appear as a BLOCK_ANCHOR comment in the implementing code.
- **BA -> log**: For every BA, at least one runtime log line (or contract log example) references the BA id in a [BLOCK=BA-...] token.

## Coordinator Validation Gates (PASS/FAIL)

### Gate 1: UC -> MC Linkage (BLOCKING)
- Every UC-*, UC-DEMO-*, UC-TRACEABILITY-* listed in RequirementsAnalysis.xml has at least one MODULE_CONTRACT with a SPECIFICATION or LINK pointing to that UC.
- If a UC is marked TBD or PENDING_HUMAN, skip with a warning (NONBLOCKING).
- Failure: missing MC for an active UC.

### Gate 2: MC -> FC Linkage (BLOCKING)
- Every MODULE_CONTRACT has at least one FUNCTION_CONTRACT whose LINKS reference the MC id.
- If an MC is for a purely structural module (e.g., MODULE_MAP-only package-info), skip with a note.
- Failure: MC exists but no FC references it.

### Gate 3: FC -> BA Linkage (BLOCKING)
- Every FUNCTION_CONTRACT declares its BLOCK_ANCHOR ids under BLOCK_ANCHORS (or equivalent).
- Each declared BA id must appear as an inline BLOCK_ANCHOR comment in the implementing source file.
- If a FC has no BLOCK_ANCHORS section and is for a trivial/non-critical method, skip (NONBLOCKING).
- Failure: FC declares a BA that is absent from code.

### Gate 4: BA -> log Linkage (BLOCKING)
- For every BA that appears in code, at least one runtime log line (in the same file or in contract LOGGING examples) references the BA id via [BLOCK=<ba-id>] or `ba: "<ba-id>"` in a JSON log entry.
- Log format must follow GRACE_RUNTIME_LOGGING pattern:
  - Bracket style: [SVC=...][UC=...][BLOCK=BA-...][STATE=...] eventType=... decision=... keyValues=...
  - JSON style: { "mc": "...", "uc": "...", "ba": "BA-...", "belief": "...", "fact": {...} }
- Failure: BA present in code but no log line references it.

### Gate 5: Bidirectional Consistency (BLOCKING)
- No orphaned contracts: an MC not linked from any FC, or a BA not linked from any FC, is a structural defect.
- No phantom references: an FC referencing a BA that does not exist in code, or an MC referencing a UC that does not exist in RA, is a structural defect.
- IDs must follow naming conventions: MC-*, FC-*, BA-*, UC-*.

## PASS Output
- CoordinatorChecks: TRACEABILITY PASS
- All gates passed; chain is complete and bidirectionally consistent.

## FAIL Output
- CoordinatorChecks: TRACEABILITY FAIL + gate name(s)
- Produce TraceabilityIssueReport XML
- Route to Architect (for MC/UC gaps) or Coder (for BA/log gaps) with specific fix list

## TraceabilityIssueReport Template
```xml
<TraceabilityIssueReport
  id="TRACE-RPT-YYYYMMDD-##"
  handoffRef="Handoff-YYYYMMDD-##[-suffix]"
  gateStatus="FAIL|PASS_WITH_WARNINGS"
  created="YYYY-MM-DDTHH:mm:ss(+|-)HH:MM"
  validatedBy="GRACE-COORDINATOR"
>
  <Summary>
    [High-level summary of traceability gaps.]
  </Summary>
  <Issue id="TRC-...">
    <Gate>UC_TO_MC|MC_TO_FC|FC_TO_BA|BA_TO_LOG|BIDIRECTIONAL</Gate>
    <Severity>BLOCKING|NONBLOCKING</Severity>
    <Description>...</Description>
    <Source id="UC-...">UC id with missing linkage</Source>
    <Target id="MC-...|FC-...|BA-...">Expected target that is absent</Target>
    <Evidence>Artifact/Section/ID references...</Evidence>
    <ProposedFix>...</ProposedFix>
    <RequiredAgent>GRACE-ARCHITECT|GRACE-CODER</RequiredAgent>
  </Issue>
  <Recommendation>
    [Clear instructions on which agent must fix which gap and in what order.]
  </Recommendation>
</TraceabilityIssueReport>
```

## Gate Rule (for embedding in GRACE_MARKUP_STANDARD.md or handoffs)

```xml
<GateRule id="GATE-TRACEABILITY-CHAIN">
  <Name>Traceability Chain Gate</Name>
  <Description>
    Verify the full GRACE traceability chain: every UC has MC,
    every MC has FC, every FC has BA, every BA generates a log.
    Chain must be bidirectionally consistent with no orphans or phantoms.
  </Description>

  <Checks>
    <Check id="CHK-UC-MC">
      Every active UC in RequirementsAnalysis.xml is referenced by at least one MODULE_CONTRACT.
    </Check>
    <Check id="CHK-MC-FC">
      Every MODULE_CONTRACT is referenced by at least one FUNCTION_CONTRACT.
    </Check>
    <Check id="CHK-FC-BA">
      Every FUNCTION_CONTRACT's declared BLOCK_ANCHORs exist in implementing code.
    </Check>
    <Check id="CHK-BA-LOG">
      Every BLOCK_ANCHOR in code is referenced by at least one runtime log line.
    </Check>
    <Check id="CHK-BIDIRECTIONAL">
      No orphaned MC/FC/BA and no phantom references (FC->BA, MC->UC).
    </Check>
  </Checks>

  <OnFailure>
    <Action>BLOCK approval and implementation</Action>
    <Action>Return TraceabilityIssueReport with specific broken links</Action>
    <Action>Route to GRACE-ARCHITECT for MC/UC gaps or GRACE-CODER for BA/log gaps</Action>
  </OnFailure>
</GateRule>
```
