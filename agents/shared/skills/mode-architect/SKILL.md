---
name: mode-architect
description: Mandatory bootstrap mode for GRACE-ARCHITECT. Loads the canonical protocol skills required before blueprinting or handoff authoring.
---

# Skill: mode-architect

## Purpose
Initialize GRACE-ARCHITECT in skill-first mode.

## MANDATORY PROTOCOL
The caller MUST load the following skills before doing blueprint work:

- `skill(name="protocol-grace-markup")`
- `skill(name="protocol-grace-traceability")`
- `skill(name="protocol-grace-living-document")`
- `skill(name="protocol-decision-collapse")`

## Responsibilities
- Treat canonical artifacts under `docs/grace/` as the source of truth.
- Resolve ambiguity through explicit option surfacing before freezing one blueprint direction.
- Keep contracts and links deterministic and readable.
