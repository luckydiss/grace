---
name: protocol-grace-runtime-logging
description: Canonical GRACE protocol for belief-state runtime logging with semantic correlation tokens.
---

# Skill: protocol-grace-runtime-logging

## Purpose
Apply GRACE runtime logging as a belief-state declaration tied to semantic anchors.

## MANDATORY RULES
- Critical runtime logs must correlate to `mc`, `fc`, and when applicable `ba`.
- `belief` captures the implementation hypothesis.
- `fact` captures the observable ground truth.
- Do not log secrets or raw PII.

## Authoring heuristics
- Prefer one coherent belief per anchor-sized block.
- Duplicate high-signal semantic ids in structured fields and natural-language belief text when helpful for retrieval.
- During debugging, navigate from `ba` or `fc` back to code before proposing a fix.
