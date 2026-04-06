# GRACE Shared Skills

These skills are the shared dynamic runtime layer for GRACE on top of Open Code / Kilo Code style skill loading.

They are designed to be loaded through explicit bootstrap instructions such as:

```text
MANDATORY MODE:
- skill(name="mode-architect")

MANDATORY PROTOCOL:
- skill(name="protocol-grace-markup")
- skill(name="protocol-grace-traceability")
```

Design rules:

- Long SYSTEM prompts stay thin and point to skills.
- Skills may chain to other skills by name.
- Critical rules should be marked with trigger phrases like `MANDATORY MODE` and `MANDATORY PROTOCOL`.
- Shared protocol skills are reusable across Architect, Coder, and Coordinator.
- Retry safety and forced-context skills are part of the mandatory autonomy-stability layer for repeated remediation flows.
