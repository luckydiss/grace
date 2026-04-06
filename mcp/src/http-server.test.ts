import assert from "node:assert/strict";
import test from "node:test";
import { buildGraceMcpHttpApp, resolveHttpPort, startGraceMcpHttpServer } from "./http-server.js";
import { resolveGraceMcpRuntimeConfig } from "./runtime/config.js";

test("grace-mcp builds an HTTP app without starting the server on import", () => {
  const app = buildGraceMcpHttpApp();
  assert.ok(app);
});

test("grace-mcp resolves HTTP port deterministically", () => {
  assert.equal(resolveHttpPort("3100"), 3100);
  assert.equal(resolveHttpPort("0"), 3001);
  assert.equal(resolveHttpPort(undefined), 3001);
});

test("grace-mcp HTTP server exposes /mcp and rejects unsupported GET", async () => {
  const server = await startGraceMcpHttpServer(0);
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/mcp`);
    const body = await response.text();
    assert.equal(response.status, 405);
    assert.match(body, /Method not allowed/u);
    assert.equal(response.headers.get("x-grace-mcp-server-name"), "grace-mcp");
  } finally {
    await server.close();
  }
});

test("grace-mcp HTTP server enforces bearer auth when configured", async () => {
  const server = await startGraceMcpHttpServer(
    0,
    resolveGraceMcpRuntimeConfig({
      GRACE_MCP_AUTH_TOKEN: "secret-token",
    }),
  );
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const body = await response.text();
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("www-authenticate"), 'Bearer realm="grace-mcp"');
    assert.match(body, /Unauthorized/u);
  } finally {
    await server.close();
  }
});

test("grace-mcp HTTP server can require protocol version headers", async () => {
  const config = resolveGraceMcpRuntimeConfig({
    GRACE_MCP_REQUIRE_VERSION_HEADER: "true",
  });
  const server = await startGraceMcpHttpServer(0, config);
  try {
    const missingResponse = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(missingResponse.status, 428);

    const mismatchResponse = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-grace-mcp-protocol-version": "1999-01-01",
      },
      body: "{}",
    });
    const mismatchBody = await mismatchResponse.text();
    assert.equal(mismatchResponse.status, 400);
    assert.match(mismatchBody, /Protocol version mismatch/u);
  } finally {
    await server.close();
  }
});

test("grace-mcp HTTP server rejects oversized bodies before MCP handling", async () => {
  const server = await startGraceMcpHttpServer(
    0,
    resolveGraceMcpRuntimeConfig({
      GRACE_MCP_MAX_BODY_BYTES: "8",
    }),
  );
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"oversized":true}',
    });
    const body = await response.text();
    assert.equal(response.status, 413);
    assert.match(body, /Request body too large/u);
  } finally {
    await server.close();
  }
});

test("grace-mcp HTTP server rate limits repeated MCP requests", async () => {
  const config = resolveGraceMcpRuntimeConfig({
    GRACE_MCP_RATE_LIMIT_PER_MINUTE: "1",
  });
  const server = await startGraceMcpHttpServer(0, config);
  try {
    const headers = {
      "content-type": "application/json",
      "x-grace-mcp-protocol-version": config.protocolVersion,
    };
    await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: "POST",
      headers,
      body: "{}",
    });

    const limited = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: "POST",
      headers,
      body: "{}",
    });
    const body = await limited.text();
    assert.equal(limited.status, 429);
    assert.match(body, /Rate limit exceeded/u);
  } finally {
    await server.close();
  }
});
