
# Skill: coordinator-code-gates

## Purpose
Validate Coder outputs against scope, layering, contracts, logging, tests, and BranchSpec compliance.

## Trigger
Use when Coder returns:
- implementation code/tests/config/migrations
- GitExecutionSteps
- PR info

## Gates (PASS/FAIL)
### Gate 1: Scope & Determinism (BLOCKING)
- no new endpoints/events/services beyond approved handoff scope
- IDs preserved (UC/DP-SVC/MC/FC/BA/TC unchanged)
- no implementation for PENDING_HUMAN/TBD-dependent features

### Gate 2: Hexagonal/DDD Layering (BLOCKING)
- domain and application do NOT depend on adapters/bootstrap
- forbidden imports/annotations do not appear in domain/application
- @Transactional only in application services (or tx layer)
- Boundaries respected (domain free of Spring/JPA/etc.)
- controllers/listeners contain no business logic and call in-ports only

### Gate 3: Contracts & Observability (BLOCKING)
- contracts embedded verbatim where required
- logs follow canonical pattern and reference BA anchors
- correlation/trace fields handled as per contracts (or issue raised)

### Gate 4: Tests (BLOCKING for in-scope critical paths)
- TC-* cases implemented as tests
- failing/omitted tests explained only if explicitly allowed by scope (otherwise FAIL)

### Gate 5: Readability & Clean-Code (BLOCKING)
- no oversized methods/classes; minimal nesting
- consistent domain error strategy (no generic exceptions for domain failures)
- no mapper duplication (shared mapping utilities exist)
- magic numbers policy respected

### Gate 6: Git Compliance (BLOCKING)
- BranchSpec followed verbatim (branch name/base/PR target/merge method)
- no direct pushes to main/develop
- no force-push
- if release/hotfix to main: back-merge PR to develop exists (or explicit block)

### Gate 7: W11 Autonomy Stability (BLOCKING for repeated remediation)
- if the same semantic scope has repeated failed retries, a failure envelope reference is present
- a forced-context bundle is attached or referenced
- coder output does not repeat a previously rejected fix pattern without new evidence
- coordinator can reproduce the loop-guard verdict for the retry state

### GRACE Scaffolding Gate (Coordinator-Enforced) -- BLOCKING

For every PR that touches a service/module, verify:

1) MODULE_MAP:
   - Each affected service has bootstrap/package-info.java with MODULE_MAP:
     <svc>/src/main/java/com/<org>/<svc>/bootstrap/package-info.java
   - MODULE_MAP reflects real aggregates/use cases/ports/adapters impacted by the change.
   - For complex services: layer package-info.java maps exist when changes span multiple layers
     (domain/application/adapters).

2) MODULE_CONTRACT:
   - Key changed classes include MODULE_CONTRACT at file top and accurately reflect boundaries:
     - domain aggregate root / domain policy if applicable
     - application use-case interactor
     - adapter boundary implementations (web/listener/persistence/external)

3) FUNCTION_CONTRACT:
   - Critical new/changed methods have FUNCTION_CONTRACT immediately above them.
   - No FUNCTION_CONTRACT added to trivial getters/setters or one-line pass-through methods.

4) BLOCK_ANCHOR + logs:
   - Critical methods include BLOCK_ANCHOR inline comments above meaningful blocks.
   - FUNCTION_CONTRACT lists the BA ids under <BLOCK_ANCHORS>.
   - Logs (or contract log examples) include [SVC][UC][BLOCK][STATE] and reference BA ids.
   - Navigation must work: Log -> BA -> FC -> MC -> UC.

5) Integrity:
   - IDs follow MM/MC/FC/BA conventions and are stable (no renames without blueprint).
   - LINKS resolve to RequirementsAnalysis.xml#UC-..., DevelopmentPlan.xml#DP-SVC-..., Flow-* where relevant.
   - Domain remains framework-free and hexagonal direction is preserved.

Reject or request changes if:
- MODULE_MAP missing for a touched service,
- critical functions lack BLOCK_ANCHORs,
- logs do not reference BA anchors for critical steps,
- domain uses framework types,
- contracts have broken/missing LINKS or unstable renamed IDs,
- repeated remediation proceeds without W11 envelope/context evidence.

If any fail produce a CodeIssueReport-YYYYMMDD-##.xml file in the docs/grace/reports/code-issue:

## FAIL Output -> CodeIssueReport
```xml
<CodeIssueReport id="CODE-RPT-YYYYMMDD-##">
  <Issue id="ISS-...">
    <Severity>BLOCKING|NONBLOCKING</Severity>
    <Description>...</Description>
    <Evidence>File path / diff excerpt reference...</Evidence>
    <Impact>...</Impact>
    <ProposedFix>...</ProposedFix>
    <RequiredAgent>GRACE-CODER|GRACE-ARCHITECT</RequiredAgent>
  </Issue>
</CodeIssueReport>
```
