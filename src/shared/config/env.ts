import type { AuthStrategyType } from '../auth/strategy.js';

export type UnifiedConfig = {
  HOST: string;
  PORT: number;
  NODE_ENV: 'development' | 'production' | 'test';
  MCP_TITLE: string;
  MCP_INSTRUCTIONS: string;
  MCP_VERSION: string;
  MCP_PROTOCOL_VERSION: string;
  MCP_ACCEPT_HEADERS: string[];
  AUTH_STRATEGY: AuthStrategyType;
  AUTH_ENABLED: boolean;
  AUTH_REQUIRE_RS: boolean;
  AUTH_ALLOW_DIRECT_BEARER: boolean;
  AUTH_RESOURCE_URI?: string;
  AUTH_DISCOVERY_URL?: string;
  API_KEY?: string;
  API_KEY_HEADER: string;
  BEARER_TOKEN?: string;
  CUSTOM_HEADERS?: string;
  OAUTH_CLIENT_ID?: string;
  OAUTH_CLIENT_SECRET?: string;
  OAUTH_SCOPES: string;
  OAUTH_AUTHORIZATION_URL?: string;
  OAUTH_TOKEN_URL?: string;
  OAUTH_REVOCATION_URL?: string;
  OAUTH_REDIRECT_URI: string;
  OAUTH_REDIRECT_ALLOWLIST: string[];
  OAUTH_REDIRECT_ALLOW_ALL: boolean;
  OAUTH_EXTRA_AUTH_PARAMS?: string;
  CIMD_ENABLED: boolean;
  CIMD_FETCH_TIMEOUT_MS: number;
  CIMD_MAX_RESPONSE_BYTES: number;
  CIMD_ALLOWED_DOMAINS: string[];
  PROVIDER_CLIENT_ID?: string;
  PROVIDER_CLIENT_SECRET?: string;
  PROVIDER_API_URL?: string;
  PROVIDER_ACCOUNTS_URL?: string;
  RS_TOKENS_FILE?: string;
  RS_TOKENS_ENC_KEY?: string;
  RPS_LIMIT: number;
  CONCURRENCY_LIMIT: number;
  LOG_LEVEL: 'debug' | 'info' | 'warning' | 'error';
};

function parseBoolean(value: unknown) {
  return String(value || 'false').toLowerCase() === 'true';
}

function parseNumber(value: unknown, defaultValue: number) {
  const num = Number(value);
  return Number.isFinite(num) ? num : defaultValue;
}

function parseStringArray(value: unknown) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseAuthStrategy(env: Record<string, unknown>) {
  const explicit = (env.AUTH_STRATEGY as string)?.toLowerCase();
  if (explicit && ['oauth', 'bearer', 'api_key', 'custom', 'none'].includes(explicit)) {
    return explicit as AuthStrategyType;
  }

  if (parseBoolean(env.AUTH_ENABLED)) {
    return 'oauth';
  }

  if (env.API_KEY) {
    return 'api_key';
  }

  if (env.BEARER_TOKEN) {
    return 'bearer';
  }
  return 'none';
}

