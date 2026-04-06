import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import type { NextFunction, Request, Response } from "express";
import { buildGraceMcpServer } from "./server.js";
import {
  GRACE_MCP_PROTOCOL_VERSION_HEADER,
  GRACE_MCP_SERVER_NAME_HEADER,
  GRACE_MCP_SERVER_VERSION_HEADER,
  resolveGraceMcpRuntimeConfig,
  type GraceMcpRuntimeConfig,
} from "./runtime/config.js";

interface RateLimitBucket {
  count: number;
  windowStartedAt: number;
}

interface GraceMcpHttpRuntime {
  app: ReturnType<typeof createMcpExpressApp>;
  close: () => Promise<void>;
}

function writeJsonRpcError(
  res: Response,
  status: number,
  code: number,
  message: string,
  data?: Record<string, unknown>,
): void {
  res.status(status).json({
    jsonrpc: "2.0",
    error: {
      code,
      message,
      ...(data ? { data } : {}),
    },
    id: null,
  });
}

function extractBearerToken(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed.toLowerCase().startsWith("bearer ")) {
    return null;
  }
  return trimmed.slice("bearer ".length).trim() || null;
}

function resolveCorsHeaders(
  runtimeConfig: GraceMcpRuntimeConfig,
  requestOrigin: string | undefined,
): Record<string, string> | null {
  if (!requestOrigin || runtimeConfig.corsAllowedOrigins.length === 0) {
    return null;
  }

  const allowAnyOrigin = runtimeConfig.corsAllowedOrigins.includes("*");
  const allowOrigin = allowAnyOrigin
    ? "*"
    : runtimeConfig.corsAllowedOrigins.includes(requestOrigin)
      ? requestOrigin
      : null;

  if (!allowOrigin) {
    return null;
  }

  const headers: Record<string, string> = {
    "access-control-allow-origin": allowOrigin,
    vary: "Origin",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers":
      "content-type, authorization, x-grace-mcp-protocol-version",
  };

  if (runtimeConfig.corsAllowCredentials && allowOrigin !== "*") {
    headers["access-control-allow-credentials"] = "true";
  }

  return headers;
}

function applyCorsHeaders(
  res: Response,
  runtimeConfig: GraceMcpRuntimeConfig,
  requestOrigin: string | undefined,
): boolean {
  const headers = resolveCorsHeaders(runtimeConfig, requestOrigin);
  if (!headers) {
    return false;
  }

  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }
  return true;
}

function buildRateLimiter(maxPerMinute: number) {
  const buckets = new Map<string, RateLimitBucket>();
  const windowMs = 60_000;
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || now - bucket.windowStartedAt >= windowMs) {
      buckets.set(key, { count: 1, windowStartedAt: now });
      next();
      return;
    }
    if (bucket.count >= maxPerMinute) {
      writeJsonRpcError(res, 429, -32029, "Rate limit exceeded", {
        limit: maxPerMinute,
        windowSeconds: 60,
      });
      return;
    }
    bucket.count += 1;
    next();
  };
}

