---
name: protocol-grace-markup
description: Canonical protocol for reading and writing GRACE semantic markup, including graph-to-code navigation order and anchor discipline.
---

# Skill: protocol-grace-markup

## Purpose
Provide the canonical runtime protocol for semantic markup usage.

## MANDATORY RULES
- Read `docs/grace/GRACE_MARKUP_STANDARD.md` before relying on any local convention.
- Navigate top-down whenever possible:
  - graph or blueprint reference
  - module map / module contract
  - function contract
  - block anchor
- Do not treat line numbers as primary coordinates when anchor ids exist.
- Use stable ids (`MM-*`, `MC-*`, `FC-*`, `BA-*`) as semantic coordinates.

## Navigation order
1. Resolve in-scope `UC-*`, `Flow-*`, `DP-SVC-*`
2. Resolve `MC-*`
3. Resolve `FC-*`
4. Resolve `BA-*`
5. Only then inspect the owning code block
