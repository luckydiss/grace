# GRACE Templates

These files are the canonical bootstrap templates for a new GRACE product workspace.

Place them under:

- `docs/grace/RequirementsAnalysis.xml`
- `docs/grace/Technology.xml`
- `docs/grace/DevelopmentPlan.xml`
- `docs/grace/DevelopmentExecutionPlan.xml`
- `docs/grace/executions/*.xml`
- `docs/grace/approvals.log`
- `docs/grace/handoffs/*.xml`
- `docs/grace/cwo/*.xml`

Template placeholders:

- `grace-mcp`
- `^GRACE^ V2^ MCP^`

Requirements template note:

- `RequirementsAnalysis.xml` now bootstraps each critical use case with explicit `AAG` (`Actor`, `Action`, `Goal`) plus `Preconditions` and `SuccessOutcome` placeholders so new products start from the W8 governance baseline.

Skill-first bootstrap note:

- New products should keep agent bootstrap prompts thin and route critical behavior through shared skills.
- Use `MANDATORY MODE` and `MANDATORY PROTOCOL` sections in bootstrap prompts.
- Express critical loads explicitly through `skill(name="...")`.
- The canonical protocol set lives under `agents/shared/skills/` in the framework root and should be treated as the reusable runtime layer.

Autonomy-stability note:

- New products should wire post-failure test handling through the W11 cycle:
  - failure envelope
  - failure memory
  - forced context injection
  - loop guard
- The framework entrypoint for this is `tools/grace-autonomy-cycle.ts`.

Execution-proof note:

- New products should materialize role-level execution traces under `docs/grace/executions/`.
- Start from the canonical templates in `docs/grace/templates/executions/`.
- New products should also materialize one sidecar skill-trace JSON document per execution artifact under the same directory.
- The minimal critical chain for the current proof gate is:
  - `ArchitectExecution`
  - `CoordinatorExecution`
  - `CoderExecution`
  - `AutonomyCycleExecution`

Work-order note:

- New products should materialize coordinator-issued work orders under `docs/grace/cwo/`.
- Start from `docs/grace/templates/cwo/CoderWorkOrder.template.xml`.
- Trace-aware delivery proof is stronger when execution artifacts and W11 artifacts share the same `traceId` as the approved work order.

Delivery-trace note:

- New products should define one stable delivery trace id early, for example `TRACE-grace-mcp-CORE`.
- The same `traceId` should appear in:
  - handoffs
  - CWO or equivalent coordinator work orders
  - execution artifacts
  - failure-envelope / failure-memory / forced-context / loop-guard artifacts
- A product is stronger when this chain exists before the first large autonomous remediation cycle.
