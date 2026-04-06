---
name: coordinator-work-orders
description: Generates pasteable Architect Work Orders (AWO) and Coder Work Orders (CWO) with strict prerequisites, embedded scope/IDs, and self-contained instructions.
---

## Purpose
Generate pasteable, self-contained work orders:
- Architect Work Order (AWO)
- Coder Work Order (CWO)

## Trigger
Use when user asks:
- "What next", "give task", "make work order"
- needs blueprint refinement (AWO) or implementation (CWO)

## Work Order Selection Rules
### Issue AWO when any is true
- RA/Tech/DP missing or incomplete
- new/changed scope requires new/updated contracts
- decisions not recorded (DEC missing / OR ambiguity)
- handoff v2 missing or outdated
- traceability gaps in scope

### Issue CWO only when ALL true
- handoff v2 exists (scope + MC/FC/BA + artifact refs)
- approval v2 exists in approvals.log
- BranchSpec issued by Coordinator
- required RA/Tech/DP sections + contract texts are available in the WO
- no blocking PENDING/TBD decisions for in-scope behavior
- if the task is a repeated remediation, W11 failure envelope + forced-context bundle are attached or explicitly linked

## Templates

### 1) Architect Work Order
Use when any of these are true:
- requirements ambiguity, new decision needed, blueprint change, new/changed contracts, missing artifacts/handoff, decision readiness blocking coding.

Creating AWO-YYYYMMDD-##.xml file in the directory docs/grace/awo with the following content:

```xml
<ARCHITECT_WORK_ORDER id="AWO-YYYYMMDD-##" status="PROPOSED">
  <Task>
    <WaveRef>W0|W1|Wn</WaveRef>
    <TaskRef>Wn-Tm</TaskRef>
    <UserRequest>...</UserRequest>
    <PrimaryGoal>...</PrimaryGoal>
  </Task>

  <KnownArtifacts>
    <Artifact name="RequirementsAnalysis.xml" provided="yes|no"/>
    <Artifact name="Technology.xml" provided="yes|no"/>
    <Artifact name="DevelopmentPlan.xml" provided="yes|no"/>
  </KnownArtifacts>

  <Scope>
    <Services>
      <ServiceRef ref="DP-SVC-..."/>
    </Services>
    <UseCases>
      <UseCaseRef ref="UC-..."/>
    </UseCases>
  </Scope>

  <RequiredOutputs>
    <Artifacts>
      <RequirementsAnalysisUpdates/>
      <TechnologyUpdates/>
      <DevelopmentPlanUpdates/>
    </Artifacts>

    <Decisions>
      <Item>Record any missing choices as DEC-* in Technology.xml (no OR)</Item>
      <Item>Explicitly record system-of-record boundaries for integrations (CRM/ERP/CAD/logistics/payment) when referenced</Item>
      <Item>Provide a DecisionsSnapshot in the handoff; DEC identity must match Technology.xml</Item>
    </Decisions>

    <Contracts>
      <ModuleContracts count=">=1 per impacted module"/>
      <FunctionContracts count=">=1 per impacted use case"/>
      <BlockAnchors count=">=1 per critical function block"/>
      <TestCases count=">=3-4 per critical FC (or justify fewer)"/>
    </Contracts>

    <Handoff>
      <GRACE_HANDOFF required="true"/>
    </Handoff>
  </RequiredOutputs>

  <AcceptanceCriteria>
    <Item>Canonical artifacts contain no "OR" choices; alternatives captured as Decisions</Item>
    <Item>DEC-* are consistent and linkable across artifacts and handoff snapshot</Item>
    <Item>Traceability: UC -> Flow -> FC/MC -> BA -> TC is complete for this task</Item>
    <Item>No cross-service joins; DB per service</Item>
    <Item>If any Decision is PENDING_HUMAN, it is explicitly flagged and scope avoids coding until resolved</Item>
  </AcceptanceCriteria>
</ARCHITECT_WORK_ORDER>
```

### 2) Coder Work Order (Approval Required)
Use ONLY if:
- A specific handoff exists AND
- A valid approval entry exists in approvals.log for that handoff ref AND
- All blocking decisions/versions are resolved (no PENDING_HUMAN/TBD that blocks scope)

Creating CWO-YYYYMMDD-##.xml file in the directory docs/grace/cwo with the following content:

```xml
<CODER_WORK_ORDER id="CWO-YYYYMMDD-##" status="PROPOSED">
  <Preconditions>
    <Item>Handoff exists: <GRACE_HANDOFF id="Handoff-YYYYMMDD-##[-suffix]" .../></Item>
    <Item>Valid approval exists in docs/grace/approvals.log for the same ref</Item>
    <Item>A BranchSpec (BRANCH_SPEC) is included in this work order and must be followed verbatim</Item>
    <Item>All referenced artifact sections and contract IDs are provided in this work order</Item>
    <Item>No blocking PENDING_HUMAN/TBD decisions for in-scope implementation</Item>
    <Item>If this work order follows repeated failed retries, include a W11 failure envelope reference and forced-context bundle reference</Item>
    <Item>Human-readable code is mandatory: prefer clarity over cleverness; refactor oversized methods/classes; avoid deep nesting</Item>
    <Item>Error handling must be domain-focused and consistent across the module</Item>
    <Item>No mapper duplication: extract shared mapping functions/utilities</Item>
  </Preconditions>

  <Scope>
    <HandoffRef>Handoff-YYYYMMDD-##[-suffix]</HandoffRef>
    <BranchSpecRef>BS-YYYYMMDD-##</BranchSpecRef>
    <Services>
      <ServiceRef ref="DP-SVC-..."/>
    </Services>
    <UseCases>
      <UseCaseRef ref="UC-..."/>
    </UseCases>
    <Contracts>
      <ModuleContractRef id="MC-..."/>
      <FunctionContractRef id="FC-..."/>
      <BlockAnchorRef id="BA-..."/>
      <TestCaseRef id="TC-..."/>
    </Contracts>
  </Scope>

  <ImplementationRules>
    <Item>No new endpoints/events/services beyond the approved handoff scope</Item>
    <Item>Embed semantic contracts verbatim (IDs unchanged)</Item>
    <Item>Logs must follow canonical format and reference BA anchors</Item>
    <Item>Implement tests matching all referenced TC-* cases</Item>
    <Item>Respect hexagonal layering (domain free of Spring/JPA/etc.)</Item>
    <Item>No cross-service join logic introduced</Item>
    <Item>Use Technology.xml decisions only (no alternative stacks)</Item>
    <Item>If a W11 forced-context bundle is attached, coder must read it before proposing another fix in the same semantic scope</Item>
  </ImplementationRules>

  <RequiredOutputs>
    <Item>FilePlan (paths + purpose) then code by file path</Item>
    <Item>Tests + migrations/config (if in scope)</Item>
    <Item>ConsistencyChecklist (self-audit vs scope + contracts)</Item>
    <Item>GitExecutionSteps: exact git/gh commands executed (in order) + resulting branch/PR identifiers</Item>
    <Item>PR link + CI status summary</Item>
  </RequiredOutputs>
</CODER_WORK_ORDER>
```

Notes
-Work orders must be self-contained: include needed excerpts or require explicit file paths and IDs.
-Never issue CWO without Approval + BranchSpec.
