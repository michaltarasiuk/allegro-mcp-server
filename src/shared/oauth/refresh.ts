import * as oauth from 'oauth4webapi';
import type { ProviderTokens, TokenStore } from '../storage/interface.js';
import { sharedLogger as logger } from '../utils/logger.js';

export interface ProviderRefreshConfig {
  clientId: string;
  clientSecret: string;
  accountsUrl: string;
  tokenEndpointPath?: string;
}

export function buildProviderRefreshConfig(config: {
  PROVIDER_CLIENT_ID?: string;
  PROVIDER_CLIENT_SECRET?: string;
  PROVIDER_ACCOUNTS_URL?: string;
  OAUTH_TOKEN_URL?: string;
}) {
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
    tokenEndpointPath: config.OAUTH_TOKEN_URL,
  };
}

export interface RefreshResult {
  success: boolean;
  tokens?: ProviderTokens;
  error?: string;
}

function buildAuthorizationServer(config: ProviderRefreshConfig) {
  const tokenEndpoint = config.tokenEndpointPath || '/token';
  return {
    issuer: config.accountsUrl,
    token_endpoint: new URL(tokenEndpoint, config.accountsUrl).toString(),
  };
}

export async function refreshProviderToken(
  refreshToken: string,
  config: ProviderRefreshConfig,
) {
  const authServer = buildAuthorizationServer(config);
  const client: oauth.Client = {
    client_id: config.clientId,
    token_endpoint_auth_method: 'client_secret_basic',
  };
  logger.debug('oauth_refresh', {
    message: 'Refreshing provider token',
    tokenUrl: authServer.token_endpoint,
  });
  try {
    const clientAuth = oauth.ClientSecretBasic(config.clientSecret);
    const response = await oauth.refreshTokenGrantRequest(
      authServer,
      client,
      clientAuth,
      refreshToken,
    );
    const result = await oauth.processRefreshTokenResponse(
      authServer,
      client,
      response,
    );
    const accessToken = result.access_token;
    if (!accessToken) {
      return {
        success: false,
        error: 'No access_token in provider response',
      };
    }
    logger.info('oauth_refresh', {
      message: 'Provider token refreshed',
      hasNewRefreshToken: !!result.refresh_token,
    });
    return {
      success: true,
      tokens: {
        access_token: accessToken,
        refresh_token: result.refresh_token ?? refreshToken,
        expires_at: Date.now() + (result.expires_in ?? 3600) * 1000,
        scopes: (result.scope || '').split(/\s+/).filter(Boolean),
      },
    };
  } catch (error) {
    if (error instanceof oauth.ResponseBodyError) {
      logger.error('oauth_refresh', {
        message: 'Provider refresh failed',
        error: error.error,
        description: error.error_description,
      });
      return {
        success: false,
        error:
          `Provider returned ${error.error}: ${error.error_description || ''}`.trim(),
      };
    }
    logger.error('oauth_refresh', {
      message: 'Token refresh network error',
      error: (error as Error).message,
    });
    return {
      success: false,
      error: `Network error: ${(error as Error).message}`,
    };
  }
}

const EXPIRY_BUFFER_MS = 60000;
const REFRESH_COOLDOWN_MS = 30000;
const recentlyRefreshed = new Map<string, number>();

function shouldSkipRefresh(rsToken: string) {
  const lastRefresh = recentlyRefreshed.get(rsToken);
  if (lastRefresh && Date.now() - lastRefresh < REFRESH_COOLDOWN_MS) {
    return true;
  }
  return false;
}

function markRefreshed(rsToken: string) {
  recentlyRefreshed.set(rsToken, Date.now());
  if (recentlyRefreshed.size > 1000) {
    const now = Date.now();
    for (const [key, timestamp] of recentlyRefreshed) {
      if (now - timestamp > REFRESH_COOLDOWN_MS) {
        recentlyRefreshed.delete(key);
      }
    }
  }
}

export function isTokenExpiredOrExpiring(
  expiresAt: number | undefined,
  bufferMs = EXPIRY_BUFFER_MS,
) {
  if (!expiresAt) return false;
  return Date.now() >= expiresAt - bufferMs;
}

export async function ensureFreshToken(
  rsAccessToken: string,
  tokenStore: TokenStore,
  providerConfig: ProviderRefreshConfig | undefined,
) {
  const record = await tokenStore.getByRsAccess(rsAccessToken);
  if (!record?.provider?.access_token) {
    return { accessToken: '', wasRefreshed: false };
  }

  if (!isTokenExpiredOrExpiring(record.provider.expires_at)) {
    return { accessToken: record.provider.access_token, wasRefreshed: false };
  }

  if (shouldSkipRefresh(rsAccessToken)) {
    logger.debug('oauth_refresh', {
      message: 'Token refresh throttled (recently refreshed in this process)',
    });
    return { accessToken: record.provider.access_token, wasRefreshed: false };
  }
  logger.info('oauth_refresh', {
    message: 'Token near expiry, attempting refresh',
    expiresAt: record.provider.expires_at,
    now: Date.now(),
  });
  if (!record.provider.refresh_token) {
    logger.warning('oauth_refresh', {
      message: 'Token near expiry but no refresh token available',
    });
    return { accessToken: record.provider.access_token, wasRefreshed: false };
  }

  if (!providerConfig) {
    logger.warning('oauth_refresh', {
      message: 'Token near expiry but no provider config for refresh',
    });
    return { accessToken: record.provider.access_token, wasRefreshed: false };
  }
  const result = await refreshProviderToken(
    record.provider.refresh_token,
    providerConfig,
  );
  if (!result.success || !result.tokens) {
    logger.error('oauth_refresh', {
      message: 'Token refresh failed, using existing token',
      error: result.error,
    });
    return { accessToken: record.provider.access_token, wasRefreshed: false };
  }
  const providerRefreshRotated =
    result.tokens.refresh_token !== record.provider.refresh_token;
  const newRsAccess = providerRefreshRotated ? undefined : record.rs_access_token;
  try {
    await tokenStore.updateByRsRefresh(
      record.rs_refresh_token,
      result.tokens,
      newRsAccess,
    );
    markRefreshed(rsAccessToken);
    logger.info('oauth_refresh', {
      message: 'Token store updated with refreshed tokens',
      rsAccessRotated: providerRefreshRotated,
    });
    return { accessToken: result.tokens.access_token, wasRefreshed: true };
  } catch (error) {
    logger.error('oauth_refresh', {
      message: 'Failed to update token store',
      error: (error as Error).message,
    });
    return { accessToken: result.tokens.access_token, wasRefreshed: true };
  }
}
