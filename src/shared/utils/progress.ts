import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getLowLevelServer } from "../mcp/server-internals.js";
import { logger } from "./logger.js";

export type ProgressToken = string | number;

export interface ProgressNotification {
  progressToken: ProgressToken;
  progress: number;
  total?: number;
  message?: string;
}

export class ProgressReporter {
  private completed = false;
  private readonly server: McpServer;
  private readonly progressToken: ProgressToken;
  constructor(server: McpServer, progressToken: ProgressToken) {
    this.server = server;
    this.progressToken = progressToken;
  }
  async report(progress: number, total?: number, message?: string) {
    if (this.completed) {
      logger.warning("progress", {
        message:
          "Attempted to send progress after completion - notification will be ignored",
        progressToken: this.progressToken,
      });
      return;
    }
    try {
      const lowLevel = getLowLevelServer(this.server);
      const sent = lowLevel.notification?.({
        method: "notifications/progress",
        params: {
          progressToken: this.progressToken,
          progress,
          total,
          ...(message ? { message } : {}),
        },
      });
      if (sent) {
        await sent;
      }
    } catch (error) {
      logger.warning("progress", {
        message: "Failed to send progress notification",
        error: (error as Error).message,
        progressToken: this.progressToken,
      });
    }
  }

  async complete(message?: string) {
    await this.report(1, 1, message ?? "Complete");
    this.completed = true;
  }
}

export function createProgressReporter(
  server: McpServer,
  progressToken: ProgressToken | undefined
) {
  if (!progressToken) {
    return null;
  }
  return new ProgressReporter(server, progressToken);
}
