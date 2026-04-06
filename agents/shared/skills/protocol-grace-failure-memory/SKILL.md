---
name: protocol-grace-failure-memory
description: Canonical GRACE protocol for accumulating and reusing failure-memory records keyed by semantic coordinates, tests, and error signatures.
---

# Skill: protocol-grace-failure-memory

## Purpose
Turn repeated break-fix history into a governed knowledge surface for autonomous remediation.

## Failure-Memory Record
- `semanticScope`: `UC`, `MC`, `FC`, `BA`
- `testId`
- `errorSignature`
- `failedHypothesis`
- `rejectedFixPattern`
- `verifiedRecovery`
- `evidenceRefs`

## MANDATORY RULES
- Record rejected fixes separately from verified recoveries.
- Link each record to semantic coordinates and, when available, concrete test ids.
- Reuse verified recoveries as preferred context.
- Treat previously rejected fix patterns as negative context that must be surfaced during retries.

## Governance
- Failure-memory is a canonical support surface for retries, not informal notes.
- If no memory exists yet, create a placeholder gap instead of pretending prior knowledge exists.
