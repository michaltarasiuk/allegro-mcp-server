import type { HttpBindings } from '@hono/node-server';
import { Hono } from 'hono';
import { buildOAuthRoutes } from '../adapters/http-hono/routes.oauth.js';
import { parseConfig } from '../shared/config/env.js';
import { buildAuthorizationServerMetadata } from '../shared/oauth/discovery.js';
import { getTokenStore } from '../shared/storage/singleton.js';
import { corsMiddleware } from './middlewares/cors.js';

export function buildAuthApp() {
  const app = new Hono<{
    Bindings: HttpBindings;
  }>();
  const config = parseConfig(process.env as Record<string, unknown>);
  const store = getTokenStore();
  app.use('*', corsMiddleware());
  app.get('/.well-known/oauth-authorization-server', (c) => {
    const here = new URL(c.req.url);
    const base = `${here.protocol}//${here.host}`;
    const scopes = config.OAUTH_SCOPES.split(' ').filter(Boolean);
    const metadata = buildAuthorizationServerMetadata(base, scopes, {
      authorizationEndpoint: `${base}/authorize`,
      tokenEndpoint: `${base}/token`,
      revocationEndpoint: `${base}/revoke`,
    });
    return c.json(metadata);
  });
  app.route('/', buildOAuthRoutes(store, config));
  return app;
}
