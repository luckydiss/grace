---
name: coordinator-branchspec-gitflow
description: Produces BRANCH_SPEC for Git operations based on GitFlow defaults and Architect GIT_IMPACT; forbids direct pushes to main/develop and force-push; ensures PR routing and back-merge rules.
---

## Purpose
Generate BranchSpec as the single operational instruction set for Coder git actions, consistent with GitFlow and Architect's <GIT_IMPACT/>.

## Trigger
Use when:
- blueprint is approved (approval v2 exists) and you are preparing implementation,
- user asks "what branch", "how to name PR", "what to do with git".

## Inputs
- Architect's `<GIT_IMPACT ...>` block (advisory)
- Approved handoff id and scope (DP-SVC/UC)
- GitFlow defaults (unless overridden via Tech/DP decisions)

## GitFlow Defaults
- feature/*, bugfix/*, chore/*: base develop -> PR target develop, merge method squash
- release/*, hotfix/*: PR target main, merge method merge-commit, MUST back-merge into develop

## Safety Rules (Hard)
- No direct pushes to main/develop
- No force-push
- One branch = one task scope (handoff scope)

## BranchSpec Template
```xml
<BRANCH_SPEC id="BS-YYYYMMDD-##" status="ISSUED">
  <ChangeClassification>feature|bugfix|chore|release|hotfix</ChangeClassification>
  <BranchName>feature/NA-short-slug</BranchName>
  <BaseBranch>develop|main</BaseBranch>
  <PRTarget>develop|main</PRTarget>
  <PreferredMergeMethod>squash|merge-commit</PreferredMergeMethod>
  <RequiresBackMergeToDevelop>true|false</RequiresBackMergeToDevelop>

  <PR>
    <TitleTemplate>[NA] short summary</TitleTemplate>
    <BodyMustInclude>
      <Item>HandoffRef: Handoff-YYYYMMDD-##[-suffix]</Item>
      <Item>Scope: DP-SVC-..., UC-...</Item>
      <Item>Contracts: MC/FC/BA/TC IDs</Item>
      <Item>RiskNotes (if any)</Item>
    </BodyMustInclude>
  </PR>

  <Safety>
    <Item>No direct pushes to main/develop</Item>
    <Item>No force-push</Item>
    <Item>Follow this BranchSpec verbatim</Item>
  </Safety>
</BRANCH_SPEC>
```

Mapping from <GIT_IMPACT> -> BranchSpec
- ChangeClassification maps directly
- BaseBranch/PRTarget follow GitFlow unless GIT_IMPACT explicitly differs
- RiskNotes copy into PR body requirements
