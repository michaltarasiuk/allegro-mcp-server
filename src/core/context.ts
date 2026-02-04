import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestContext } from '../shared/types/context.js';
import { createCancellationToken } from '../shared/utils/cancellation.js';
import { sharedLogger as logger } from '../shared/utils/logger.js';

export const authContextStorage = new AsyncLocalStorage<RequestContext>();

export function getCurrentAuthContext() {
  return authContextStorage.getStore();
}

class ContextRegistry {
  private contexts = new Map<string | number, RequestContext>();
  create(
    requestId: string | number,
    sessionId?: string,
    authData?: {
      authStrategy?: RequestContext['authStrategy'];
      authHeaders?: RequestContext['authHeaders'];
      resolvedHeaders?: RequestContext['resolvedHeaders'];
      rsToken?: string;
      providerToken?: string;
      provider?: RequestContext['provider'];
      serviceToken?: string;
    },
  ) {
    const context: RequestContext = {
      sessionId,
      cancellationToken: createCancellationToken(),
      requestId,
      timestamp: Date.now(),
      authStrategy: authData?.authStrategy,
      authHeaders: authData?.authHeaders,
      resolvedHeaders: authData?.resolvedHeaders,
      rsToken: authData?.rsToken,
      providerToken: authData?.providerToken,
      provider: authData?.provider,
      serviceToken: authData?.serviceToken ?? authData?.providerToken,
    };
    this.contexts.set(requestId, context);
    return context;
  }

  get(requestId: string | number) {
    return this.contexts.get(requestId);
  }

  getCancellationToken(requestId: string | number) {
    return this.contexts.get(requestId)?.cancellationToken;
  }

  cancel(requestId: string | number, _reason?: string) {
    const context = this.contexts.get(requestId);
    if (!context) return false;
    context.cancellationToken.cancel();
    return true;
  }

  delete(requestId: string | number) {
    return this.contexts.delete(requestId);
  }

  deleteBySession(sessionId: string) {
    let deleted = 0;
    for (const [requestId, context] of this.contexts.entries()) {
      if (context.sessionId === sessionId) {
        this.contexts.delete(requestId);
        deleted++;
      }
    }
    if (deleted > 0) {
      logger.debug('context_registry', {
        message: 'Cleaned up contexts for session',
        sessionId,
        count: deleted,
      });
    }
    return deleted;
  }
  get size() {
    return this.contexts.size;
  }

  cleanupExpired(maxAgeMs = 10 * 60 * 1000) {
    const now = Date.now();
    let cleaned = 0;
    for (const [requestId, context] of this.contexts.entries()) {
      if (now - context.timestamp > maxAgeMs) {
        this.contexts.delete(requestId);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      logger.warning('context_registry', {
        message: 'Cleaned up expired contexts (this indicates missing cleanup calls)',
        count: cleaned,
        maxAgeMs,
      });
    }
    return cleaned;
  }

  clear() {
    this.contexts.clear();
  }
}

export const contextRegistry = new ContextRegistry();
let cleanupIntervalId: ReturnType<typeof setInterval> | null = null;

export function startContextCleanup(intervalMs = 60000, maxAgeMs = 10 * 60 * 1000) {
  if (cleanupIntervalId) return;
  cleanupIntervalId = setInterval(() => {
    contextRegistry.cleanupExpired(maxAgeMs);
  }, intervalMs);
  cleanupIntervalId.unref?.();
}

export function stopContextCleanup() {
  if (cleanupIntervalId) {
    clearInterval(cleanupIntervalId);
    cleanupIntervalId = null;
  }
}
