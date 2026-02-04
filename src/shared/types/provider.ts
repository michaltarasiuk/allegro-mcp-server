export type { ProviderTokens } from '../storage/interface.js';

import type { ProviderTokens } from '../storage/interface.js';

export interface ProviderInfo {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes?: string[];
}

export function toProviderInfo(tokens: ProviderTokens) {
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: tokens.expires_at,
    scopes: tokens.scopes,
  };
}

export function asProviderInfo(p: ProviderInfo | ProviderTokens) {
  if ('accessToken' in p && p.accessToken !== undefined) {
    return p as ProviderInfo;
  }
  return toProviderInfo(p as ProviderTokens);
}

export function toProviderTokens(info: ProviderInfo) {
  return {
    access_token: info.accessToken,
    refresh_token: info.refreshToken,
    expires_at: info.expiresAt,
    scopes: info.scopes,
  };
}
