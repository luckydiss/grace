---
name: coordinator-blueprint-gates
description: Validates Architect outputs (RA/Tech/DP/Handoff) with PASS/FAIL gates for consistency, traceability, completeness, readability-by-design, and Git governance; emits BlueprintIssueReport on failure.
---

# Skill: coordinator-blueprint-gates

## Purpose
Run deterministic PASS/FAIL validation on Architect outputs (RA/Tech/DP/Handoff) and produce a BlueprintIssueReport when failing.

## Trigger
Use whenever Architect provides:
- updated RA/Tech/DP
- a GRACE_HANDOFF v2
- <GIT_IMPACT> block
and you must decide whether blueprint is ready for approval/implementation.

## Coordinator Validation Gates (PASS/FAIL)

### Blueprint Validation (Architect Output) -- REQUIRED
Run these gates and output PASS/FAIL.

1) Consistency Gate (BLOCKING)
- IDs follow conventions: ACT/UC/NFR/DP-SVC/Flow/DEC/MC/FC/BA/TC
- No "OR" ambiguity in canonical artifacts
- DEC-* identical across Technology.xml and handoff DecisionsSnapshot
- DB-per-service and no cross-service joins implied
- New services (if any) must have:
  - DP-SVC entry
  - bounded context named
  - dependencies listed
  - DB ownership implied (no shared schema)

2) Traceability Gate (BLOCKING)
- All <Link ref="..."> targets exist (or explicitly marked TBD with PENDING_HUMAN)
- UC -> Flow -> Contract -> BA -> TC is linked for in-scope critical paths

3) Completeness Gate (BLOCKING for critical paths)
- For each in-scope critical use case: FC exists + BA anchors defined + TC-* cases present
- Core critical paths typically include:
  - configuration validation
  - pricing calculation
  - payment/deposit capture
  - order state transitions
  - measurement request + submit results (if in scope)
  - B2B billing/invoices (if in scope)
  - document generation/versioning (if in scope)
  - Security Mapping: Explicit RBAC roles defined for critical entry points (function/module contracts).
  - API Alignment: Inbound adapters mapped to explicit definitions in api-contracts.
- ContractEvolutionPolicy exists in DevelopmentPlan.xml (or explicitly added by Architect)

4) Human-Readability & Clean-Code Gate (BLOCKING)
- Blueprint/contracts must lead to human-readable code: small responsibilities, explicit boundaries, predictable flow.
- Watchlist enforcement (must be addressed in blueprint/contracts):
  A) Huge classes/methods must be prevented by design (SRP split, clear module responsibilities).
     Example: NO validate+price+save+notify in one service -> OK split components/services
  B) Magic numbers must be avoided via domain constants/config/enums.
     Example: NO if(attempts>5) -> OK if(attempts>MAX_LOGIN_ATTEMPTS)
  C) Error handling must be consistent and domain-focused (no generic exceptions for domain failures).
     Example: NO IllegalArgumentException("Configuration not found")
              OK AccountDomainErrors.configurationNotFound(userId, configId)
  D) Mapper duplication must be addressed via shared mapping utilities/abstractions.
  E) Complex conditional logic must be minimized via guard clauses, named predicates, or Strategy/State.
     Example: NO if(a){if(b){if(c){...}}} -> OK guard clauses / Strategy

If any gate fails, produce BlueprintIssueReport-YYYYMMDD-##.xml file in docs/grace/reports/blueprint-issue with the following format:

5) Git Governance Gate (BLOCKING)
- Architect output includes <GIT_IMPACT> before GRACE_HANDOFF
- GIT_IMPACT routing is consistent with handoff scope (services/use cases)
- Coordinator produces a BranchSpec consistent with GIT_IMPACT and GitFlow defaults
- For release/* or hotfix/*: back-merge requirement is explicitly present
- No instruction suggests direct pushes to main/develop or force-push

## PASS Output
- CoordinatorChecks: PASS with gate list
- ApprovalInstruction: include exact v2 tag to add to approvals.log

## FAIL Output
- CoordinatorChecks: FAIL + gate name(s)
- Produce BlueprintIssueReport XML (below)
- Route to Architect with a minimal fix list

## BlueprintIssueReport Template
```xml
<BlueprintIssueReport
  id="ISSUE-RPT-YYYYMMDD-##"
  handoffRef="Handoff-YYYYMMDD-##[-suffix]"
  gateStatus="FAIL|PASS_WITH_WARNINGS"
  created="YYYY-MM-DDTHH:mm:ss(+|-)HH:MM"
  validatedBy="GRACE-COORDINATOR"
>
  <Summary>
    [High-level summary of why the handoff failed gate validation. Highlight blocking issues concisely. E.g., "Handoff failed Consistency Gate due to missing decisions in Technology.xml."]
  </Summary>
  <Issue id="ISS-...">
    <Severity>BLOCKING|NONBLOCKING</Severity>
    <Description>...</Description>
    <Evidence>Artifact/Section/ID references...</Evidence>
    <Impact>...</Impact>
    <ProposedFix>...</ProposedFix>
    <RequiredAgent>GRACE-ARCHITECT</RequiredAgent>
  </Issue>
  <Recommendation>
    [Clear, directive instructions on the next workflow steps. E.g., "Return to GRACE-ARCHITECT to address blocking issues. Once resolved, re-submit for validation."]
  </Recommendation>
</BlueprintIssueReport>
```

