import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { SERVER_METADATA } from "../../config/metadata.js";
import { buildCapabilities } from "../../core/capabilities.js";
import { executeSharedTool, sharedTools } from "../tools/registry.js";
import type { ToolContext } from "../tools/types.js";
import { sharedLogger as logger } from "../utils/logger.js";

export const LATEST_PROTOCOL_VERSION = "2025-06-18";

export const SUPPORTED_PROTOCOL_VERSIONS = [
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
  "2024-10-07",
];

export const JsonRpcErrorCode = {
  ParseError: -32_700,
  InvalidRequest: -32_600,
  MethodNotFound: -32_601,
  InvalidParams: -32_602,
  InternalError: -32_603,
} as const;

export interface McpServerConfig {
  title: string;
  version: string;
  instructions?: string;
}

export interface McpSessionState {
  initialized: boolean;
  clientInfo?: {
    name: string;
    version: string;
  };
  protocolVersion?: string;
}

export type CancellationRegistry = Map<string | number, AbortController>;

export interface McpDispatchContext {
  sessionId: string;
  auth: ToolContext;
  config: McpServerConfig;
  getSessionState: () => McpSessionState | undefined;
  setSessionState: (state: McpSessionState) => void;
  cancellationRegistry?: CancellationRegistry;
}

export interface JsonRpcResult {
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

function handleInitialize(
  params: Record<string, unknown> | undefined,
  ctx: McpDispatchContext
) {
  const clientInfo = params?.clientInfo as
    | {
        name: string;
        version: string;
      }
    | undefined;
  const requestedVersion = String(
    params?.protocolVersion || LATEST_PROTOCOL_VERSION
  );
  const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requestedVersion)
    ? requestedVersion
    : LATEST_PROTOCOL_VERSION;
  ctx.setSessionState({
    initialized: false,
    clientInfo,
    protocolVersion,
  });
  logger.info("mcp_dispatch", {
    message: "Initialize request",
    sessionId: ctx.sessionId,
    clientInfo,
    requestedVersion,
    negotiatedVersion: protocolVersion,
  });
  return {
    result: {
      protocolVersion,
      capabilities: buildCapabilities(),
      serverInfo: {
        name: ctx.config.title || SERVER_METADATA.title,
        version: ctx.config.version || "1.0.0",
      },
      instructions: ctx.config.instructions || SERVER_METADATA.instructions,
    },
  };
}

function handleToolsList() {
  const tools = sharedTools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: zodToJsonSchema(tool.inputSchema),
    ...(tool.outputSchema && {
      outputSchema: zodToJsonSchema(z.object(tool.outputSchema)),
    }),
    ...(tool.annotations && { annotations: tool.annotations }),
  }));
  return { result: { tools } };
}

async function handleToolsCall(
  params: Record<string, unknown> | undefined,
  ctx: McpDispatchContext,
  requestId?: string | number
) {
  const toolName = String(params?.name || "");
  const toolArgs = (params?.arguments || {}) as Record<string, unknown>;
  const meta = params?._meta as
    | {
        progressToken?: string | number;
      }
    | undefined;
  const abortController = new AbortController();
  if (requestId !== undefined && ctx.cancellationRegistry) {
    ctx.cancellationRegistry.set(requestId, abortController);
  }
  const toolContext: ToolContext = {
    ...ctx.auth,
    sessionId: ctx.sessionId,
    signal: abortController.signal,
    meta: {
      progressToken: meta?.progressToken,
      requestId: requestId !== undefined ? String(requestId) : undefined,
    },
  };
  logger.debug("mcp_dispatch", {
    message: "Calling tool",
    tool: toolName,
    sessionId: ctx.sessionId,
    requestId,
    hasProviderToken: Boolean(ctx.auth.providerToken),
  });
  try {
    const result = await executeSharedTool(toolName, toolArgs, toolContext);
    return { result };
  } catch (error) {
    if (abortController.signal.aborted) {
      logger.info("mcp_dispatch", {
        message: "Tool execution cancelled",
        tool: toolName,
        requestId,
      });
      return {
        error: {
          code: JsonRpcErrorCode.InternalError,
          message: "Request was cancelled",
        },
      };
    }
    logger.error("mcp_dispatch", {
      message: "Tool execution failed",
      tool: toolName,
      error: (error as Error).message,
    });
    return {
      error: {
        code: JsonRpcErrorCode.InternalError,
        message: `Tool execution failed: ${(error as Error).message}`,
      },
    };
  } finally {
    if (requestId !== undefined && ctx.cancellationRegistry) {
      ctx.cancellationRegistry.delete(requestId);
    }
  }
}

