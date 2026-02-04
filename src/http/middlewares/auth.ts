import type { Context, Next } from 'hono';
import { config } from '../../config/env.js';
import type { AuthStrategyType } from '../../shared/auth/strategy.js';
import type { ProviderTokens } from '../../shared/storage/interface.js';
import { getTokenStore } from '../../shared/storage/singleton.js';
import { logger } from '../../shared/utils/logger.js';

export interface AuthContext {
  strategy: AuthStrategyType;
  authHeaders: Record<string, string>;
  resolvedHeaders: Record<string, string>;
  providerToken?: string;
  provider?: ProviderTokens;
  rsToken?: string;
}

function parseCustomHeaders(value: string | undefined) {
  if (!value) return {};
  const headers: Record<string, string> = {};
  const pairs = value.split(',');
  for (const pair of pairs) {
    const colonIndex = pair.indexOf(':');
    if (colonIndex === -1) continue;
    const key = pair.slice(0, colonIndex).trim();
    const val = pair.slice(colonIndex + 1).trim();
    if (key && val) {
      headers[key.toLowerCase()] = val;
    }
  }
  return headers;
}

function buildStaticAuthHeaders() {
  const headers: Record<string, string> = {};
  switch (config.AUTH_STRATEGY) {
    case 'api_key':
      if (config.API_KEY) {
        headers[config.API_KEY_HEADER.toLowerCase()] = config.API_KEY;
      }
      break;
    case 'bearer':
      if (config.BEARER_TOKEN) {
        headers.authorization = `Bearer ${config.BEARER_TOKEN}`;
      }
      break;
    case 'custom':
      Object.assign(headers, parseCustomHeaders(config.CUSTOM_HEADERS));
      break;
  }
  return headers;
}

export function createAuthHeaderMiddleware() {
  const accept = new Set(
    (config.MCP_ACCEPT_HEADERS as string[]).map((h) => h.toLowerCase()),
  );
  ['authorization', 'x-api-key', 'x-auth-token'].forEach((h) => accept.add(h));
  const staticHeaders = buildStaticAuthHeaders();
  const strategy = config.AUTH_STRATEGY;
  return async (c: Context, next: Next) => {
    const incoming = c.req.raw.headers;
    const forwarded: Record<string, string> = {};
    for (const [k, v] of incoming as unknown as Iterable<[string, string]>) {
      const lower = k.toLowerCase();
      if (accept.has(lower)) {
        forwarded[lower] = v;
      }
    }
    const authContext: AuthContext = {
      strategy,
      authHeaders: forwarded,
      resolvedHeaders: { ...forwarded },
    };
    switch (strategy) {
      case 'oauth':
        await handleOAuthStrategy(authContext, forwarded);
        break;
      case 'bearer':
        authContext.resolvedHeaders = { ...forwarded, ...staticHeaders };
        authContext.providerToken = config.BEARER_TOKEN;
        break;
      case 'api_key':
        authContext.resolvedHeaders = { ...forwarded, ...staticHeaders };
        authContext.providerToken = config.API_KEY;
        break;
      case 'custom':
        authContext.resolvedHeaders = { ...forwarded, ...staticHeaders };
        break;
      default:
        break;
    }
    (
      c as unknown as {
        authContext: AuthContext;
      }
    ).authContext = authContext;
    (
      c as unknown as {
        authHeaders?: Record<string, string>;
      }
    ).authHeaders = authContext.resolvedHeaders;
    await next();
  };
}

async function handleOAuthStrategy(
  authContext: AuthContext,
  forwarded: Record<string, string>,
) {
  const auth = forwarded.authorization;
  const bearerMatch = auth?.match(/^\s*Bearer\s+(.+)$/i);
  const rsToken = bearerMatch?.[1];
  if (!rsToken) return;
  authContext.rsToken = rsToken;
  try {
    const store = getTokenStore();
    const record = await store.getByRsAccess(rsToken);
    if (record?.provider?.access_token) {
      const now = Date.now();
      const expiresAt = record.provider.expires_at ?? 0;
      if (expiresAt && now >= expiresAt - 60000) {
        logger.warning('auth_middleware', {
          message: 'Provider token expired or expiring soon',
          expiresAt,
          now,
        });
      }
      authContext.providerToken = record.provider.access_token;
      authContext.provider = record.provider;
      authContext.resolvedHeaders.authorization = `Bearer ${record.provider.access_token}`;
      logger.debug('auth_middleware', {
        message: 'Mapped RS token to provider token',
        hasRefreshToken: Boolean(record.provider.refresh_token),
        expiresAt: record.provider.expires_at,
      });
    } else if (config.AUTH_REQUIRE_RS && !config.AUTH_ALLOW_DIRECT_BEARER) {
      delete authContext.resolvedHeaders.authorization;
      logger.warning('auth_middleware', {
        message: 'RS token not found in store',
      });
    }
  } catch (error) {
    logger.error('auth_middleware', {
      message: 'Failed to look up RS token',
      error: (error as Error).message,
    });
  }
}
