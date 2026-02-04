import type {
  ProviderTokens,
  RsRecord,
  SessionRecord,
  SessionStore,
  TokenStore,
  Transaction,
} from './interface.js';
import { MAX_SESSIONS_PER_API_KEY } from './interface.js';

const DEFAULT_TXN_TTL_MS = 10 * 60 * 1000;
const DEFAULT_CODE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RS_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_RS_RECORDS = 10000;
const MAX_TRANSACTIONS = 1000;
const MAX_SESSIONS = 10000;
const CLEANUP_INTERVAL_MS = 60000;

interface TimedEntry<T> {
  value: T;
  expiresAt: number;
  createdAt: number;
}

function evictOldest<
  K,
  V extends {
    created_at?: number;
    createdAt?: number;
  },
>(map: Map<K, V>, maxSize: number, countToRemove = 1) {
  if (map.size < maxSize) return;
  const entries = [...map.entries()].sort((a, b) => {
    const aTime = a[1].created_at ?? a[1].createdAt ?? 0;
    const bTime = b[1].created_at ?? b[1].createdAt ?? 0;
    return aTime - bTime;
  });
  for (let i = 0; i < countToRemove && i < entries.length; i++) {
    map.delete(entries[i][0]);
  }
}

function cleanupExpired<
  K,
  V extends {
    expiresAt: number;
  },
>(map: Map<K, V>) {
  const now = Date.now();
  let removed = 0;
  for (const [key, entry] of map) {
    if (now >= entry.expiresAt) {
      map.delete(key);
      removed++;
    }
  }
  return removed;
}

export class MemoryTokenStore implements TokenStore {
  protected rsAccessMap = new Map<
    string,
    RsRecord & {
      expiresAt: number;
    }
  >();
  protected rsRefreshMap = new Map<
    string,
    RsRecord & {
      expiresAt: number;
    }
  >();
  protected transactions = new Map<string, TimedEntry<Transaction>>();
  protected codes = new Map<string, TimedEntry<string>>();
  private cleanupIntervalId: ReturnType<typeof setInterval> | null = null;
  constructor() {
    this.startCleanup();
  }

  startCleanup() {
    if (this.cleanupIntervalId) return;
    this.cleanupIntervalId = setInterval(() => {
      this.cleanup();
    }, CLEANUP_INTERVAL_MS);
    if (
      typeof this.cleanupIntervalId === 'object' &&
      'unref' in this.cleanupIntervalId
    ) {
      this.cleanupIntervalId.unref();
    }
  }

