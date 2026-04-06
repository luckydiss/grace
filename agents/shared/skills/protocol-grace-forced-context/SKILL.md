---
name: protocol-grace-forced-context
description: Canonical GRACE protocol for mandatory historical context injection after repeated failures in autonomous remediation workflows.
---

# Skill: protocol-grace-forced-context

## Purpose
Stabilize autonomous remediation by forcing the agent to read the specific historical knowledge it is least likely to reload voluntarily.

## MANDATORY RULES
- After the configured retry threshold, load a forced context bundle before any new remediation step.
- The bundle must contain:
  - failed hypotheses
  - rejected fixes
  - verified recoveries
  - semantic coordinates such as `UC`, `MC`, `FC`, `BA`
  - related test ids and error signatures
- A retry attempted without the forced context bundle is a protocol violation.

## Context Priority
1. exact semantic scope and exact error signature
2. same `FC` or `BA` with adjacent failure signatures
3. same `UC` flow with verified recovery patterns

## Output Discipline
- State which context bundle was loaded.
- Distinguish reused rejected fixes from reused verified recoveries.
- If the context bundle conflicts with the current hypothesis, stop and escalate instead of free-form improvisation.
