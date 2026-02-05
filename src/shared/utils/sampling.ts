import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  getLowLevelServer,
  isJsonRpcError,
  JSON_RPC_METHOD_NOT_FOUND,
} from "../mcp/server-internals.js";
import { logger } from "./logger.js";

export type SamplingContent =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "image";
      data: string;
      mimeType: string;
    }
  | {
      type: "audio";
      data: string;
      mimeType: string;
    };

export interface SamplingMessage {
  role: "user" | "assistant";
  content: SamplingContent;
}

export interface ModelPreferences {
  hints?: Array<{
    name: string;
  }>;
  costPriority?: number;
  speedPriority?: number;
  intelligencePriority?: number;
}

export interface ToolChoice {
  mode: "auto" | "required" | "none";
}

export interface SamplingTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface CreateMessageRequest {
  messages: SamplingMessage[];
  maxTokens: number;
  modelPreferences?: ModelPreferences;
  systemPrompt?: string;
  temperature?: number;
  stopSequences?: string[];
  metadata?: Record<string, unknown>;
  tools?: SamplingTool[];
  toolChoice?: ToolChoice;
}

export interface CreateMessageResponse {
  role: "assistant";
  content: SamplingContent;
  model: string;
  stopReason?: "endTurn" | "stopSequence" | "maxTokens";
}

export async function requestSampling(
  server: McpServer,
  request: CreateMessageRequest
) {
  logger.debug("sampling", {
    message: "Requesting LLM sampling from client",
    messageCount: request.messages.length,
    modelHints: request.modelPreferences?.hints?.map((h) => h.name),
    hasTools: !!request.tools,
    hasToolChoice: !!request.toolChoice,
  });
  try {
    const lowLevel = getLowLevelServer(server);
    if (!lowLevel.request) {
      throw new Error(
        "Sampling not supported: Server does not support client requests"
      );
    }
    if (request.tools || request.toolChoice) {
      const clientCapabilities = lowLevel.getClientCapabilities?.() ?? {};
      const sampling = clientCapabilities.sampling as
        | {
            tools?: boolean;
          }
        | undefined;
      if (!sampling?.tools) {
        throw new Error(
          "Client does not support sampling tools capability. " +
            'Client must declare "sampling.tools" to use tools or toolChoice.'
        );
      }
    }
    const response = (await lowLevel.request({
      method: "sampling/createMessage",
      params: {
        messages: request.messages,
        maxTokens: request.maxTokens,
        modelPreferences: request.modelPreferences,
        systemPrompt: request.systemPrompt,
        temperature: request.temperature,
        stopSequences: request.stopSequences,
        metadata: request.metadata,
        tools: request.tools,
        toolChoice: request.toolChoice,
      },
    })) as CreateMessageResponse;
    logger.info("sampling", {
      message: "Received LLM response from client",
      model: response.model,
      stopReason: response.stopReason,
    });
    return response;
  } catch (error) {
    logger.error("sampling", {
      message: "Sampling request failed",
      error: (error as Error).message,
    });
    if (isJsonRpcError(error, JSON_RPC_METHOD_NOT_FOUND)) {
      throw new Error(
        'Sampling not supported by client. Client must declare "sampling" capability.'
      );
    }
    throw error;
  }
}

export function clientSupportsSampling(server: McpServer) {
  try {
    const lowLevel = getLowLevelServer(server);
    const clientCapabilities = lowLevel.getClientCapabilities?.() ?? {};
    return Boolean(clientCapabilities.sampling);
  } catch {
    return false;
  }
}

export function clientSupportsSamplingTools(server: McpServer) {
  try {
    const lowLevel = getLowLevelServer(server);
    const clientCapabilities = lowLevel.getClientCapabilities?.() ?? {};
    const sampling = clientCapabilities.sampling as
      | {
          tools?: boolean;
        }
      | undefined;
    return Boolean(sampling?.tools);
  } catch {
    return false;
  }
}

export async function requestTextCompletion(
  server: McpServer,
  prompt: string,
  maxTokens: number,
  options?: Omit<CreateMessageRequest, "messages" | "maxTokens">
) {
  const response = await requestSampling(server, {
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: prompt,
        },
      },
    ],
    maxTokens,
    ...options,
  });
  if (response.content.type !== "text") {
    throw new Error(`Expected text response but got ${response.content.type}`);
  }
  return response.content.text;
}
