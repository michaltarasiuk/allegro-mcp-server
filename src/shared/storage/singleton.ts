import { FileTokenStore } from './file.js';
import type { SessionStore, TokenStore } from './interface.js';
import { MemorySessionStore } from './memory.js';

let tokenStoreInstance: TokenStore | null = null;
let sessionStoreInstance: SessionStore | null = null;

export function initializeStorage(tokenStore: TokenStore, sessionStore: SessionStore) {
  tokenStoreInstance = tokenStore;
  sessionStoreInstance = sessionStore;
}

export function getTokenStore() {
  if (!tokenStoreInstance) {
    const persistPath =
      (process.env.RS_TOKENS_FILE as string | undefined) ||
      '.data/provider-tokens.json';
    tokenStoreInstance = new FileTokenStore(persistPath);
  }
  return tokenStoreInstance;
}

export function getSessionStore() {
  if (!sessionStoreInstance) {
    sessionStoreInstance = new MemorySessionStore();
  }
  return sessionStoreInstance;
}