export function parseConfig(env: Record<string, unknown>) {
  const authStrategy = parseAuthStrategy(env);
  return {
    HOST: String(env.HOST || '127.0.0.1'),
    PORT: parseNumber(env.PORT, 3000),
    NODE_ENV: (env.NODE_ENV as UnifiedConfig['NODE_ENV']) || 'development',
    MCP_TITLE: String(env.MCP_TITLE || 'MCP Server Template'),
    MCP_INSTRUCTIONS: String(
      env.MCP_INSTRUCTIONS ||
        'Use these tools responsibly. Prefer minimal scopes and small page sizes.',
    ),
    MCP_VERSION: String(env.MCP_VERSION || '0.1.0'),
    MCP_PROTOCOL_VERSION: String(env.MCP_PROTOCOL_VERSION || '2025-06-18'),
    MCP_ACCEPT_HEADERS: parseStringArray(env.MCP_ACCEPT_HEADERS),
    AUTH_STRATEGY: authStrategy,
    AUTH_ENABLED: authStrategy === 'oauth' || parseBoolean(env.AUTH_ENABLED),
    AUTH_REQUIRE_RS: parseBoolean(env.AUTH_REQUIRE_RS),
    AUTH_ALLOW_DIRECT_BEARER: parseBoolean(env.AUTH_ALLOW_DIRECT_BEARER),
    AUTH_RESOURCE_URI: env.AUTH_RESOURCE_URI as string | undefined,
    AUTH_DISCOVERY_URL: env.AUTH_DISCOVERY_URL as string | undefined,
    API_KEY: env.API_KEY as string | undefined,
    API_KEY_HEADER: String(env.API_KEY_HEADER || 'x-api-key'),
    BEARER_TOKEN: env.BEARER_TOKEN as string | undefined,
    CUSTOM_HEADERS: env.CUSTOM_HEADERS as string | undefined,
    OAUTH_CLIENT_ID: env.OAUTH_CLIENT_ID as string | undefined,
    OAUTH_CLIENT_SECRET: env.OAUTH_CLIENT_SECRET as string | undefined,
    OAUTH_SCOPES: String(env.OAUTH_SCOPES || ''),
    OAUTH_AUTHORIZATION_URL: env.OAUTH_AUTHORIZATION_URL as string | undefined,
    OAUTH_TOKEN_URL: env.OAUTH_TOKEN_URL as string | undefined,
    OAUTH_REVOCATION_URL: env.OAUTH_REVOCATION_URL as string | undefined,
    OAUTH_REDIRECT_URI: String(
      env.OAUTH_REDIRECT_URI || 'http://localhost:3000/callback',
    ),
    OAUTH_REDIRECT_ALLOWLIST: parseStringArray(env.OAUTH_REDIRECT_ALLOWLIST),
    OAUTH_REDIRECT_ALLOW_ALL: parseBoolean(env.OAUTH_REDIRECT_ALLOW_ALL),
    OAUTH_EXTRA_AUTH_PARAMS: env.OAUTH_EXTRA_AUTH_PARAMS as string | undefined,
    CIMD_ENABLED: parseBoolean(env.CIMD_ENABLED ?? 'true'),
    CIMD_FETCH_TIMEOUT_MS: parseNumber(env.CIMD_FETCH_TIMEOUT_MS, 5000),
    CIMD_MAX_RESPONSE_BYTES: parseNumber(env.CIMD_MAX_RESPONSE_BYTES, 65536),
    CIMD_ALLOWED_DOMAINS: parseStringArray(env.CIMD_ALLOWED_DOMAINS),
    PROVIDER_CLIENT_ID: (env.PROVIDER_CLIENT_ID as string | undefined)?.trim(),
    PROVIDER_CLIENT_SECRET: (env.PROVIDER_CLIENT_SECRET as string | undefined)?.trim(),
    PROVIDER_API_URL: env.PROVIDER_API_URL as string | undefined,
    PROVIDER_ACCOUNTS_URL: env.PROVIDER_ACCOUNTS_URL as string | undefined,
    RS_TOKENS_FILE: env.RS_TOKENS_FILE as string | undefined,
    RS_TOKENS_ENC_KEY: env.RS_TOKENS_ENC_KEY as string | undefined,
    RPS_LIMIT: parseNumber(env.RPS_LIMIT, 10),
    CONCURRENCY_LIMIT: parseNumber(env.CONCURRENCY_LIMIT, 5),
    LOG_LEVEL: (env.LOG_LEVEL as UnifiedConfig['LOG_LEVEL']) || 'info',
  };
}

export function resolveConfig() {
  if (typeof process === 'undefined' || !process.env) {
    throw new Error(
      'resolveConfig() requires Node.js process.env. Use parseConfig(env) in Workers.',
    );
  }
  return parseConfig(process.env as Record<string, unknown>);
}
