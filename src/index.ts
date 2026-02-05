import { serve } from "@hono/node-server";
import { config } from "./config/env.js";
import { stopContextCleanup } from "./core/context.js";
import { buildHttpApp } from "./http/app.js";
import { buildAuthApp } from "./http/auth-app.js";
import { FileTokenStore } from "./shared/storage/file.js";
import { MemorySessionStore } from "./shared/storage/memory.js";
import { initializeStorage } from "./shared/storage/singleton.js";
import { logger } from "./shared/utils/logger.js";

let tokenStore: FileTokenStore | null = null;
let sessionStore: MemorySessionStore | null = null;

function main() {
  try {
    tokenStore = new FileTokenStore(
      config.RS_TOKENS_FILE,
      config.RS_TOKENS_ENC_KEY
    );
    sessionStore = new MemorySessionStore();
    initializeStorage(tokenStore, sessionStore);
    const app = buildHttpApp();
    serve({
      fetch: app.fetch,
      port: config.PORT,
      hostname: config.HOST,
    });
    if (config.AUTH_ENABLED) {
      const authApp = buildAuthApp();
      serve({
        fetch: authApp.fetch,
        port: Number(config.PORT) + 1,
        hostname: config.HOST,
      });
    }
    logger.info("server", {
      message: `MCP server started on http://${config.HOST}:${config.PORT}`,
      environment: config.NODE_ENV,
      authEnabled: config.AUTH_ENABLED,
      tokenEncryption: Boolean(config.RS_TOKENS_ENC_KEY),
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    logger.error("server", {
      message: "Server startup failed",
      error: (error as Error).message,
    });
    process.exit(1);
  }
}

function gracefulShutdown(signal: string) {
  logger.info("server", { message: `Received ${signal}, shutting down` });
  stopContextCleanup();
  if (tokenStore) {
    tokenStore.flush();
    tokenStore.stopCleanup();
  }

  if (sessionStore) {
    sessionStore.stopCleanup();
  }
  process.exit(0);
}
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
main();
