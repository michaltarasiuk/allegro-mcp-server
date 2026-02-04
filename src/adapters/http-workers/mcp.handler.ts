import type { UnifiedConfig } from '../../shared/config/env.js';
import { withCors } from '../../shared/http/cors.js';
import { jsonResponse } from '../../shared/http/response.js';
import {
  type CancellationRegistry,
  dispatchMcpMethod,
  handleMcpNotification,
  type McpDispatchContext,
  type McpSessionState,
} from '../../shared/mcp/dispatcher.js';
import { ensureFreshToken } from '../../shared/oauth/refresh.js';
import type { SessionStore, TokenStore } from '../../shared/storage/interface.js';
import type { AuthStrategy, ToolContext } from '../../shared/tools/types.js';
import { sharedLogger as logger } from '../../shared/utils/logger.js';
import { checkAuthAndChallenge } from './security.js';

const sessionStateMap = new Map<string, McpSessionState>();
const cancellationRegistryMap = new Map<string, CancellationRegistry>();

function getCancellationRegistry(sessionId: string) {
  let registry = cancellationRegistryMap.get(sessionId);
  if (!registry) {
    registry = new Map();
    cancellationRegistryMap.set(sessionId, registry);
  }
  return registry;
}

type JsonRpcLike = {
  method?: string;
  params?: Record<string, unknown>;
};

function getJsonRpcMessages(body: unknown) {
  if (!body || typeof body !== 'object') return [];
  if (Array.isArray(body)) {
    return body.filter((msg) => msg && typeof msg === 'object') as JsonRpcLike[];
  }
  return [body as JsonRpcLike];
}

function resolveSessionApiKey(headers: Headers, config: UnifiedConfig) {
  const apiKeyHeader = config.API_KEY_HEADER.toLowerCase();
  const directApiKey =
    headers.get(apiKeyHeader) ||
    headers.get('x-api-key') ||
    headers.get('x-auth-token');
  if (directApiKey) return directApiKey;
  const authHeader = headers.get('authorization') || headers.get('Authorization');
  if (authHeader) {
    const match = authHeader.match(/^\s*Bearer\s+(.+)$/i);
    return match?.[1] ?? authHeader;
  }

  if (config.API_KEY) return config.API_KEY;
  return 'public';
}

