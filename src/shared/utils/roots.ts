import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  getLowLevelServer,
  isJsonRpcError,
  JSON_RPC_METHOD_NOT_FOUND,
} from "../mcp/server-internals.js";
import { logger } from "./logger.js";

export interface Root {
  uri: string;
  name?: string;
  _meta?: Record<string, unknown>;
}

export interface ListRootsResult {
  roots: Root[];
}

export async function requestRoots(server: McpServer) {
  logger.debug("roots", {
    message: "Requesting roots from client",
  });
  try {
    const lowLevel = getLowLevelServer(server);
    if (!lowLevel.request) {
      throw new Error(
        "Roots not supported: Server does not support client requests"
      );
    }
    const clientCapabilities = lowLevel.getClientCapabilities?.() ?? {};
    if (!clientCapabilities.roots) {
      throw new Error(
        "Client does not support roots capability. " +
          'Client must declare "roots" capability to list filesystem roots.'
      );
    }
    const response = (await lowLevel.request({
      method: "roots/list",
    })) as ListRootsResult;
    logger.info("roots", {
      message: "Received roots from client",
      rootCount: response.roots.length,
    });
    return response.roots;
  } catch (error) {
    logger.error("roots", {
      message: "Roots request failed",
      error: (error as Error).message,
    });
    if (isJsonRpcError(error, JSON_RPC_METHOD_NOT_FOUND)) {
      throw new Error(
        'Roots not supported by client. Client must declare "roots" capability.'
      );
    }
    throw error;
  }
}

export function clientSupportsRoots(server: McpServer) {
  try {
    const lowLevel = getLowLevelServer(server);
    const clientCapabilities = lowLevel.getClientCapabilities?.() ?? {};
    return Boolean(clientCapabilities.roots);
  } catch {
    return false;
  }
}

export function clientSupportsRootsListChanged(server: McpServer) {
  try {
    const lowLevel = getLowLevelServer(server);
    const clientCapabilities = lowLevel.getClientCapabilities?.() ?? {};
    const roots = clientCapabilities.roots as
      | {
          listChanged?: boolean;
        }
      | undefined;
    return Boolean(roots?.listChanged);
  } catch {
    return false;
  }
}
