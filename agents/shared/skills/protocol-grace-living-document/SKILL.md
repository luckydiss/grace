---
name: protocol-grace-living-document
description: Canonical GRACE protocol for synchronous updates of code, contracts, anchors, links, and logs after each semantic change.
---

# Skill: protocol-grace-living-document

## Purpose
Keep GRACE artifacts synchronized with implementation.

## MANDATORY RULES
- Stale semantic markup is worse than missing markup.
- When behavior changes, update the relevant `MC`, `FC`, `BA`, `Link`, and runtime logging expectations in the same change.
- Drift is blocking on approved or approval-seeking work.

## Minimum sync checklist
- contract ids still match the intended scope
- links still point to existing artifacts
- declared anchors still exist in code
- runtime logs still emit matching semantic coordinates