function parseCustomHeaders(value: string | undefined) {
  if (!value) return {};
  const headers: Record<string, string> = {};
  for (const pair of value.split(',')) {
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

function buildStaticAuthHeaders(config: UnifiedConfig) {
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

function buildProviderRefreshConfig(config: UnifiedConfig) {
  if (
    !config.PROVIDER_CLIENT_ID ||
    !config.PROVIDER_CLIENT_SECRET ||
    !config.PROVIDER_ACCOUNTS_URL
  ) {
    return undefined;
  }
  return {
    clientId: config.PROVIDER_CLIENT_ID,
    clientSecret: config.PROVIDER_CLIENT_SECRET,
    accountsUrl: config.PROVIDER_ACCOUNTS_URL,
  };
}

async function resolveAuthContext(
  request: Request,
  tokenStore: TokenStore,
  config: UnifiedConfig,
) {
  const rawHeaders: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    rawHeaders[key.toLowerCase()] = value;
  });
  const strategy = config.AUTH_STRATEGY as AuthStrategy;
  let providerToken: string | undefined;
  let provider: ToolContext['provider'];
  let resolvedHeaders = { ...rawHeaders };
  if (strategy === 'oauth') {
    const authHeader = rawHeaders.authorization;
    const match = authHeader?.match(/^\s*Bearer\s+(.+)$/i);
    const rsToken = match?.[1];
    if (rsToken) {
      try {
        const providerConfig = buildProviderRefreshConfig(config);
        const { accessToken, wasRefreshed } = await ensureFreshToken(
          rsToken,
          tokenStore,
          providerConfig,
        );
        if (accessToken) {
          providerToken = accessToken;
          const record = await tokenStore.getByRsAccess(rsToken);
          if (record?.provider) {
            provider = {
              accessToken: record.provider.access_token,
              refreshToken: record.provider.refresh_token,
              expiresAt: record.provider.expires_at,
              scopes: record.provider.scopes,
            };
          }
          resolvedHeaders.authorization = `Bearer ${accessToken}`;
          if (wasRefreshed) {
            logger.info('mcp_handler', {
              message: 'Using proactively refreshed token',
            });
          }
        }
      } catch (error) {
        logger.debug('mcp_handler', {
          message: 'Token resolution failed',
          error: (error as Error).message,
        });
      }
    }
  } else if (strategy === 'bearer' || strategy === 'api_key' || strategy === 'custom') {
    const staticHeaders = buildStaticAuthHeaders(config);
    resolvedHeaders = { ...rawHeaders, ...staticHeaders };
    providerToken = strategy === 'bearer' ? config.BEARER_TOKEN : config.API_KEY;
  }
  return {
    sessionId: '',
    authStrategy: strategy,
    providerToken,
    provider,
    resolvedHeaders,
    authHeaders: rawHeaders,
  };
}

export interface McpHandlerDeps {
  tokenStore: TokenStore;
  sessionStore: SessionStore;
  config: UnifiedConfig;
}

export async function handleMcpRequest(request: Request, deps: McpHandlerDeps) {
  const { tokenStore, sessionStore, config } = deps;
  const body = (await request.json().catch(() => ({}))) as {
    jsonrpc?: string;
    method?: string;
    params?: Record<string, unknown>;
    id?: string | number | null;
  };
  const { method, params, id } = body;
  const messages = getJsonRpcMessages(body);
  const isInitialize = messages.some((msg) => msg.method === 'initialize');
  const isInitialized = messages.some((msg) => msg.method === 'initialized');
  const initMessage = messages.find((msg) => msg.method === 'initialize');
  const protocolVersion =
    typeof (
      initMessage?.params as
        | {
            protocolVersion?: string;
          }
        | undefined
    )?.protocolVersion === 'string'
      ? (
          initMessage?.params as {
            protocolVersion?: string;
          }
        ).protocolVersion
      : undefined;
  const incomingSessionId = request.headers.get('Mcp-Session-Id')?.trim();
  const sessionId = isInitialize
    ? crypto.randomUUID()
    : incomingSessionId || crypto.randomUUID();
  const apiKey = resolveSessionApiKey(request.headers, config);
  if (!isInitialize && !incomingSessionId) {
    return jsonResponse(
      {
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: Mcp-Session-Id required' },
        id: null,
      },
      { status: 400 },
    );
  }

  if (!isInitialize && incomingSessionId) {
    let existingSession: Awaited<ReturnType<typeof sessionStore.get>> | null = null;
    try {
      existingSession = await sessionStore.get(incomingSessionId);
    } catch (error) {
      logger.warning('mcp_session', {
        message: 'Session lookup failed',
        error: (error as Error).message,
      });
    }
    if (!existingSession) {
      return withCors(new Response('Invalid session', { status: 404 }));
    }
    if (existingSession.apiKey && existingSession.apiKey !== apiKey) {
      logger.warning('mcp_session', {
        message: 'Request API key differs from session binding',
        sessionId: incomingSessionId,
        originalApiKey: `${existingSession.apiKey.slice(0, 8)}...`,
        requestApiKey: `${apiKey.slice(0, 8)}...`,
      });
    }
  }
  const challengeResponse = await checkAuthAndChallenge(
    request,
    tokenStore,
    config,
    sessionId,
  );
  if (challengeResponse) {
    return challengeResponse;
  }
  const authContext = await resolveAuthContext(request, tokenStore, config);
  authContext.sessionId = sessionId;
  if (isInitialize) {
    try {
      await sessionStore.create(sessionId, apiKey);
      if (protocolVersion) {
        await sessionStore.update(sessionId, { protocolVersion });
      }
    } catch (error) {
      logger.warning('mcp_session', {
        message: 'Failed to create session record',
        error: (error as Error).message,
      });
    }
  }

  if (isInitialized) {
    try {
      await sessionStore.update(sessionId, { initialized: true });
    } catch (error) {
      logger.warning('mcp_session', {
        message: 'Failed to update session initialized flag',
        error: (error as Error).message,
      });
    }
  }
  const cancellationRegistry = getCancellationRegistry(sessionId);
  const dispatchContext: McpDispatchContext = {
    sessionId,
    auth: authContext,
    config: {
      title: config.MCP_TITLE,
      version: config.MCP_VERSION,
      instructions: config.MCP_INSTRUCTIONS,
    },
    getSessionState: () => sessionStateMap.get(sessionId),
    setSessionState: (state) => sessionStateMap.set(sessionId, state),
    cancellationRegistry,
  };
  if (!('id' in body) || id === null || id === undefined) {
    if (method) {
      handleMcpNotification(method, params, dispatchContext);
    }
    return withCors(new Response(null, { status: 202 }));
  }
  const result = await dispatchMcpMethod(method, params, dispatchContext, id);
  const response = jsonResponse({
    jsonrpc: '2.0',
    ...('error' in result ? { error: result.error } : { result: result.result }),
    id,
  });
  response.headers.set('Mcp-Session-Id', sessionId);
  return withCors(response);
}

export function handleMcpGet() {
  return withCors(new Response('Method Not Allowed', { status: 405 }));
}

export async function handleMcpDelete(request: Request, deps: McpHandlerDeps) {
  const { sessionStore } = deps;
  const sessionId = request.headers.get('Mcp-Session-Id')?.trim();
  if (!sessionId) {
    return withCors(
      jsonResponse(
        {
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Bad Request: Mcp-Session-Id required' },
          id: null,
        },
        { status: 400 },
      ),
    );
  }
  let existingSession: Awaited<ReturnType<typeof sessionStore.get>> | null = null;
  try {
    existingSession = await sessionStore.get(sessionId);
  } catch (error) {
    logger.warning('mcp_session', {
      message: 'Session lookup failed on DELETE',
      error: (error as Error).message,
    });
  }

  if (!existingSession) {
    return withCors(new Response('Invalid session', { status: 404 }));
  }
  sessionStateMap.delete(sessionId);
  cancellationRegistryMap.delete(sessionId);
  try {
    await sessionStore.delete(sessionId);
    logger.info('mcp_session', {
      message: 'Session terminated via DELETE',
      sessionId,
    });
  } catch (error) {
    logger.warning('mcp_session', {
      message: 'Failed to delete session record',
      error: (error as Error).message,
    });
  }
  return withCors(new Response(null, { status: 202 }));
}
