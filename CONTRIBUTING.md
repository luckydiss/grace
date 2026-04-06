# Contributing

## Local setup

Use Node.js 24 or newer for the root package and run `npm ci` at the repository root.
For the MCP package, run `npm --prefix mcp ci` as well so its own lockfile is installed.

## Day-to-day workflow

Run `npm test` for the root package, `npm run validate` for framework checks, and `npm --prefix mcp test` for the MCP package.
Use `npm run coverage` when you want the built-in Node test coverage report without extra dependencies.

## Change rules

Keep changes small and deterministic.
Do not add new runtime dependencies unless they are required by code that already imports them.
Prefer adjusting scripts and tests before changing runtime behavior.
