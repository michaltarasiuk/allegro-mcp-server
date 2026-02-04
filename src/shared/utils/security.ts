import { randomUUID } from 'node:crypto';
import type { UnifiedConfig } from '../config/env.js';

export const makeSessionId = () => randomUUID();

export const makeEventId = () => randomUUID();

export const validateProtocolVersion = (headers: Headers, expectedVersion: string) => {
  const header =
    headers.get('Mcp-Protocol-Version') || headers.get('MCP-Protocol-Version');
  if (!header) return;
  if (header !== expectedVersion) {
    throw new Error(
      `Unsupported MCP protocol version: ${header}. Expected ${expectedVersion}`,
    );
  }
};

export const validateOrigin = (
  headers: Headers,
  config: Pick<UnifiedConfig, 'NODE_ENV'>,
) => {
  const origin = headers.get('Origin') || headers.get('origin');
  if (config.NODE_ENV === 'development') {
    if (origin && !isLocalhostOrigin(origin)) {
      throw new Error(
        `Invalid origin: ${origin}. Only localhost allowed in development`,
      );
    }
    return;
  }

  if (origin && !isAllowedOrigin(origin)) {
    throw new Error(`Invalid origin: ${origin}`);
  }
};

const isLocalhostOrigin = (origin: string) => {
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
};
const isAllowedOrigin = (_origin: string) => {
  console.warn('Origin validation not implemented for production');
  return true;
};

export const redactSensitiveData = (obj: Record<string, unknown>) => {
  const sensitiveKeys = [
    'password',
    'token',
    'secret',
    'key',
    'authorization',
    'apikey',
    'api_key',
    'access_token',
    'refresh_token',
  ];
  const redacted = { ...obj };
  for (const [key, value] of Object.entries(redacted)) {
    if (sensitiveKeys.some((sensitive) => key.toLowerCase().includes(sensitive))) {
      redacted[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      redacted[key] = redactSensitiveData(value as Record<string, unknown>);
    }
  }
  return redacted;
};
