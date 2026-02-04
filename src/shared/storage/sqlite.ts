import Database from 'better-sqlite3';
import dedent from 'dedent';
import { asc, count, eq, lt } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { ProviderTokens, SessionRecord, SessionStore } from './interface.js';
import { MAX_SESSIONS_PER_API_KEY } from './interface.js';

export const sessions = sqliteTable('sessions', {
  sessionId: text('session_id').primaryKey(),
  apiKey: text('api_key'),
  rsAccessToken: text('rs_access_token'),
  rsRefreshToken: text('rs_refresh_token'),
  providerJson: text('provider_json'),
  createdAt: integer('created_at').notNull(),
  lastAccessed: integer('last_accessed').notNull(),
  initialized: integer('initialized').default(0),
  protocolVersion: text('protocol_version'),
});

export type SessionRow = typeof sessions.$inferSelect;

function safeJsonParse<T>(json: string | null) {
  if (!json) return null;
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

function rowToRecord(row: SessionRow) {
  return {
    apiKey: row.apiKey || undefined,
    rs_access_token: row.rsAccessToken || undefined,
    rs_refresh_token: row.rsRefreshToken || undefined,
    provider: safeJsonParse<ProviderTokens>(row.providerJson),
    created_at: row.createdAt,
    last_accessed: row.lastAccessed,
    initialized: row.initialized === 1,
    protocolVersion: row.protocolVersion || undefined,
  };
}

export class SqliteSessionStore implements SessionStore {
  private db: BetterSQLite3Database;
  private sqlite: Database.Database;
  private createSessionTxn: ReturnType<typeof this.sqlite.transaction>;
  constructor(dbPath: string = './sessions.db') {
    this.sqlite = new Database(dbPath);
    this.sqlite.pragma('journal_mode = WAL');
    this.db = drizzle(this.sqlite);
    this.initSchema();
    this.createSessionTxn = this.sqlite.transaction(
      (sessionId: string, apiKey: string, now: number) => {
        const countResult = this.sqlite
          .prepare('SELECT COUNT(*) as cnt FROM sessions WHERE api_key = ?')
          .get(apiKey) as {
          cnt: number;
        };
        if (countResult.cnt >= MAX_SESSIONS_PER_API_KEY) {
          const oldest = this.sqlite
            .prepare(
              'SELECT session_id FROM sessions WHERE api_key = ? ORDER BY last_accessed ASC LIMIT 1',
            )
            .get(apiKey) as
            | {
                session_id: string;
              }
            | undefined;
          if (oldest) {
            this.sqlite
              .prepare('DELETE FROM sessions WHERE session_id = ?')
              .run(oldest.session_id);
          }
        }
        this.sqlite
          .prepare(dedent`
            INSERT INTO sessions (session_id, api_key, created_at, last_accessed, initialized)
            VALUES (?, ?, ?, ?, 0)
            ON CONFLICT(session_id) DO UPDATE SET
              api_key = excluded.api_key,
              last_accessed = excluded.last_accessed,
              initialized = 0
          `)
          .run(sessionId, apiKey, now, now);
      },
    );
  }
  private initSchema() {
    this.sqlite.exec(dedent`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        api_key TEXT,
        rs_access_token TEXT,
        rs_refresh_token TEXT,
        provider_json TEXT,
        created_at INTEGER NOT NULL,
        last_accessed INTEGER NOT NULL,
        initialized INTEGER DEFAULT 0,
        protocol_version TEXT
      )
    `);
    this.sqlite.exec(dedent`
      CREATE INDEX IF NOT EXISTS idx_sessions_api_key ON sessions(api_key)
    `);
    this.sqlite.exec(dedent`
      CREATE INDEX IF NOT EXISTS idx_sessions_api_key_accessed ON sessions(api_key, last_accessed)
    `);
    this.sqlite.exec(dedent`
      CREATE INDEX IF NOT EXISTS idx_sessions_last_accessed ON sessions(last_accessed)
    `);
  }

  async create(sessionId: string, apiKey: string) {
    const now = Date.now();
    this.createSessionTxn(sessionId, apiKey, now);
    return {
      apiKey,
      created_at: now,
      last_accessed: now,
      initialized: false,
    };
  }

  async get(sessionId: string) {
    const rows = await this.db
      .select()
      .from(sessions)
      .where(eq(sessions.sessionId, sessionId))
      .limit(1);
    if (rows.length === 0) return null;
    const now = Date.now();
    await this.db
      .update(sessions)
      .set({ lastAccessed: now })
      .where(eq(sessions.sessionId, sessionId));
    const record = rowToRecord(rows[0]);
    record.last_accessed = now;
    return record;
  }

  async update(sessionId: string, data: Partial<SessionRecord>) {
    const updates: Partial<SessionRow> = {
      lastAccessed: Date.now(),
    };
    if (data.initialized !== undefined) {
      updates.initialized = data.initialized ? 1 : 0;
    }
    if (data.protocolVersion !== undefined) {
      updates.protocolVersion = data.protocolVersion;
    }
    if (data.rs_access_token !== undefined) {
      updates.rsAccessToken = data.rs_access_token;
    }
    if (data.rs_refresh_token !== undefined) {
      updates.rsRefreshToken = data.rs_refresh_token;
    }
    if (data.provider !== undefined) {
      updates.providerJson = data.provider ? JSON.stringify(data.provider) : null;
    }
    await this.db
      .update(sessions)
      .set(updates)
      .where(eq(sessions.sessionId, sessionId));
  }

  async delete(sessionId: string) {
    await this.db.delete(sessions).where(eq(sessions.sessionId, sessionId));
  }

  async getByApiKey(apiKey: string) {
    const rows = await this.db
      .select()
      .from(sessions)
      .where(eq(sessions.apiKey, apiKey))
      .orderBy(asc(sessions.lastAccessed));
    return rows.map(rowToRecord);
  }

  async countByApiKey(apiKey: string) {
    const result = await this.db
      .select({ value: count() })
      .from(sessions)
      .where(eq(sessions.apiKey, apiKey));
    return result[0]?.value ?? 0;
  }

  async deleteOldestByApiKey(apiKey: string) {
    const oldest = await this.db
      .select({ sessionId: sessions.sessionId })
      .from(sessions)
      .where(eq(sessions.apiKey, apiKey))
      .orderBy(asc(sessions.lastAccessed))
      .limit(1);
    if (oldest.length > 0) {
      await this.delete(oldest[0].sessionId);
    }
  }

  async ensure(sessionId: string) {
    const existing = await this.get(sessionId);
    if (!existing) {
      const now = Date.now();
      await this.db
        .insert(sessions)
        .values({
          sessionId,
          createdAt: now,
          lastAccessed: now,
          initialized: 0,
        })
        .onConflictDoNothing();
    }
  }

  async put(sessionId: string, value: SessionRecord) {
    const now = Date.now();
    await this.db
      .insert(sessions)
      .values({
        sessionId,
        apiKey: value.apiKey ?? null,
        rsAccessToken: value.rs_access_token ?? null,
        rsRefreshToken: value.rs_refresh_token ?? null,
        providerJson: value.provider ? JSON.stringify(value.provider) : null,
        createdAt: value.created_at,
        lastAccessed: now,
        initialized: value.initialized ? 1 : 0,
        protocolVersion: value.protocolVersion ?? null,
      })
      .onConflictDoUpdate({
        target: sessions.sessionId,
        set: {
          apiKey: value.apiKey ?? null,
          rsAccessToken: value.rs_access_token ?? null,
          rsRefreshToken: value.rs_refresh_token ?? null,
          providerJson: value.provider ? JSON.stringify(value.provider) : null,
          lastAccessed: now,
          initialized: value.initialized ? 1 : 0,
          protocolVersion: value.protocolVersion ?? null,
        },
      });
  }

  close() {
    this.sqlite.close();
  }

  async cleanup(ttlMs: number = 24 * 60 * 60 * 1000) {
    const cutoff = Date.now() - ttlMs;
    const result = await this.db
      .delete(sessions)
      .where(lt(sessions.lastAccessed, cutoff));
    return (
      result as unknown as {
        changes: number;
      }
    ).changes;
  }

  async getStats() {
    const result = await this.db.select({ value: count() }).from(sessions);
    return { sessions: result[0]?.value ?? 0 };
  }
}
