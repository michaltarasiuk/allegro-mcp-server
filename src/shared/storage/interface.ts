export type ProviderTokens = {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  scopes?: string[];
};

export type RsRecord = {
  rs_access_token: string;
  rs_refresh_token: string;
  provider: ProviderTokens;
  created_at: number;
};

export type Transaction = {
  codeChallenge: string;
  state?: string;
  scope?: string;
  createdAt: number;
  sid?: string;
  provider?: ProviderTokens;
};

export type SessionRecord = {
  apiKey?: string;
  rs_access_token?: string;
  rs_refresh_token?: string;
  provider?: ProviderTokens | null;
  created_at: number;
  last_accessed: number;
  initialized?: boolean;
  protocolVersion?: string;
};

export interface TokenStore {
  storeRsMapping(
    rsAccess: string,
    provider: ProviderTokens,
    rsRefresh?: string,
  ): Promise<RsRecord>;
  getByRsAccess(rsAccess: string): Promise<RsRecord | null>;
  getByRsRefresh(rsRefresh: string): Promise<RsRecord | null>;
  updateByRsRefresh(
    rsRefresh: string,
    provider: ProviderTokens,
    maybeNewRsAccess?: string,
  ): Promise<RsRecord | null>;
  saveTransaction(txnId: string, txn: Transaction, ttlSeconds?: number): Promise<void>;
  getTransaction(txnId: string): Promise<Transaction | null>;
  deleteTransaction(txnId: string): Promise<void>;
  saveCode(code: string, txnId: string, ttlSeconds?: number): Promise<void>;
  getTxnIdByCode(code: string): Promise<string | null>;
  deleteCode(code: string): Promise<void>;
}

export const MAX_SESSIONS_PER_API_KEY = 5;

export interface SessionStore {
  create(sessionId: string, apiKey: string): Promise<SessionRecord>;
  get(sessionId: string): Promise<SessionRecord | null>;
  update(sessionId: string, data: Partial<SessionRecord>): Promise<void>;
  delete(sessionId: string): Promise<void>;
  getByApiKey(apiKey: string): Promise<SessionRecord[]>;
  countByApiKey(apiKey: string): Promise<number>;
  deleteOldestByApiKey(apiKey: string): Promise<void>;
  ensure(sessionId: string): Promise<void>;
  put(sessionId: string, value: SessionRecord): Promise<void>;
}
