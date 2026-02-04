import type { AuthStrategy } from '../types/auth.js';

export type { AuthStrategy as AuthStrategyType } from '../types/auth.js';

export interface ResolvedAuth {
  strategy: AuthStrategy;
  headers: Record<string, string>;
  accessToken?: string;
  provider?: {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
  };
}

export interface AuthStrategyConfig {
  type: AuthStrategy;
  headerName?: string;
  value?: string;
  customHeaders?: Record<string, string>;
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
      headers[key] = val;
    }
  }
  return headers;
}

export function parseAuthStrategy(env: Record<string, unknown>) {
  const strategy = (env.AUTH_STRATEGY as string)?.toLowerCase() as AuthStrategy;
  switch (strategy) {
    case 'api_key':
      return {
        type: 'api_key',
        headerName: (env.API_KEY_HEADER as string) || 'x-api-key',
        value: env.API_KEY as string,
      };
    case 'bearer':
      return {
        type: 'bearer',
        value: env.BEARER_TOKEN as string,
      };
    case 'custom':
      return {
        type: 'custom',
        customHeaders: parseCustomHeaders(env.CUSTOM_HEADERS as string),
      };
    case 'none':
      return { type: 'none' };
    default:
      return { type: 'oauth' };
  }
}

export function buildAuthHeaders(strategyConfig: AuthStrategyConfig) {
  const headers: Record<string, string> = {};
  switch (strategyConfig.type) {
    case 'api_key':
      if (strategyConfig.value && strategyConfig.headerName) {
        headers[strategyConfig.headerName] = strategyConfig.value;
      }
      break;
    case 'bearer':
      if (strategyConfig.value) {
        headers.Authorization = `Bearer ${strategyConfig.value}`;
      }
      break;
    case 'custom':
      if (strategyConfig.customHeaders) {
        Object.assign(headers, strategyConfig.customHeaders);
      }
      break;
    case 'oauth':
    case 'none':
      break;
  }
  return headers;
}

export function resolveStaticAuth(strategyConfig: AuthStrategyConfig) {
  const headers = buildAuthHeaders(strategyConfig);
  return {
    strategy: strategyConfig.type,
    headers,
    accessToken: strategyConfig.type === 'bearer' ? strategyConfig.value : undefined,
  };
}

export function mergeAuthHeaders(
  incoming: Record<string, string>,
  strategy: Record<string, string>,
) {
  return {
    ...incoming,
    ...strategy,
  };
}

export function isOAuthStrategy(config: AuthStrategyConfig) {
  return config.type === 'oauth';
}

export function requiresAuth(config: AuthStrategyConfig) {
  return config.type !== 'none';
}

export function validateAuthConfig(config: AuthStrategyConfig) {
  const errors: string[] = [];
  switch (config.type) {
    case 'api_key':
      if (!config.value) {
        errors.push('API_KEY is required when AUTH_STRATEGY=api_key');
      }
      break;
    case 'bearer':
      if (!config.value) {
        errors.push('BEARER_TOKEN is required when AUTH_STRATEGY=bearer');
      }
      break;
    case 'custom':
      if (!config.customHeaders || Object.keys(config.customHeaders).length === 0) {
        errors.push('CUSTOM_HEADERS is required when AUTH_STRATEGY=custom');
      }
      break;
  }
  return errors;
}
