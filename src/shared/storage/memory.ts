import type {
  ProviderTokens,
  RsRecord,
  SessionRecord,
  SessionStore,
  TokenStore,
  Transaction,
} from "./interface.js";
import { MAX_SESSIONS_PER_API_KEY } from "./interface.js";

const DEFAULT_TXN_TTL_MS = 10 * 60 * 1000;
const DEFAULT_CODE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RS_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_RS_RECORDS = 10_000;
const MAX_TRANSACTIONS = 1000;
const MAX_SESSIONS = 10_000;
const CLEANUP_INTERVAL_MS = 60_000;

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
  if (map.size < maxSize) {
    return;
  }
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
    if (this.cleanupIntervalId) {
      return;
    }
    this.cleanupIntervalId = setInterval(() => {
      this.cleanup();
    }, CLEANUP_INTERVAL_MS);
    if (
      typeof this.cleanupIntervalId === "object" &&
      "unref" in this.cleanupIntervalId
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

  storeRsMapping(
    rsAccess: string,
    provider: ProviderTokens,
    rsRefresh?: string,
    ttlMs: number = DEFAULT_RS_TOKEN_TTL_MS
  ): Promise<RsRecord & { expiresAt: number }> {
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
        return Promise.resolve(existing);
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
    return Promise.resolve(record);
  }

  getByRsAccess(
    rsAccess: string
  ): Promise<(RsRecord & { expiresAt: number }) | null> {
    const entry = this.rsAccessMap.get(rsAccess);
    if (!entry) {
      return Promise.resolve(null);
    }
    if (Date.now() >= entry.expiresAt) {
      this.rsAccessMap.delete(rsAccess);
      this.rsRefreshMap.delete(entry.rs_refresh_token);
      return Promise.resolve(null);
    }
    return Promise.resolve(entry);
  }

  getByRsRefresh(
    rsRefresh: string
  ): Promise<(RsRecord & { expiresAt: number }) | null> {
    const entry = this.rsRefreshMap.get(rsRefresh);
    if (!entry) {
      return Promise.resolve(null);
    }
    if (Date.now() >= entry.expiresAt) {
      this.rsAccessMap.delete(entry.rs_access_token);
      this.rsRefreshMap.delete(rsRefresh);
      return Promise.resolve(null);
    }
    return Promise.resolve(entry);
  }

  updateByRsRefresh(
    rsRefresh: string,
    provider: ProviderTokens,
    maybeNewRsAccess?: string,
    ttlMs: number = DEFAULT_RS_TOKEN_TTL_MS
  ): Promise<(RsRecord & { expiresAt: number }) | null> {
    const rec = this.rsRefreshMap.get(rsRefresh);
    if (!rec) {
      return Promise.resolve(null);
    }
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
    return Promise.resolve(rec);
  }

  saveTransaction(
    txnId: string,
    txn: Transaction,
    ttlSeconds?: number
  ): Promise<void> {
    const ttlMs = ttlSeconds ? ttlSeconds * 1000 : DEFAULT_TXN_TTL_MS;
    const now = Date.now();
    evictOldest(this.transactions, MAX_TRANSACTIONS, 10);
    this.transactions.set(txnId, {
      value: txn,
      expiresAt: now + ttlMs,
      createdAt: now,
    });
    return Promise.resolve();
  }

  getTransaction(txnId: string): Promise<Transaction | null> {
    const entry = this.transactions.get(txnId);
    if (!entry) {
      return Promise.resolve(null);
    }
    if (Date.now() >= entry.expiresAt) {
      this.transactions.delete(txnId);
      return Promise.resolve(null);
    }
    return Promise.resolve(entry.value);
  }

  deleteTransaction(txnId: string): Promise<void> {
    this.transactions.delete(txnId);
    return Promise.resolve();
  }

  saveCode(code: string, txnId: string, ttlSeconds?: number): Promise<void> {
    const ttlMs = ttlSeconds ? ttlSeconds * 1000 : DEFAULT_CODE_TTL_MS;
    const now = Date.now();
    this.codes.set(code, {
      value: txnId,
      expiresAt: now + ttlMs,
      createdAt: now,
    });
    return Promise.resolve();
  }

  getTxnIdByCode(code: string): Promise<string | null> {
    const entry = this.codes.get(code);
    if (!entry) {
      return Promise.resolve(null);
    }
    if (Date.now() >= entry.expiresAt) {
      this.codes.delete(code);
      return Promise.resolve(null);
    }
    return Promise.resolve(entry.value);
  }

  deleteCode(code: string): Promise<void> {
    this.codes.delete(code);
    return Promise.resolve();
  }

  getStats() {
    return {
      rsTokens: this.rsAccessMap.size,
      transactions: this.transactions.size,
      codes: this.codes.size,
    };
  }
}