function buildGraceMcpHttpRuntime(
  runtimeConfig: GraceMcpRuntimeConfig = resolveGraceMcpRuntimeConfig(),
): GraceMcpHttpRuntime {
  const app = createMcpExpressApp();
  const server = buildGraceMcpServer(runtimeConfig);
  const rateLimit = buildRateLimiter(runtimeConfig.rateLimitPerMinute);

  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader(GRACE_MCP_SERVER_NAME_HEADER, runtimeConfig.serverName);
    res.setHeader(GRACE_MCP_SERVER_VERSION_HEADER, runtimeConfig.serverVersion);
    res.setHeader(GRACE_MCP_PROTOCOL_VERSION_HEADER, runtimeConfig.protocolVersion);
    res.setHeader("cache-control", "no-store");
    next();
  });

  const enforceHttpContract = (req: Request, res: Response, next: NextFunction) => {
    const contentLengthHeader = req.header("content-length");
    if (contentLengthHeader) {
      const contentLength = Number(contentLengthHeader);
      if (Number.isFinite(contentLength) && contentLength > runtimeConfig.maxBodyBytes) {
        writeJsonRpcError(res, 413, -32013, "Request body too large", {
          maxBodyBytes: runtimeConfig.maxBodyBytes,
        });
        return;
      }
    }

    const requestedProtocolVersion = req.header(GRACE_MCP_PROTOCOL_VERSION_HEADER);
    if (!requestedProtocolVersion && runtimeConfig.requireVersionHeader) {
      writeJsonRpcError(res, 428, -32028, "Protocol version header is required", {
        header: GRACE_MCP_PROTOCOL_VERSION_HEADER,
        expected: runtimeConfig.protocolVersion,
      });
      return;
    }
    if (
      requestedProtocolVersion &&
      requestedProtocolVersion.trim() !== runtimeConfig.protocolVersion
    ) {
      writeJsonRpcError(res, 400, -32040, "Protocol version mismatch", {
        expected: runtimeConfig.protocolVersion,
        received: requestedProtocolVersion.trim(),
      });
      return;
    }

    if (runtimeConfig.authToken !== null) {
      const bearerToken = extractBearerToken(req.header("authorization"));
      if (bearerToken !== runtimeConfig.authToken) {
        res.setHeader("www-authenticate", 'Bearer realm="grace-mcp"');
        writeJsonRpcError(res, 401, -32001, "Unauthorized", {
          authRequired: true,
        });
        return;
      }
    }

    next();
  };

  app.options("/mcp", rateLimit, enforceHttpContract, (req: Request, res: Response) => {
    applyCorsHeaders(res, runtimeConfig, req.header("origin"));
    res.status(204).end();
  });

  app.post("/mcp", rateLimit, enforceHttpContract, async (req: Request, res: Response) => {
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      applyCorsHeaders(res, runtimeConfig, req.header("origin"));
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on("close", () => {
        void transport.close();
      });
    } catch (error) {
      console.error("GRACE_MCP_HTTP_ERROR", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error",
          },
          id: null,
        });
      }
    }
  });

  const methodNotAllowed = (req: Request, res: Response) => {
    applyCorsHeaders(res, runtimeConfig, req.header("origin"));
    res.writeHead(405).end(
      JSON.stringify({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Method not allowed.",
        },
        id: null,
      }),
    );
  };

  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  return {
    app,
    close: async () => {
      await server.close();
    },
  };
}

export function buildGraceMcpHttpApp(
  runtimeConfig: GraceMcpRuntimeConfig = resolveGraceMcpRuntimeConfig(),
) {
  return buildGraceMcpHttpRuntime(runtimeConfig).app;
}

export function resolveHttpPort(envPort: string | undefined): number {
  const parsed = Number(envPort);
  if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) {
    return parsed;
  }
  return 3001;
}

export async function startGraceMcpHttpServer(
  port = resolveHttpPort(process.env.PORT),
  runtimeConfig: GraceMcpRuntimeConfig = resolveGraceMcpRuntimeConfig(),
): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  const runtime = buildGraceMcpHttpRuntime(runtimeConfig);
  const { app } = runtime;
  const server = await new Promise<import("node:http").Server>((resolveServer, reject) => {
    const httpServer = app.listen(port, (error?: Error) => {
      if (error) {
        reject(error);
        return;
      }
      resolveServer(httpServer);
    });
    httpServer.setTimeout(runtimeConfig.requestTimeoutMs);
  });

  const actualPort = (server.address() as AddressInfo | null)?.port ?? port;
  return {
    port: actualPort,
    close: async () => {
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => {
          if (error) {
            rejectClose(error);
            return;
          }
          resolveClose();
        });
      });
      await runtime.close();
    },
  };
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return resolve(entry) === fileURLToPath(import.meta.url);
}

async function main(): Promise<void> {
  const { port } = await startGraceMcpHttpServer();
  console.log(`GRACE_MCP_HTTP_LISTENING port=${port}`);
}

if (isMainModule()) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
