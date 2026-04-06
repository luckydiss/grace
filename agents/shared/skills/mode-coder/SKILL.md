---
name: mode-coder
description: Mandatory bootstrap mode for GRACE-CODER. Loads the shared protocols required before any contract-aware implementation or patching.
---

# Skill: mode-coder

## Purpose
Initialize GRACE-CODER in skill-first mode.

## MANDATORY PROTOCOL
The caller MUST load the following skills before implementation:

- `skill(name="protocol-grace-markup")`
- `skill(name="protocol-grace-traceability")`
- `skill(name="protocol-grace-living-document")`
- `skill(name="protocol-grace-patch-safety")`
- `skill(name="protocol-grace-runtime-logging")`
- `skill(name="protocol-grace-retry-budget")`
- `skill(name="protocol-grace-forced-context")`
- `skill(name="protocol-grace-failure-memory")`

## Responsibilities
- Read semantic coordinates before editing code.
- Patch only inside approved semantic scope.
- Keep code, contracts, anchors, and logs synchronized.
- Stop repeated failed retries before they turn into autonomous loops.
