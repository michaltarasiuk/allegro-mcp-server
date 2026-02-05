import type { UnifiedConfig } from "../config/env.js";
import type { TokenInput } from "./types.js";

export function parseAuthorizeInput(url: URL, sessionId?: string) {
  return {
    clientId: url.searchParams.get("client_id") ?? undefined,
    codeChallenge: url.searchParams.get("code_challenge") || "",
    codeChallengeMethod: url.searchParams.get("code_challenge_method") || "",
    redirectUri: url.searchParams.get("redirect_uri") || "",
    requestedScope: url.searchParams.get("scope") ?? undefined,
    state: url.searchParams.get("state") ?? undefined,
    sid: url.searchParams.get("sid") || sessionId || undefined,
  };
}

export function parseCallbackInput(url: URL) {
  return {
    code: url.searchParams.get("code"),
    state: url.searchParams.get("state"),
  };
}

export async function parseTokenInput(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const text = await request.text();
    return new URLSearchParams(text);
  }
  const json = (await request.json().catch(() => ({}))) as Record<
    string,
    string
  >;
  return new URLSearchParams(json);
}

export function buildTokenInput(
  form: URLSearchParams
): TokenInput | { error: string } {
  const grant = form.get("grant_type");
  if (grant === "refresh_token") {
    const refreshToken = form.get("refresh_token");
    if (!refreshToken) {
      return { error: "missing_refresh_token" };
    }
    return { grant: "refresh_token", refreshToken };
  }

  if (grant === "authorization_code") {
    const code = form.get("code");
    const codeVerifier = form.get("code_verifier");
    if (!(code && codeVerifier)) {
      return { error: "missing_code_or_verifier" };
    }
    return { grant: "authorization_code", code, codeVerifier };
  }
  return { error: "unsupported_grant_type" };
}

export function buildProviderConfig(config: UnifiedConfig) {
  return {
    clientId: config.PROVIDER_CLIENT_ID,
    clientSecret: config.PROVIDER_CLIENT_SECRET,
    accountsUrl: config.PROVIDER_ACCOUNTS_URL || "https://provider.example.com",
    oauthScopes: config.OAUTH_SCOPES,
    extraAuthParams: config.OAUTH_EXTRA_AUTH_PARAMS,
  };
}

export function buildOAuthConfig(config: UnifiedConfig) {
  return {
    redirectUri: config.OAUTH_REDIRECT_URI,
    redirectAllowlist: config.OAUTH_REDIRECT_ALLOWLIST,
    redirectAllowAll: config.OAUTH_REDIRECT_ALLOW_ALL,
  };
}

export function buildFlowOptions(
  url: URL,
  config: UnifiedConfig,
  overrides: {
    callbackPath?: string;
    tokenEndpointPath?: string;
  } = {}
) {
  return {
    baseUrl: url.origin,
    isDev: config.NODE_ENV === "development",
    callbackPath: overrides.callbackPath ?? "/oauth/callback",
    tokenEndpointPath: overrides.tokenEndpointPath ?? "/api/token",
  };
}
