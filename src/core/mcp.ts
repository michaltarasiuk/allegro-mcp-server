import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SetLevelRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { config } from "../config/env.js";
import { getLowLevelServer } from "../shared/mcp/server-internals.js";
import { registerPrompts } from "../shared/prompts/index.js";
import { registerResources } from "../shared/resources/index.js";
import {
  type ContextResolver,
  registerTools,
} from "../shared/tools/registry.js";
import { logger } from "../shared/utils/logger.js";
import { buildCapabilities } from "./capabilities.js";

export interface ServerOptions {
  name: string;
  version: string;
  instructions?: string;
  oninitialized?: () => void;
  contextResolver?: ContextResolver;
}

export function buildServer(options: ServerOptions) {
  const { name, version, instructions, oninitialized, contextResolver } =
    options;
  const server = new McpServer(
    { name, version },
    {
      capabilities: buildCapabilities(),
      instructions: instructions ?? config.MCP_INSTRUCTIONS,
    }
  );
  const lowLevel = getLowLevelServer(server);
  if (oninitialized) {
    lowLevel.oninitialized = () => {
      logger.info("mcp", {
        message:
          "Client initialization complete (notifications/initialized received)",
        clientVersion: lowLevel.getClientVersion?.(),
      });
      oninitialized();
    };
  }

  registerTools(server, contextResolver);
  registerPrompts(server);
  registerResources(server);
  server.server.setRequestHandler(SetLevelRequestSchema, (request) => {
    const level = request.params.level;
    logger.info("mcp", { message: "Log level changed", level });
    return {};
  });
  return server;
}
