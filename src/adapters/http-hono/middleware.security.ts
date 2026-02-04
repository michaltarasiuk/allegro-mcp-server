import { randomUUID } from 'node:crypto';
import type { Context, Next } from 'hono';
import type { UnifiedConfig } from '../../shared/config/env.js';
import {
  buildUnauthorizedChallenge,
  validateOrigin,
  validateProtocolVersion,
} from '../../shared/mcp/security.js';
import {
  buildProviderRefreshConfig,
  ensureFreshToken,
} from '../../shared/oauth/refresh.js';
import { getTokenStore } from '../../shared/storage/singleton.js';
import { sharedLogger as logger } from '../../shared/utils/logger.js';

export function createMcpSecurityMiddleware(config: UnifiedConfig) {
  return async (c: Context, next: Next) => {
    try {
      validateOrigin(c.req.raw.headers, config.NODE_ENV === 'development');
      validateProtocolVersion(c.req.raw.headers, config.MCP_PROTOCOL_VERSION);
      if (config.AUTH_ENABLED) {
        const auth = c.req.header('Authorization') ?? undefined;
        if (!auth) {
          let sid = c.req.header('Mcp-Session-Id') ?? undefined;
          if (!sid) {
            sid = randomUUID();
            logger.debug('mcp_security', { message: 'Generated session ID', sid });
          }
          const origin = new URL(c.req.url).origin;
          const challenge = buildUnauthorizedChallenge({ origin, sid });
          c.header('Mcp-Session-Id', sid);
          c.header('WWW-Authenticate', challenge.headers['WWW-Authenticate']);
          return c.json(challenge.body, challenge.status as 401);
        }
        const [scheme, rsToken] = auth.split(' ', 2);
        const bearer =
          scheme && scheme.toLowerCase() === 'bearer' ? (rsToken || '').trim() : '';
        if (bearer) {
          try {
            const store = getTokenStore();
            const providerConfig = buildProviderRefreshConfig(config);
            const { accessToken, wasRefreshed } = await ensureFreshToken(
              bearer,
              store,
              providerConfig,
            );
            if (wasRefreshed) {
              logger.info('mcp_security', {
                message: 'Provider token refreshed proactively',
              });
            }
            const record = await store.getByRsAccess(bearer);
            const provider = record?.provider;
            if (provider && accessToken) {
              const authContext = {
                strategy: config.AUTH_STRATEGY as
                  | 'oauth'
                  | 'bearer'
                  | 'api_key'
                  | 'custom'
                  | 'none',
                authHeaders: { authorization: auth },
                resolvedHeaders: { authorization: `Bearer ${accessToken}` },
                providerToken: accessToken,
                provider: {
                  access_token: provider.access_token,
                  refresh_token: provider.refresh_token,
                  expires_at: provider.expires_at,
                  scopes: provider.scopes,
                },
                rsToken: bearer,
              };
              (
                c as unknown as {
                  authContext: typeof authContext;
                }
              ).authContext = authContext;
            } else if (config.AUTH_REQUIRE_RS && !config.AUTH_ALLOW_DIRECT_BEARER) {
              const sid = c.req.header('Mcp-Session-Id') ?? randomUUID();
              const origin = new URL(c.req.url).origin;
              const challenge = buildUnauthorizedChallenge({ origin, sid });
              c.header('Mcp-Session-Id', sid);
              c.header('WWW-Authenticate', challenge.headers['WWW-Authenticate']);
              logger.debug('mcp_security', {
                message: 'RS token not found, challenging',
              });
              return c.json(challenge.body, challenge.status as 401);
            }
          } catch (error) {
            logger.error('mcp_security', {
              message: 'Token lookup failed',
              error: (error as Error).message,
            });
          }
        }
      }
      return next();
    } catch (error) {
      logger.error('mcp_security', {
        message: 'Security check failed',
        error: (error as Error).message,
      });
      return c.json(
        {
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: (error as Error).message || 'Internal server error',
          },
          id: null,
        },
        500 as const,
      );
    }
  };
}
