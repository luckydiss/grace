---
name: protocol-grace-traceability
description: Canonical GRACE protocol for maintaining the full traceability chain from requirements to runtime logs.
---

# Skill: protocol-grace-traceability

## Purpose
Enforce end-to-end traceability as a runtime discipline, not just a document property.

## Canonical chain
`UC -> Flow -> MC -> FC -> BA -> log`

## MANDATORY RULES
- Every critical path must remain navigable in both directions.
- No orphan semantic contract is acceptable on an approved path.
- When runtime evidence exists, prefer `BA` or `FC` tokens to correlate logs back to code.
- If a task mutates a critical path, verify the entire chain, not just the touched file.
