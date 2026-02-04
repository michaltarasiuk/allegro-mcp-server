import type { HttpBindings } from '@hono/node-server';
import { Hono } from 'hono';
import { createMcpSecurityMiddleware } from '../adapters/http-hono/middleware.security.js';
import { buildDiscoveryRoutes } from '../adapters/http-hono/routes.discovery.js';
import { config } from '../config/env.js';
import { serverMetadata } from '../config/metadata.js';
import { contextRegistry } from '../core/context.js';
import { buildServer } from '../core/mcp.js';
import { parseConfig } from '../shared/config/env.js';
import type { ContextResolver } from '../shared/tools/registry.js';
import { createAuthHeaderMiddleware } from './middlewares/auth.js';
import { corsMiddleware } from './middlewares/cors.js';
import { healthRoutes } from './routes/health.js';
import { buildMcpRoutes } from './routes/mcp.js';

const createContextResolver = (): ContextResolver => (requestId) => {
  const ctx = contextRegistry.get(requestId);
  if (!ctx) return undefined;
  return {
    authStrategy: ctx.authStrategy,
    providerToken: ctx.providerToken,
    resolvedHeaders: ctx.resolvedHeaders,
    provider: ctx.provider
      ? {
          accessToken: ctx.provider.access_token,
          refreshToken: ctx.provider.refresh_token,
          expiresAt: ctx.provider.expires_at,
          scopes: ctx.provider.scopes,
        }
      : undefined,
  };
};

export function buildHttpApp() {
  const app = new Hono<{
    Bindings: HttpBindings;
  }>();
  const unifiedConfig = parseConfig(process.env as Record<string, unknown>);
  const server = buildServer({
    name: config.MCP_TITLE || serverMetadata.title,
    version: config.MCP_VERSION,
    instructions: config.MCP_INSTRUCTIONS || serverMetadata.instructions,
    contextResolver: createContextResolver(),
  });
  const transports = new Map();
  app.use('*', corsMiddleware());
  app.use('*', createAuthHeaderMiddleware());
  app.route('/', healthRoutes());
  app.route('/', buildDiscoveryRoutes(unifiedConfig));
  app.use('/mcp', createMcpSecurityMiddleware(unifiedConfig));
  app.route('/mcp', buildMcpRoutes({ server, transports }));
  return app;
}