function handleResourcesList() {
  return { result: { resources: [] } };
}

function handleResourcesTemplatesList() {
  return { result: { resourceTemplates: [] } };
}

function handlePromptsList() {
  return { result: { prompts: [] } };
}

function handlePing() {
  return { result: {} };
}

let currentLogLevel:
  | "debug"
  | "info"
  | "notice"
  | "warning"
  | "error"
  | "critical"
  | "alert"
  | "emergency" = "info";

function handleLoggingSetLevel(params: Record<string, unknown> | undefined) {
  const level = params?.level as string | undefined;
  const validLevels = [
    "debug",
    "info",
    "notice",
    "warning",
    "error",
    "critical",
    "alert",
    "emergency",
  ];
  if (!(level && validLevels.includes(level))) {
    return {
      error: {
        code: JsonRpcErrorCode.InvalidParams,
        message: `Invalid log level. Must be one of: ${validLevels.join(", ")}`,
      },
    };
  }
  currentLogLevel = level as typeof currentLogLevel;
  logger.info("mcp_dispatch", {
    message: "Log level changed",
    level: currentLogLevel,
  });
  return { result: {} };
}

export function getLogLevel() {
  return currentLogLevel;
}

export async function dispatchMcpMethod(
  method: string | undefined,
  params: Record<string, unknown> | undefined,
  ctx: McpDispatchContext,
  requestId?: string | number
) {
  if (!method) {
    return {
      error: {
        code: JsonRpcErrorCode.InvalidRequest,
        message: "Missing method",
      },
    };
  }

  switch (method) {
    case "initialize":
      return handleInitialize(params, ctx);
    case "tools/list":
      return handleToolsList();
    case "tools/call":
      return await handleToolsCall(params, ctx, requestId);
    case "resources/list":
      return handleResourcesList();
    case "resources/templates/list":
      return handleResourcesTemplatesList();
    case "prompts/list":
      return handlePromptsList();
    case "ping":
      return handlePing();
    case "logging/setLevel":
      return handleLoggingSetLevel(params);
    default:
      logger.debug("mcp_dispatch", { message: "Unknown method", method });
      return {
        error: {
          code: JsonRpcErrorCode.MethodNotFound,
          message: `Method not found: ${method}`,
        },
      };
  }
}

export interface CancelledNotificationParams {
  requestId: string | number;
  reason?: string;
}

export function handleMcpNotification(
  method: string,
  params: Record<string, unknown> | undefined,
  ctx: McpDispatchContext
) {
  if (method === "notifications/initialized") {
    const session = ctx.getSessionState();
    if (session) {
      ctx.setSessionState({ ...session, initialized: true });
    }
    logger.info("mcp_dispatch", {
      message: "Client initialized",
      sessionId: ctx.sessionId,
    });
    return true;
  }

  if (method === "notifications/cancelled") {
    const cancelParams = params as CancelledNotificationParams | undefined;
    const requestId = cancelParams?.requestId;
    if (requestId !== undefined && ctx.cancellationRegistry) {
      const controller = ctx.cancellationRegistry.get(requestId);
      if (controller) {
        logger.info("mcp_dispatch", {
          message: "Cancelling request",
          requestId,
          reason: cancelParams?.reason,
          sessionId: ctx.sessionId,
        });
        controller.abort(
          cancelParams?.reason ?? "Client requested cancellation"
        );
        return true;
      }
      logger.debug("mcp_dispatch", {
        message: "Cancellation request for unknown requestId",
        requestId,
        sessionId: ctx.sessionId,
      });
    }
    return true;
  }
  logger.debug("mcp_dispatch", {
    message: "Unhandled notification",
    method,
    sessionId: ctx.sessionId,
  });
  return false;
}