  stopCleanup() {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
    }
  }

  cleanup() {
    const now = Date.now();
    let tokensRemoved = 0;
    for (const [key, entry] of this.rsAccessMap) {
      if (now >= entry.expiresAt) {
        this.rsAccessMap.delete(key);
        tokensRemoved++;
      }
    }
    for (const [key, entry] of this.rsRefreshMap) {
      if (now >= entry.expiresAt) {
        this.rsRefreshMap.delete(key);
      }
    }
    const transactionsRemoved = cleanupExpired(this.transactions);
    const codesRemoved = cleanupExpired(this.codes);
    return {
      tokens: tokensRemoved,
      transactions: transactionsRemoved,
      codes: codesRemoved,
    };
  }

  async storeRsMapping(
    rsAccess: string,
    provider: ProviderTokens,
    rsRefresh?: string,
    ttlMs: number = DEFAULT_RS_TOKEN_TTL_MS,
  ) {
    const now = Date.now();
    const expiresAt = now + ttlMs;
    evictOldest(this.rsAccessMap, MAX_RS_RECORDS, 10);
    if (rsRefresh) {
      const existing = this.rsRefreshMap.get(rsRefresh);
      if (existing) {
        this.rsAccessMap.delete(existing.rs_access_token);
        existing.rs_access_token = rsAccess;
        existing.provider = { ...provider };
        existing.expiresAt = expiresAt;
        this.rsAccessMap.set(rsAccess, existing);
        return existing;
      }
    }
    const record: RsRecord & {
      expiresAt: number;
    } = {
      rs_access_token: rsAccess,
      rs_refresh_token: rsRefresh ?? crypto.randomUUID(),
      provider: { ...provider },
      created_at: now,
      expiresAt,
    };
    this.rsAccessMap.set(record.rs_access_token, record);
    this.rsRefreshMap.set(record.rs_refresh_token, record);
    return record;
  }

  async getByRsAccess(rsAccess: string) {
    const entry = this.rsAccessMap.get(rsAccess);
    if (!entry) return null;
    if (Date.now() >= entry.expiresAt) {
      this.rsAccessMap.delete(rsAccess);
      this.rsRefreshMap.delete(entry.rs_refresh_token);
      return null;
    }
    return entry;
  }

  async getByRsRefresh(rsRefresh: string) {
    const entry = this.rsRefreshMap.get(rsRefresh);
    if (!entry) return null;
    if (Date.now() >= entry.expiresAt) {
      this.rsAccessMap.delete(entry.rs_access_token);
      this.rsRefreshMap.delete(rsRefresh);
      return null;
    }
    return entry;
  }

  async updateByRsRefresh(
    rsRefresh: string,
    provider: ProviderTokens,
    maybeNewRsAccess?: string,
    ttlMs: number = DEFAULT_RS_TOKEN_TTL_MS,
  ) {
    const rec = this.rsRefreshMap.get(rsRefresh);
    if (!rec) return null;
    const now = Date.now();
    if (maybeNewRsAccess) {
      this.rsAccessMap.delete(rec.rs_access_token);
      rec.rs_access_token = maybeNewRsAccess;
      rec.created_at = now;
    }
    rec.provider = { ...provider };
    rec.expiresAt = now + ttlMs;
    this.rsAccessMap.set(rec.rs_access_token, rec);
    this.rsRefreshMap.set(rsRefresh, rec);
    return rec;
  }

  async saveTransaction(txnId: string, txn: Transaction, ttlSeconds?: number) {
    const ttlMs = ttlSeconds ? ttlSeconds * 1000 : DEFAULT_TXN_TTL_MS;
    const now = Date.now();
    evictOldest(this.transactions, MAX_TRANSACTIONS, 10);
    this.transactions.set(txnId, {
      value: txn,
      expiresAt: now + ttlMs,
      createdAt: now,
    });
  }

  async getTransaction(txnId: string) {
    const entry = this.transactions.get(txnId);
    if (!entry) return null;
    if (Date.now() >= entry.expiresAt) {
      this.transactions.delete(txnId);
      return null;
    }
    return entry.value;
  }

  async deleteTransaction(txnId: string) {
    this.transactions.delete(txnId);
  }

  async saveCode(code: string, txnId: string, ttlSeconds?: number) {
    const ttlMs = ttlSeconds ? ttlSeconds * 1000 : DEFAULT_CODE_TTL_MS;
    const now = Date.now();
    this.codes.set(code, {
      value: txnId,
      expiresAt: now + ttlMs,
      createdAt: now,
    });
  }

  async getTxnIdByCode(code: string) {
    const entry = this.codes.get(code);
    if (!entry) return null;
    if (Date.now() >= entry.expiresAt) {
      this.codes.delete(code);
      return null;
    }
    return entry.value;
  }

  async deleteCode(code: string) {
    this.codes.delete(code);
  }

  getStats() {
    return {
      rsTokens: this.rsAccessMap.size,
      transactions: this.transactions.size,
      codes: this.codes.size,
    };
  }
}

type InternalSession = SessionRecord & {
  expiresAt: number;
  sessionId: string;
};

export class MemorySessionStore implements SessionStore {
  protected sessions = new Map<string, InternalSession>();
  private cleanupIntervalId: ReturnType<typeof setInterval> | null = null;
  constructor() {
    this.startCleanup();
  }

