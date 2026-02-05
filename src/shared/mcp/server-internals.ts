import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

interface LowLevelServer {
  request?: (
    params: {
      method: string;
      params?: unknown;
    },
    schema?: {
      parse: (r: unknown) => unknown;
    }
  ) => Promise<unknown>;
  notification?: (params: {
    method: string;
    params?: unknown;
  }) => Promise<void>;
  setRequestHandler?: (
    method: string,
    handler: (request: unknown) => Promise<unknown>
  ) => void;
  getClientCapabilities?: () => ClientCapabilities;
  getClientVersion?: () => string;
  oninitialized?: () => void;
}

interface ClientCapabilities {
  roots?: {
    listChanged?: boolean;
  };
  sampling?: {
    tools?: boolean;
  };
  elicitation?: {
    form?: unknown;
    url?: boolean;
  };
  [key: string]: unknown;
}

interface McpServerWithInternals {
  server?: LowLevelServer;
  sendResourceUpdated?: (params: { uri: string }) => void;
}

export function getLowLevelServer(server: McpServer) {
  const extended = server as unknown as McpServerWithInternals;
  return (extended.server ?? server) as unknown as LowLevelServer;
}

export function getServerWithInternals(server: McpServer) {
  return server as unknown as McpServerWithInternals;
}

export interface JsonRpcError extends Error {
  code?: number;
  data?: unknown;
}

export function isJsonRpcError(
  error: unknown,
  code?: number
): error is JsonRpcError {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const err = error as JsonRpcError;
  if (typeof err.code !== "number") {
    return false;
  }
  if (code !== undefined && err.code !== code) {
    return false;
  }
  return true;
}

export const JSON_RPC_METHOD_NOT_FOUND = -32_601;
