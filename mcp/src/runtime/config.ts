export const GRACE_MCP_SERVER_VERSION = "0.1.0";
export const GRACE_MCP_PROTOCOL_VERSION = "2026-04-05";
export const GRACE_MCP_PROTOCOL_VERSION_HEADER = "x-grace-mcp-protocol-version";
export const GRACE_MCP_SERVER_VERSION_HEADER = "x-grace-mcp-server-version";
export const GRACE_MCP_SERVER_NAME_HEADER = "x-grace-mcp-server-name";

export interface GraceMcpRuntimeConfig {
  serverName: string;
  serverVersion: string;
  protocolVersion: string;
  authToken: string | null;
  corsAllowedOrigins: string[];
  corsAllowCredentials: boolean;
  requireVersionHeader: boolean;
  maxBodyBytes: number;
  rateLimitPerMinute: number;
  requestTimeoutMs: number;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  return value === "1" || value.toLowerCase() === "true";
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseCsv(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function resolveGraceMcpRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): GraceMcpRuntimeConfig {
  const authToken = env.GRACE_MCP_AUTH_TOKEN?.trim();
  return {
    serverName: "grace-mcp",
    serverVersion: env.GRACE_MCP_SERVER_VERSION?.trim() || GRACE_MCP_SERVER_VERSION,
    protocolVersion: env.GRACE_MCP_PROTOCOL_VERSION?.trim() || GRACE_MCP_PROTOCOL_VERSION,
    authToken: authToken && authToken.length > 0 ? authToken : null,
    corsAllowedOrigins: parseCsv(env.GRACE_MCP_CORS_ALLOWED_ORIGINS),
    corsAllowCredentials: parseBoolean(env.GRACE_MCP_CORS_ALLOW_CREDENTIALS, false),
    requireVersionHeader: parseBoolean(env.GRACE_MCP_REQUIRE_VERSION_HEADER, false),
    maxBodyBytes: parsePositiveInteger(env.GRACE_MCP_MAX_BODY_BYTES, 1_048_576),
    rateLimitPerMinute: parsePositiveInteger(env.GRACE_MCP_RATE_LIMIT_PER_MINUTE, 60),
    requestTimeoutMs: parsePositiveInteger(env.GRACE_MCP_REQUEST_TIMEOUT_MS, 30_000),
  };
}