interface InternalSession extends SessionRecord {
  expiresAt: number;
  sessionId: string;
}

export class MemorySessionStore implements SessionStore {
  protected sessions = new Map<string, InternalSession>();
  private cleanupIntervalId: ReturnType<typeof setInterval> | null = null;
  constructor() {
    this.startCleanup();
  }

  startCleanup() {
    if (this.cleanupIntervalId) {
      return;
    }
    this.cleanupIntervalId = setInterval(() => {
      this.cleanup();
    }, CLEANUP_INTERVAL_MS);
    if (
      typeof this.cleanupIntervalId === "object" &&
      "unref" in this.cleanupIntervalId
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
    ttlMs: number = DEFAULT_SESSION_TTL_MS
  ) {
    const count = await this.countByApiKey(apiKey);
    if (count >= MAX_SESSIONS_PER_API_KEY) {
      await this.deleteOldestByApiKey(apiKey);
    }
    if (this.sessions.size >= MAX_SESSIONS) {
      const oldest = [...this.sessions.entries()].sort(
        (a, b) => a[1].created_at - b[1].created_at
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

  get(sessionId: string): Promise<SessionRecord | null> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return Promise.resolve(null);
    }
    const now = Date.now();
    if (now >= session.expiresAt) {
      this.sessions.delete(sessionId);
      return Promise.resolve(null);
    }
    session.last_accessed = now;
    return Promise.resolve(session);
  }

  update(sessionId: string, data: Partial<SessionRecord>): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return Promise.resolve();
    }
    const now = Date.now();
    Object.assign(session, data, { last_accessed: now });
    return Promise.resolve();
  }

  delete(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
    return Promise.resolve();
  }

  getByApiKey(apiKey: string): Promise<SessionRecord[]> {
    const results: SessionRecord[] = [];
    const now = Date.now();
    for (const session of this.sessions.values()) {
      if (session.apiKey === apiKey && now < session.expiresAt) {
        results.push(session);
      }
    }
    return Promise.resolve(
      results.sort((a, b) => b.last_accessed - a.last_accessed)
    );
  }

  countByApiKey(apiKey: string): Promise<number> {
    let count = 0;
    const now = Date.now();
    for (const session of this.sessions.values()) {
      if (session.apiKey === apiKey && now < session.expiresAt) {
        count++;
      }
    }
    return Promise.resolve(count);
  }

  deleteOldestByApiKey(apiKey: string): Promise<void> {
    let oldest: InternalSession | null = null;
    const now = Date.now();
    for (const session of this.sessions.values()) {
      if (
        session.apiKey === apiKey &&
        now < session.expiresAt &&
        (!oldest || session.last_accessed < oldest.last_accessed)
      ) {
        oldest = session;
      }
    }
    if (oldest) {
      this.sessions.delete(oldest.sessionId);
    }
    return Promise.resolve();
  }

  ensure(
    sessionId: string,
    ttlMs: number = DEFAULT_SESSION_TTL_MS
  ): Promise<void> {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.expiresAt = Date.now() + ttlMs;
      existing.last_accessed = Date.now();
      return Promise.resolve();
    }
    if (this.sessions.size >= MAX_SESSIONS) {
      const oldest = [...this.sessions.entries()].sort(
        (a, b) => a[1].created_at - b[1].created_at
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
    return Promise.resolve();
  }

  put(
    sessionId: string,
    value: SessionRecord,
    ttlMs: number = DEFAULT_SESSION_TTL_MS
  ): Promise<void> {
    const now = Date.now();
    this.sessions.set(sessionId, {
      ...value,
      sessionId,
      last_accessed: value.last_accessed ?? now,
      expiresAt: now + ttlMs,
    });
    return Promise.resolve();
  }

  getSessionCount() {
    return this.sessions.size;
  }
}
