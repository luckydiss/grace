---
name: coordinator-anti-loop-gate
description: Enforces retry budgets, forced-context loading, and failure-memory reuse for repeated autonomous remediation attempts.
---

# Skill: coordinator-anti-loop-gate

## Purpose
Block autonomous agents from looping on the same failed remediation path and force a context regime change before retries continue.

## Trigger
Use when:
- the same test or error signature fails repeatedly
- the same `FC` or `BA` is being changed in multiple failed attempts
- an autonomous fix flow needs a bounded retry policy

## Gate Checks

### Gate 1: Retry Budget (BLOCKING)
- Count attempts by semantic scope plus error signature.
- If the configured retry budget is exhausted, block direct fixes.

### Gate 2: Repeated Fix Pattern (BLOCKING)
- If a newly proposed remediation matches a previously rejected fix pattern, block it immediately.

### Gate 3: Forced Context Loaded (BLOCKING)
- After the retry threshold, require explicit evidence that a forced context bundle was loaded.
- If the agent cannot name the injected context bundle, fail the gate.

### Gate 4: Failure-Memory Reuse (BLOCKING)
- Require reuse of any verified recovery or relevant rejected fix data tied to the same test id or semantic scope.

## PASS Output
- CoordinatorChecks: ANTI_LOOP PASS
- Retry state is bounded and the correct context regime has been applied.

## FAIL Output
- CoordinatorChecks: ANTI_LOOP FAIL
- Produce an issue report listing:
  - retry count
  - semantic scope
  - error signature
  - missing forced context or repeated rejected fix
  - required next action

## Required Next Actions
- force diagnosis
- inject historical context
- route to Architect
- escalate to human
