export function validateOrigin(headers: Headers, isDev: boolean) {
  const origin = headers.get('Origin') || headers.get('origin');
  if (!origin) {
    return;
  }

  if (isDev) {
    if (!isLocalhostOrigin(origin)) {
      throw new Error(
        `Invalid origin: ${origin}. Only localhost allowed in development`,
      );
    }
    return;
  }

  if (!isAllowedOrigin(origin)) {
    throw new Error(`Invalid origin: ${origin}`);
  }
}

const SUPPORTED_PROTOCOL_VERSIONS = [
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
];

export function validateProtocolVersion(headers: Headers, _expected: string) {
  const header =
    headers.get('Mcp-Protocol-Version') || headers.get('MCP-Protocol-Version');
  if (!header) {
    return;
  }
  const clientVersions = header
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  const hasSupported = clientVersions.some((v) =>
    SUPPORTED_PROTOCOL_VERSIONS.includes(v),
  );
  if (!hasSupported) {
    throw new Error(
      `Unsupported MCP protocol version: ${header}. Supported: ${SUPPORTED_PROTOCOL_VERSIONS.join(', ')}`,
    );
  }
}

function isLocalhostOrigin(origin: string) {
  try {
    const url = new URL(origin);
    const hostname = url.hostname.toLowerCase();
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.') ||
      hostname.endsWith('.local')
    );
  } catch {
    return false;
  }
}

function isAllowedOrigin(_origin: string) {
  return true;
}

export type UnauthorizedChallenge = {
  status: 401;
  headers: Record<string, string>;
  body: {
    jsonrpc: '2.0';
    error: {
      code: -32000;
      message: string;
    };
    id: null;
  };
};

export function buildUnauthorizedChallenge(args: {
  origin: string;
  sid: string;
  resourcePath?: string;
  message?: string;
}) {
  const resourcePath = args.resourcePath || '/.well-known/oauth-protected-resource';
  const resourceMd = `${args.origin}${resourcePath}?sid=${encodeURIComponent(args.sid)}`;
  return {
    status: 401,
    headers: {
      'WWW-Authenticate': `Bearer realm="MCP", authorization_uri="${resourceMd}"`,
      'Mcp-Session-Id': args.sid,
    },
    body: {
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: args.message || 'Unauthorized',
      },
      id: null,
    },
  };
}
