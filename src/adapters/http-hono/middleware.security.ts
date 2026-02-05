import { randomUUID } from "node:crypto";
import type { Context, Next } from "hono";
import type { UnifiedConfig } from "../../shared/config/env.js";
import {
  buildUnauthorizedChallenge,
  validateOrigin,
  validateProtocolVersion,
} from "../../shared/mcp/security.js";
import {
  buildProviderRefreshConfig,
  ensureFreshToken,
} from "../../shared/oauth/refresh.js";
import { getTokenStore } from "../../shared/storage/singleton.js";
import { sharedLogger as logger } from "../../shared/utils/logger.js";

function parseBearer(auth: string): string {
  const [scheme, rsToken] = auth.split(" ", 2);
  return scheme?.toLowerCase() === "bearer" ? (rsToken ?? "").trim() : "";
}

function sendChallenge(
  c: Context,
  sid: string,
  origin: string
): Response | undefined {
  const challenge = buildUnauthorizedChallenge({ origin, sid });
  c.header("Mcp-Session-Id", sid);
  c.header("WWW-Authenticate", challenge.headers["WWW-Authenticate"]);
  return c.json(challenge.body, challenge.status as 401);
}

function sendSecurityError(c: Context, message: string): Response {
  return c.json(
    {
      jsonrpc: "2.0",
      error: {
        code: -32_603,
        message: message || "Internal server error",
      },
      id: null,
    },
    500 as const
  );
}

interface AuthContextPayload {
  strategy: UnifiedConfig["AUTH_STRATEGY"];
  authHeaders: { authorization: string };
  resolvedHeaders: { authorization: string };
  providerToken: string;
  provider: {
    access_token: string;
    refresh_token?: string;
    expires_at?: number;
    scopes?: string[];
  };
  rsToken: string;
}

async function resolveBearerAuth(
  bearer: string,
  auth: string,
  config: UnifiedConfig
): Promise<AuthContextPayload | "challenge" | null> {
  const store = getTokenStore();
  const providerConfig = buildProviderRefreshConfig(config);
  const { accessToken, wasRefreshed } = await ensureFreshToken(
    bearer,
    store,
    providerConfig
  );
  if (wasRefreshed) {
    logger.info("mcp_security", {
      message: "Provider token refreshed proactively",
    });
  }
  const record = await store.getByRsAccess(bearer);
  const provider = record?.provider;
  if (provider && accessToken) {
    return {
      strategy: config.AUTH_STRATEGY as AuthContextPayload["strategy"],
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
  }
  if (config.AUTH_REQUIRE_RS && !config.AUTH_ALLOW_DIRECT_BEARER) {
    return "challenge";
  }
  return null;
}

async function runAuthCheck(
  c: Context,
  config: UnifiedConfig
): Promise<Response | "next"> {
  validateOrigin(c.req.raw.headers, config.NODE_ENV === "development");
  validateProtocolVersion(c.req.raw.headers, config.MCP_PROTOCOL_VERSION);
  if (!config.AUTH_ENABLED) {
    return "next";
  }
  const auth = c.req.header("Authorization") ?? undefined;
  if (!auth) {
    let sid = c.req.header("Mcp-Session-Id") ?? undefined;
    if (!sid) {
      sid = randomUUID();
      logger.debug("mcp_security", { message: "Generated session ID", sid });
    }
    return sendChallenge(c, sid, new URL(c.req.url).origin) as Response;
  }
  const bearer = parseBearer(auth);
  if (!bearer) {
    return "next";
  }
  try {
    const result = await resolveBearerAuth(bearer, auth, config);
    if (result === "challenge") {
      const sid = c.req.header("Mcp-Session-Id") ?? randomUUID();
      logger.debug("mcp_security", {
        message: "RS token not found, challenging",
      });
      return sendChallenge(c, sid, new URL(c.req.url).origin) as Response;
    }
    if (result) {
      (c as unknown as { authContext: AuthContextPayload }).authContext =
        result;
    }
  } catch (error) {
    logger.error("mcp_security", {
      message: "Token lookup failed",
      error: (error as Error).message,
    });
  }
  return "next";
}

export function createMcpSecurityMiddleware(config: UnifiedConfig) {
  return async (c: Context, next: Next) => {
    try {
      const outcome = await runAuthCheck(c, config);
      if (outcome !== "next") {
        return outcome;
      }
      return next();
    } catch (error) {
      logger.error("mcp_security", {
        message: "Security check failed",
        error: (error as Error).message,
      });
      return sendSecurityError(
        c,
        (error as Error).message || "Internal server error"
      );
    }
  };
}
