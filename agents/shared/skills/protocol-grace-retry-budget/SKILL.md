---
name: protocol-grace-retry-budget
description: Canonical GRACE protocol for bounded autonomous retries, repeated-failure detection, and deterministic escalation after failed remediation attempts.
---

# Skill: protocol-grace-retry-budget

## Purpose
Prevent autonomous agents from looping indefinitely on the same failed remediation path.

## MANDATORY RULES
- Track retry attempts by semantic scope plus error signature, not by raw process iteration alone.
- Use explicit retry budgets for each remediation mode:
  - direct fix attempt
  - diagnosis-only iteration
  - forced-context retry
- If the same semantic scope and error signature keeps failing, escalate instead of repeating the same style of fix.
- Repeating a previously rejected fix pattern counts against the retry budget immediately.

## Escalation Ladder
1. direct fix
2. forced diagnosis
3. forced context injection
4. coordinator stop or human escalation

## Blocking Conditions
- Retry budget exhausted for the same semantic scope and error signature
- Same rejected fix pattern appears again
- New fix is proposed without reading the injected forced context
- Coordinator work order for repeated remediation is missing failure-envelope or forced-context references
