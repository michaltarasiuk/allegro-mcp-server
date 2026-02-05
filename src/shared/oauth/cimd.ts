import { z } from "zod";
import { sharedLogger as logger } from "../utils/logger.js";
import { assertSsrfSafe } from "./ssrf.js";

export const ClientMetadataSchema = z.object({
  client_id: z.string().url(),
  client_name: z.string().optional(),
  redirect_uris: z.array(z.string().url()),
  client_uri: z.string().url().optional(),
  logo_uri: z.string().url().optional(),
  tos_uri: z.string().url().optional(),
  policy_uri: z.string().url().optional(),
  jwks_uri: z.string().url().optional(),
  software_statement: z.string().optional(),
});

export type ClientMetadata = z.infer<typeof ClientMetadataSchema>;

export interface CimdConfig {
  timeoutMs?: number;
  maxBytes?: number;
  allowedDomains?: string[];
}

export type CimdFetchResult =
  | {
      success: true;
      metadata: ClientMetadata;
    }
  | {
      success: false;
      error: string;
    };

export function isClientIdUrl(clientId: string) {
  if (!clientId.startsWith("https://")) {
    return false;
  }
  try {
    const url = new URL(clientId);
    return url.pathname !== "/" && url.pathname.length > 1;
  } catch {
    return false;
  }
}

function isDomainAllowed(clientIdUrl: string, allowedDomains?: string[]) {
  if (!allowedDomains || allowedDomains.length === 0) {
    return true;
  }
  try {
    const url = new URL(clientIdUrl);
    const hostname = url.hostname.toLowerCase();
    return allowedDomains.some((domain) => {
      const d = domain.toLowerCase();
      return hostname === d || hostname.endsWith(`.${d}`);
    });
  } catch {
    return false;
  }
}

export async function fetchClientMetadata(
  clientIdUrl: string,
  config?: CimdConfig
) {
  const timeoutMs = config?.timeoutMs ?? 5000;
  const maxBytes = config?.maxBytes ?? 65_536;
  const allowedDomains = config?.allowedDomains;
  logger.debug("cimd", {
    message: "Fetching client metadata",
    url: clientIdUrl,
  });
  try {
    assertSsrfSafe(clientIdUrl, { requireNonRootPath: true });
  } catch (error) {
    logger.warning("cimd", {
      message: "SSRF check failed",
      url: clientIdUrl,
      error: (error as Error).message,
    });
    return { success: false, error: (error as Error).message };
  }

  if (!isDomainAllowed(clientIdUrl, allowedDomains)) {
    logger.warning("cimd", {
      message: "Domain not in allowlist",
      url: clientIdUrl,
    });
    return { success: false, error: "domain_not_allowed" };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(clientIdUrl, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "MCP-Server/1.0 CIMD-Fetcher",
      },
      redirect: "error",
    });
    if (!response.ok) {
      logger.warning("cimd", {
        message: "Fetch failed",
        url: clientIdUrl,
        status: response.status,
      });
      return { success: false, error: `fetch_failed: ${response.status}` };
    }
    const contentLength = response.headers.get("content-length");
    if (contentLength && Number.parseInt(contentLength, 10) > maxBytes) {
      logger.warning("cimd", {
        message: "Response too large",
        url: clientIdUrl,
        contentLength,
      });
      return { success: false, error: "metadata_too_large" };
    }
    const contentType = response.headers.get("content-type") || "";
    if (
      !(
        contentType.includes("application/json") ||
        contentType.includes("text/json")
      )
    ) {
      logger.warning("cimd", {
        message: "Invalid content type",
        url: clientIdUrl,
        contentType,
      });
      return { success: false, error: "invalid_content_type" };
    }
    const text = await response.text();
    if (text.length > maxBytes) {
      return { success: false, error: "metadata_too_large" };
    }
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return { success: false, error: "invalid_json" };
    }
    const parsed = ClientMetadataSchema.safeParse(data);
    if (!parsed.success) {
      logger.warning("cimd", {
        message: "Invalid metadata schema",
        url: clientIdUrl,
        errors: parsed.error.errors,
      });
      return {
        success: false,
        error: `invalid_metadata: ${parsed.error.message}`,
      };
    }
    if (parsed.data.client_id !== clientIdUrl) {
      logger.warning("cimd", {
        message: "client_id mismatch",
        url: clientIdUrl,
        metadataClientId: parsed.data.client_id,
      });
      return { success: false, error: "client_id_mismatch" };
    }
    logger.info("cimd", {
      message: "Client metadata fetched",
      url: clientIdUrl,
      clientName: parsed.data.client_name,
      redirectUrisCount: parsed.data.redirect_uris.length,
    });
    return { success: true, metadata: parsed.data };
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      logger.warning("cimd", {
        message: "Fetch timeout",
        url: clientIdUrl,
      });
      return { success: false, error: "fetch_timeout" };
    }
    logger.error("cimd", {
      message: "Fetch error",
      url: clientIdUrl,
      error: (error as Error).message,
    });
    return {
      success: false,
      error: `fetch_error: ${(error as Error).message}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function validateRedirectUri(
  metadata: ClientMetadata,
  redirectUri: string
) {
  return metadata.redirect_uris.includes(redirectUri);
}
