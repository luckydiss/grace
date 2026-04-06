# ADR 0001: Workflow Lifecycle And Legacy Dry-Run

Status: Accepted

## Context

The original workflow graph stopped at `READY_FOR_RELEASE`, while the state machine already defined `DELIVERED` and `ARCHIVED`.
Legacy onboarding also proposed slices without forcing a bounded dry-run edit check inside the graph.

## Decision

- The happy-path workflow now advances through `READY_FOR_RELEASE -> DELIVERED -> ARCHIVED`.
- Legacy onboarding now requires `LegacyEditDryRun.json` to be materialized before the evidence gate completes.
- Traceability and living-document failures in the coder path now route through `reject_coder_output -> split_scope_and_reissue_cwo`.

## Consequences

- The graph matches the declared state machine more closely.
- Delivery state is now durably visible in tests, CLI, and MCP handlers.
- Legacy onboarding has one more governed checkpoint before any real write authorization discussion.
