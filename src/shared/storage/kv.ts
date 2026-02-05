import type {
  ProviderTokens,
  RsRecord,
  SessionRecord,
  SessionStore,
  TokenStore,
  Transaction,
} from './interface.js';
import { MAX_SESSIONS_PER_API_KEY } from './interface.js';
import { MemorySessionStore, MemoryTokenStore } from './memory.js';

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

type EncryptFn = (plaintext: string) => Promise<string> | string;

type DecryptFn = (ciphertext: string) => Promise<string> | string;

function ttl(seconds: number) {
  return Math.floor(Date.now() / 1000) + seconds;
}

function toJson(value: unknown) {
  return JSON.stringify(value);
}

function fromJson<T>(value: string | null) {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export class KvTokenStore implements TokenStore {
  private kv: KVNamespace;
  private encrypt: EncryptFn;
  private decrypt: DecryptFn;
  private fallback: MemoryTokenStore;
  constructor(
    kv: KVNamespace,
    options?: {
      encrypt?: EncryptFn;
      decrypt?: DecryptFn;
      fallback?: MemoryTokenStore;
    },
  ) {
    this.kv = kv;
    this.encrypt = options?.encrypt ?? ((s) => s);
    this.decrypt = options?.decrypt ?? ((s) => s);
    this.fallback = options?.fallback ?? new MemoryTokenStore();
  }
  private async putJson(
    key: string,
    value: unknown,
    options?: {
      expiration?: number;
      expirationTtl?: number;
    },
  ) {
    try {
      const raw = await this.encrypt(toJson(value));
      await this.kv.put(key, raw, options);
    } catch (error) {
      console.error('[KV] Write failed:', (error as Error).message);
      throw error;
    }
  }
  private async getJson<T>(key: string) {
    const raw = await this.kv.get(key);
    if (!raw) {
      return null;
    }
    const plain = await this.decrypt(raw);
    return fromJson<T>(plain);
  }

  async storeRsMapping(rsAccess: string, provider: ProviderTokens, rsRefresh?: string) {
    const rec: RsRecord = {
      rs_access_token: rsAccess,
      rs_refresh_token: rsRefresh ?? crypto.randomUUID(),
      provider: { ...provider },
      created_at: Date.now(),
    };
    await this.fallback.storeRsMapping(rsAccess, provider, rsRefresh);
    try {
      await Promise.all([
        this.putJson(`rs:access:${rec.rs_access_token}`, rec),
        this.putJson(`rs:refresh:${rec.rs_refresh_token}`, rec),
      ]);
    } catch (error) {
      console.warn(
        '[KV] Failed to persist RS mapping (using memory fallback):',
        (error as Error).message,
      );
    }
    return rec;
  }

  async getByRsAccess(rsAccess: string) {
    const rec = await this.getJson<RsRecord>(`rs:access:${rsAccess}`);
    return rec ?? (await this.fallback.getByRsAccess(rsAccess));
  }

  async getByRsRefresh(rsRefresh: string) {
    const rec = await this.getJson<RsRecord>(`rs:refresh:${rsRefresh}`);
    return rec ?? (await this.fallback.getByRsRefresh(rsRefresh));
  }

  async updateByRsRefresh(
    rsRefresh: string,
    provider: ProviderTokens,
    maybeNewRsAccess?: string,
  ) {
    const existing = await this.getJson<RsRecord>(`rs:refresh:${rsRefresh}`);
    if (!existing) {
      return this.fallback.updateByRsRefresh(rsRefresh, provider, maybeNewRsAccess);
    }
    const rsAccessChanged =
      maybeNewRsAccess && maybeNewRsAccess !== existing.rs_access_token;
    const next: RsRecord = {
      rs_access_token: maybeNewRsAccess || existing.rs_access_token,
      rs_refresh_token: rsRefresh,
      provider: { ...provider },
      created_at: Date.now(),
    };
    await this.fallback.updateByRsRefresh(rsRefresh, provider, maybeNewRsAccess);
    try {
      if (rsAccessChanged) {
        await Promise.all([
          this.kv.delete(`rs:access:${existing.rs_access_token}`),
          this.putJson(`rs:access:${next.rs_access_token}`, next),
          this.putJson(`rs:refresh:${rsRefresh}`, next),
        ]);
      } else {
        await Promise.all([
          this.putJson(`rs:access:${existing.rs_access_token}`, next),
          this.putJson(`rs:refresh:${rsRefresh}`, next),
        ]);
      }
    } catch (error) {
      console.warn(
        '[KV] Failed to update RS mapping (using memory fallback):',
        (error as Error).message,
      );
    }
    return next;
  }

  async saveTransaction(txnId: string, txn: Transaction, ttlSeconds = 600) {
    await this.fallback.saveTransaction(txnId, txn);
    try {
      await this.putJson(`txn:${txnId}`, txn, { expiration: ttl(ttlSeconds) });
    } catch (error) {
      console.warn(
        '[KV] Failed to save transaction (using memory):',
        (error as Error).message,
      );
    }
  }

  async getTransaction(txnId: string) {
    const txn = await this.getJson<Transaction>(`txn:${txnId}`);
    return txn ?? (await this.fallback.getTransaction(txnId));
  }

  async deleteTransaction(txnId: string) {
    await this.fallback.deleteTransaction(txnId);
  }

  async saveCode(code: string, txnId: string, ttlSeconds = 600) {
    await this.fallback.saveCode(code, txnId);
    try {
      await this.putJson(`code:${code}`, { v: txnId }, { expiration: ttl(ttlSeconds) });
    } catch (error) {
      console.warn(
        '[KV] Failed to save code (using memory):',
        (error as Error).message,
      );
    }
  }

  async getTxnIdByCode(code: string) {
    const obj = await this.getJson<{
      v: string;
    }>(`code:${code}`);
    return obj?.v ?? (await this.fallback.getTxnIdByCode(code));
  }

  async deleteCode(code: string) {
    await this.fallback.deleteCode(code);
  }
}

const SESSION_KEY_PREFIX = 'session:';
const SESSION_APIKEY_PREFIX = 'session:apikey:';
const SESSION_TTL_SECONDS = 24 * 60 * 60;

export class KvSessionStore implements SessionStore {
  private kv: KVNamespace;
  private encrypt: EncryptFn;
  private decrypt: DecryptFn;
  private fallback: MemorySessionStore;
  constructor(
    kv: KVNamespace,
    options?: {
      encrypt?: EncryptFn;
      decrypt?: DecryptFn;
      fallback?: MemorySessionStore;
    },
  ) {
    this.kv = kv;
    this.encrypt = options?.encrypt ?? ((s) => s);
    this.decrypt = options?.decrypt ?? ((s) => s);
    this.fallback = options?.fallback ?? new MemorySessionStore();
  }
  private async putSession(sessionId: string, value: SessionRecord) {
    const raw = await this.encrypt(toJson(value));
    await this.kv.put(`${SESSION_KEY_PREFIX}${sessionId}`, raw, {
      expiration: ttl(SESSION_TTL_SECONDS),
    });
  }
  private async getSession(sessionId: string) {
    const raw = await this.kv.get(`${SESSION_KEY_PREFIX}${sessionId}`);
    if (!raw) {
      return this.fallback.get(sessionId);
    }
    const plain = await this.decrypt(raw);
    return fromJson<SessionRecord>(plain);
  }
  private async getApiKeySessionIds(apiKey: string) {
    const raw = await this.kv.get(`${SESSION_APIKEY_PREFIX}${apiKey}`);
    if (!raw) return [];
    return fromJson<string[]>(raw) ?? [];
  }
  private async setApiKeySessionIds(apiKey: string, sessionIds: string[]) {
    if (sessionIds.length === 0) {
      await this.kv.delete(`${SESSION_APIKEY_PREFIX}${apiKey}`);
    } else {
      await this.kv.put(`${SESSION_APIKEY_PREFIX}${apiKey}`, toJson(sessionIds), {
        expiration: ttl(SESSION_TTL_SECONDS),
      });
    }
  }

  async create(sessionId: string, apiKey: string) {
    const currentCount = await this.countByApiKey(apiKey);
    if (currentCount >= MAX_SESSIONS_PER_API_KEY) {
      await this.deleteOldestByApiKey(apiKey);
    }
    const now = Date.now();
    const record: SessionRecord = {
      apiKey,
      created_at: now,
      last_accessed: now,
      initialized: false,
    };
    await this.putSession(sessionId, record);
    await this.fallback.create(sessionId, apiKey);
    const sessionIds = await this.getApiKeySessionIds(apiKey);
    if (!sessionIds.includes(sessionId)) {
      sessionIds.push(sessionId);
      await this.setApiKeySessionIds(apiKey, sessionIds);
    }
    return record;
  }

  async get(sessionId: string) {
    const session = await this.getSession(sessionId);
    if (!session) return null;
    const now = Date.now();
    session.last_accessed = now;
    this.putSession(sessionId, session).catch(() => {});
    return session;
  }

  async update(sessionId: string, data: Partial<SessionRecord>) {
    const session = await this.getSession(sessionId);
    if (!session) return;
    const updated: SessionRecord = {
      ...session,
      ...data,
      last_accessed: Date.now(),
    };
    await this.putSession(sessionId, updated);
    await this.fallback.update(sessionId, data);
  }

  async delete(sessionId: string) {
    const session = await this.getSession(sessionId);
    await this.kv.delete(`${SESSION_KEY_PREFIX}${sessionId}`);
    await this.fallback.delete(sessionId);
    if (session?.apiKey) {
      const sessionIds = await this.getApiKeySessionIds(session.apiKey);
      const filtered = sessionIds.filter((id) => id !== sessionId);
      await this.setApiKeySessionIds(session.apiKey, filtered);
    }
  }

  async getByApiKey(apiKey: string) {
    const sessionIds = await this.getApiKeySessionIds(apiKey);
    const sessions: SessionRecord[] = [];
    for (const sessionId of sessionIds) {
      const session = await this.getSession(sessionId);
      if (session) {
        sessions.push(session);
      }
    }
    return sessions.sort((a, b) => b.last_accessed - a.last_accessed);
  }

  async countByApiKey(apiKey: string) {
    const sessionIds = await this.getApiKeySessionIds(apiKey);
    return sessionIds.length;
  }

  async deleteOldestByApiKey(apiKey: string) {
    const sessions = await this.getByApiKey(apiKey);
    if (sessions.length === 0) return;
    const oldest = sessions[sessions.length - 1];
    const sessionIds = await this.getApiKeySessionIds(apiKey);
    for (const sessionId of sessionIds) {
      const session = await this.getSession(sessionId);
      if (session && session.created_at === oldest.created_at) {
        await this.delete(sessionId);
        return;
      }
    }
  }

  async ensure(sessionId: string) {
    const existing = await this.fallback.get(sessionId);
    if (!existing) {
      const now = Date.now();
      await this.fallback.put(sessionId, {
        created_at: now,
        last_accessed: now,
      });
    }
  }

  async put(sessionId: string, value: SessionRecord) {
    await this.putSession(sessionId, value);
    await this.fallback.put(sessionId, value);
    if (value.apiKey) {
      const sessionIds = await this.getApiKeySessionIds(value.apiKey);
      if (!sessionIds.includes(sessionId)) {
        sessionIds.push(sessionId);
        await this.setApiKeySessionIds(value.apiKey, sessionIds);
      }
    }
  }
}
