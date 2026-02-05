const BLOCKED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "0.0.0.0",
  "[::1]",
]);
const PRIVATE_IP_PATTERNS = [
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^fc00:/i,
  /^fd00:/i,
  /^fe80:/i,
];
const BLOCKED_DOMAIN_PATTERNS = [
  /\.local$/i,
  /\.internal$/i,
  /\.localhost$/i,
  /\.localdomain$/i,
  /\.corp$/i,
  /\.lan$/i,
];

function isPrivateIp(hostname: string) {
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(hostname)) {
      return true;
    }
  }
  return false;
}

function isBlockedDomain(hostname: string) {
  const lower = hostname.toLowerCase();
  for (const pattern of BLOCKED_DOMAIN_PATTERNS) {
    if (pattern.test(lower)) {
      return true;
    }
  }
  return false;
}

export type SsrfCheckResult =
  | {
      safe: true;
    }
  | {
      safe: false;
      reason: string;
    };

export function checkSsrfSafe(
  urlString: string,
  options?: {
    requireNonRootPath?: boolean;
  }
) {
  const requireNonRootPath = options?.requireNonRootPath ?? true;
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return { safe: false, reason: "invalid_url" };
  }

  if (url.protocol !== "https:") {
    return { safe: false, reason: "https_required" };
  }
  const hostname = url.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(hostname)) {
    return { safe: false, reason: "blocked_host" };
  }

  if (isPrivateIp(hostname)) {
    return { safe: false, reason: "private_ip" };
  }

  if (isBlockedDomain(hostname)) {
    return { safe: false, reason: "internal_domain" };
  }

  if (requireNonRootPath && (url.pathname === "/" || url.pathname === "")) {
    return { safe: false, reason: "root_path_not_allowed" };
  }
  return { safe: true };
}

export function isSsrfSafe(
  urlString: string,
  options?: {
    requireNonRootPath?: boolean;
  }
) {
  return checkSsrfSafe(urlString, options).safe;
}

export function assertSsrfSafe(
  urlString: string,
  options?: {
    requireNonRootPath?: boolean;
  }
) {
  const result = checkSsrfSafe(urlString, options);
  if (result.safe === false) {
    throw new Error(`ssrf_blocked: ${result.reason}`);
  }
}
