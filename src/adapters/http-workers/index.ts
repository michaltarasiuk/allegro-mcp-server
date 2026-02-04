import { Router } from 'itty-router';
import type { UnifiedConfig } from '../../shared/config/env.js';
import { createEncryptor } from '../../shared/crypto/aes-gcm.js';
import { corsPreflightResponse, withCors } from '../../shared/http/cors.js';
import type { SessionStore, TokenStore } from '../../shared/storage/interface.js';
import { KvSessionStore, KvTokenStore } from '../../shared/storage/kv.js';
import { MemorySessionStore, MemoryTokenStore } from '../../shared/storage/memory.js';
import { initializeStorage } from '../../shared/storage/singleton.js';
import { sharedLogger as logger } from '../../shared/utils/logger.js';
import { handleMcpDelete, handleMcpGet, handleMcpRequest } from './mcp.handler.js';
import { attachDiscoveryRoutes } from './routes.discovery.js';
import { attachOAuthRoutes } from './routes.oauth.js';

export interface WorkerEnv {
  TOKENS?: KVNamespace;
  RS_TOKENS_ENC_KEY?: string;
  [key: string]: unknown;
}

interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: {
      expiration?: number;
      expirationTtl?: number;
    },
  ): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface RouterContext {
  tokenStore: TokenStore;
  sessionStore: SessionStore;
  config: UnifiedConfig;
}

let sharedTokenStore: MemoryTokenStore | null = null;
let sharedSessionStore: MemorySessionStore | null = null;

export function initializeWorkerStorage(env: WorkerEnv, config: UnifiedConfig) {
  const kvNamespace = env.TOKENS;
  if (!kvNamespace) {
    logger.error('worker_storage', {
      message: 'No KV namespace bound - storage unavailable',
    });
    return null;
  }

  if (!sharedTokenStore || !sharedSessionStore) {
    sharedTokenStore = new MemoryTokenStore();
    sharedSessionStore = new MemorySessionStore();
  }
  let encrypt: (s: string) => Promise<string>;
  let decrypt: (s: string) => Promise<string>;
  if (env.RS_TOKENS_ENC_KEY) {
    const encryptor = createEncryptor(env.RS_TOKENS_ENC_KEY);
    encrypt = encryptor.encrypt;
    decrypt = encryptor.decrypt;
    logger.debug('worker_storage', { message: 'KV encryption enabled' });
  } else {
    encrypt = async (s) => s;
    decrypt = async (s) => s;
    if (config.NODE_ENV === 'production') {
      logger.warning('worker_storage', {
        message: 'RS_TOKENS_ENC_KEY not set! KV data is unencrypted.',
      });
    }
  }
  const tokenStore = new KvTokenStore(kvNamespace, {
    encrypt,
    decrypt,
    fallback: sharedTokenStore,
  });
  const sessionStore = new KvSessionStore(kvNamespace, {
    encrypt,
    decrypt,
    fallback: sharedSessionStore,
  });
  initializeStorage(tokenStore, sessionStore);
  return { tokenStore, sessionStore };
}
const MCP_ENDPOINT_PATH = '/mcp';

export function createWorkerRouter(ctx: RouterContext) {
  const router = Router();
  const { tokenStore, sessionStore, config } = ctx;
  router.options('*', () => corsPreflightResponse());
  attachDiscoveryRoutes(router, config);
  attachOAuthRoutes(router, tokenStore, config);
  router.get(MCP_ENDPOINT_PATH, () => handleMcpGet());
  router.post(MCP_ENDPOINT_PATH, (request: Request) =>
    handleMcpRequest(request, { tokenStore, sessionStore, config }),
  );
  router.delete(MCP_ENDPOINT_PATH, (request: Request) =>
    handleMcpDelete(request, { tokenStore, sessionStore, config }),
  );
  router.get('/health', () =>
    withCors(
      new Response(JSON.stringify({ status: 'ok', timestamp: Date.now() }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
  router.all('*', () => withCors(new Response('Not Found', { status: 404 })));
  return router;
}

export function shimProcessEnv(env: WorkerEnv) {
  const g = globalThis as unknown as {
    process?: {
      env?: Record<string, unknown>;
    };
  };
  g.process = g.process || {};
  g.process.env = { ...(g.process.env ?? {}), ...(env as Record<string, unknown>) };
}