  startCleanup() {
    if (this.cleanupIntervalId) return;
    this.cleanupIntervalId = setInterval(() => {
      this.cleanup();
    }, CLEANUP_INTERVAL_MS);
    if (
      typeof this.cleanupIntervalId === 'object' &&
      'unref' in this.cleanupIntervalId
    ) {
      this.cleanupIntervalId.unref();
    }
  }

  stopCleanup() {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
    }
  }

  cleanup() {
    const now = Date.now();
    let removed = 0;
    for (const [sessionId, session] of this.sessions) {
      if (now >= session.expiresAt) {
        this.sessions.delete(sessionId);
        removed++;
      }
    }
    return removed;
  }

  async create(
    sessionId: string,
    apiKey: string,
    ttlMs: number = DEFAULT_SESSION_TTL_MS,
  ) {
    const count = await this.countByApiKey(apiKey);
    if (count >= MAX_SESSIONS_PER_API_KEY) {
      await this.deleteOldestByApiKey(apiKey);
    }
    if (this.sessions.size >= MAX_SESSIONS) {
      const oldest = [...this.sessions.entries()].sort(
        (a, b) => a[1].created_at - b[1].created_at,
      )[0];
      if (oldest) {
        this.sessions.delete(oldest[0]);
      }
    }
    const now = Date.now();
    const record: InternalSession = {
      sessionId,
      apiKey,
      created_at: now,
      last_accessed: now,
      initialized: false,
      expiresAt: now + ttlMs,
    };
    this.sessions.set(sessionId, record);
    return record;
  }

  async get(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    const now = Date.now();
    if (now >= session.expiresAt) {
      this.sessions.delete(sessionId);
      return null;
    }
    session.last_accessed = now;
    return session;
  }

  async update(sessionId: string, data: Partial<SessionRecord>) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const now = Date.now();
    Object.assign(session, data, { last_accessed: now });
  }

  async delete(sessionId: string) {
    this.sessions.delete(sessionId);
  }

  async getByApiKey(apiKey: string) {
    const results: SessionRecord[] = [];
    const now = Date.now();
    for (const session of this.sessions.values()) {
      if (session.apiKey === apiKey && now < session.expiresAt) {
        results.push(session);
      }
    }
    return results.sort((a, b) => b.last_accessed - a.last_accessed);
  }

  async countByApiKey(apiKey: string) {
    let count = 0;
    const now = Date.now();
    for (const session of this.sessions.values()) {
      if (session.apiKey === apiKey && now < session.expiresAt) {
        count++;
      }
    }
    return count;
  }

  async deleteOldestByApiKey(apiKey: string) {
    let oldest: InternalSession | null = null;
    const now = Date.now();
    for (const session of this.sessions.values()) {
      if (session.apiKey === apiKey && now < session.expiresAt) {
        if (!oldest || session.last_accessed < oldest.last_accessed) {
          oldest = session;
        }
      }
    }
    if (oldest) {
      this.sessions.delete(oldest.sessionId);
    }
  }

  async ensure(sessionId: string, ttlMs: number = DEFAULT_SESSION_TTL_MS) {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.expiresAt = Date.now() + ttlMs;
      existing.last_accessed = Date.now();
      return;
    }
    if (this.sessions.size >= MAX_SESSIONS) {
      const oldest = [...this.sessions.entries()].sort(
        (a, b) => a[1].created_at - b[1].created_at,
      )[0];
      if (oldest) {
        this.sessions.delete(oldest[0]);
      }
    }
    const now = Date.now();
    this.sessions.set(sessionId, {
      sessionId,
      created_at: now,
      last_accessed: now,
      expiresAt: now + ttlMs,
    });
  }

  async put(
    sessionId: string,
    value: SessionRecord,
    ttlMs: number = DEFAULT_SESSION_TTL_MS,
  ) {
    const now = Date.now();
    this.sessions.set(sessionId, {
      ...value,
      sessionId,
      last_accessed: value.last_accessed ?? now,
      expiresAt: now + ttlMs,
    });
  }

  getSessionCount() {
    return this.sessions.size;
  }
}
