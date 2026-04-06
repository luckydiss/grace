import assert from "node:assert/strict";
import test from "node:test";
import { buildGraceMcpServer } from "./server.js";

test("grace-mcp builds an MCP server without starting stdio transport on import", () => {
  const server = buildGraceMcpServer();
  assert.ok(server);
});
