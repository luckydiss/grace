# GRACE Framework

GRACE is a framework-first runtime for governed AI-assisted development. It combines a deterministic workflow graph, bounded agent execution, evidence-based validation, and an MCP surface for IDE integration.

## Why it exists

The project is built to keep AI work auditable and predictable. The workflow is state-driven, transitions are policy-guarded, and every important step emits durable evidence.

## Framework-first layout

The repository is organized around the framework itself, not around one sample product.

- `src/` contains the core runtime, state machine, policies, validators, agents, and CLI adapters.
- `tools/` contains standalone framework utilities for validation, traceability, and evidence generation.
- `mcp/` contains the MCP server package and its HTTP transport.
- `docs/grace/` contains the living framework documents, schemas, and policy files.
- `agents/` contains role prompts, skills, and execution templates.

## Skill-first runtime

GRACE is skill-first. Agent roles do not rely on hidden prompt behavior; they load explicit skills, bounded execution windows, and traceable execution artifacts.

The main roles are:

- `Architect`
- `Coordinator`
- `Coder`

Each role runs inside a narrow contract surface and leaves execution evidence behind.

## Examples

Typical local commands:

```bash
npm ci
npm test
npm run validate
npm run coverage
npm --prefix mcp ci
npm --prefix mcp test
```

Workflow examples:

- Start a workflow with `npm run workflow:start`
- Resume a workflow with `npm run workflow:resume`
- Generate traceability evidence with the `tools/` scripts

## Validation

The framework ships with validators for workflow state, transition evidence, living documents, policy/schema consistency, and agent evidence. The goal is to fail closed when workflow rules or documentation drift.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for local setup and change rules.

