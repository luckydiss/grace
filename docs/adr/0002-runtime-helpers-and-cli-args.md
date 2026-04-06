# ADR 0002: Runtime Helpers And CLI Argument Parsing

Status: Accepted

## Context

`ensureParentDir`, structured runtime logging, and hand-rolled CLI parsing were duplicated across multiple modules.
This made refactors noisy and increased the chance of behavior drift.

## Decision

- Shared filesystem helpers live in `src/runtime/fs-utils.ts`.
- Shared structured logging lives in `src/runtime/runtime-log.ts`.
- `src/cli/args.ts` provides a minimal common argument cursor for the `src/cli/*` entrypoints.
- Workflow resume logic is split out of the main graph module into `src/graph/workflow-resume.ts`, with shared graph helpers in `src/graph/workflow-runtime.ts`.

## Consequences

- The main workflow module is smaller and easier to reason about.
- CLI entrypoints keep the same external interface while reducing parser duplication.
- Further cleanup can migrate remaining `tools/*` scripts onto the same helper style incrementally.
