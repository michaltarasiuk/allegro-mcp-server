import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createEncryptor, type Encryptor } from '../crypto/aes-gcm.js';
import { sharedLogger as logger } from '../utils/logger.js';
import type { ProviderTokens, RsRecord, TokenStore, Transaction } from './interface.js';
import { MemoryTokenStore } from './memory.js';

const SECURE_FILE_MODE = 0o600;
const SECURE_DIR_MODE = 0o700;

interface PersistShape {
  version: number;
  encrypted: boolean;
  records: Array<RsRecord>;
}

export class FileTokenStore implements TokenStore {
  private memory: MemoryTokenStore;
  private persistPath: string | null;
  private encryptor: Encryptor | null = null;
  private saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingSave: Promise<void> | null = null;
  constructor(persistPath?: string, encryptionKey?: string) {
    this.memory = new MemoryTokenStore();
    this.persistPath = persistPath ?? null;
    if (encryptionKey) {
      try {
        this.encryptor = createEncryptor(encryptionKey);
        logger.debug('file_token_store', { message: 'Encryption enabled' });
      } catch (error) {
        logger.error('file_token_store', {
          message: 'Failed to initialize encryption',
          error: (error as Error).message,
        });
        throw error;
      }
    } else if (process.env.NODE_ENV === 'production') {
      logger.warning('file_token_store', {
        message: 'No encryption key provided! Tokens stored in plaintext.',
      });
    }
    this.loadAsync().catch((err) => {
      logger.error('file_token_store', {
        message: 'Initial load failed',
        error: err.message,
      });
    });
  }
  private async loadAsync() {
    if (!this.persistPath) {
      logger.debug('file_token_store', { message: 'No persistPath, skipping load' });
      return;
    }
    try {
      if (!existsSync(this.persistPath)) {
        logger.debug('file_token_store', {
          message: 'File does not exist',
          path: this.persistPath,
        });
        return;
      }
      let raw = readFileSync(this.persistPath, 'utf8');
      let data: PersistShape;
      try {
        data = JSON.parse(raw) as PersistShape;
      } catch {
        if (this.encryptor) {
          try {
            raw = await this.encryptor.decrypt(raw);
            data = JSON.parse(raw) as PersistShape;
          } catch (decryptError) {
            logger.error('file_token_store', {
              message: 'Failed to decrypt file',
              error: (decryptError as Error).message,
            });
            return;
          }
        } else {
          logger.error('file_token_store', {
            message: 'File appears encrypted but no key provided',
          });
          return;
        }
      }
      if (!data || !Array.isArray(data.records)) {
        logger.warning('file_token_store', { message: 'Invalid file format' });
        return;
      }
      if (data.encrypted && !this.encryptor) {
        logger.warning('file_token_store', {
          message: 'File was saved encrypted but no encryption key provided',
        });
      }
      logger.info('file_token_store', {
        message: 'Loading records',
        count: data.records.length,
        path: this.persistPath,
        encrypted: data.encrypted ?? false,
      });
      const now = Date.now();
      const validRecords = data.records.filter((rec) => {
        if (rec.provider.expires_at && now >= rec.provider.expires_at) {
          return false;
        }
        return true;
      });
      for (const rec of validRecords) {
        const memoryMap = this.memory as unknown as {
          rsAccessMap: Map<
            string,
            RsRecord & {
              expiresAt: number;
            }
          >;
          rsRefreshMap: Map<
            string,
            RsRecord & {
              expiresAt: number;
            }
          >;
        };
        const recordWithExpiry = {
          ...rec,
          expiresAt: rec.provider.expires_at ?? now + 7 * 24 * 60 * 60 * 1000,
        };
        memoryMap.rsAccessMap.set(rec.rs_access_token, recordWithExpiry);
        memoryMap.rsRefreshMap.set(rec.rs_refresh_token, recordWithExpiry);
      }
      logger.debug('file_token_store', {
        message: 'Records loaded successfully',
        total: data.records.length,
        valid: validRecords.length,
        expired: data.records.length - validRecords.length,
      });
    } catch (error) {
      logger.error('file_token_store', {
        message: 'Load failed',
        error: (error as Error).message,
      });
    }
  }
  private scheduleSave() {
    if (!this.persistPath) {
      return;
    }
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }
    this.saveDebounceTimer = setTimeout(() => {
      this.pendingSave = this.saveAsync();
      this.pendingSave.catch((err) => {
        logger.error('file_token_store', {
          message: 'Save failed',
          error: err.message,
        });
      });
    }, 100);
  }
  private async saveAsync() {
    if (!this.persistPath) {
      return;
    }
    try {
      const dir = dirname(this.persistPath);
      if (!existsSync(dir)) {
        logger.debug('file_token_store', { message: 'Creating directory', dir });
        mkdirSync(dir, { recursive: true, mode: SECURE_DIR_MODE });
      }
      const memoryMap = this.memory as unknown as {
        rsAccessMap: Map<string, RsRecord>;
      };
      const records = Array.from(memoryMap.rsAccessMap.values());
      const data: PersistShape = {
        version: 1,
        encrypted: Boolean(this.encryptor),
        records,
      };
      let content = JSON.stringify(data, null, 2);
      if (this.encryptor) {
        content = await this.encryptor.encrypt(content);
      }
      writeFileSync(this.persistPath, content, {
        encoding: 'utf8',
        mode: SECURE_FILE_MODE,
      });
      try {
        chmodSync(this.persistPath, SECURE_FILE_MODE);
      } catch {}
      logger.debug('file_token_store', {
        message: 'File saved',
        records: records.length,
        encrypted: Boolean(this.encryptor),
      });
    } catch (error) {
      logger.error('file_token_store', {
        message: 'Save failed',
        error: (error as Error).message,
      });
    }
  }

  async storeRsMapping(rsAccess: string, provider: ProviderTokens, rsRefresh?: string) {
    logger.debug('file_token_store', {
      message: 'Storing RS mapping',
      hasRefresh: Boolean(rsRefresh),
      persistPath: this.persistPath,
    });
    const result = await this.memory.storeRsMapping(rsAccess, provider, rsRefresh);
    this.scheduleSave();
    return result;
  }

  async getByRsAccess(rsAccess: string) {
    return this.memory.getByRsAccess(rsAccess);
  }

  async getByRsRefresh(rsRefresh: string) {
    return this.memory.getByRsRefresh(rsRefresh);
  }

  async updateByRsRefresh(
    rsRefresh: string,
    provider: ProviderTokens,
    maybeNewRsAccess?: string,
  ) {
    const result = await this.memory.updateByRsRefresh(
      rsRefresh,
      provider,
      maybeNewRsAccess,
    );
    this.scheduleSave();
    return result;
  }

  async saveTransaction(txnId: string, txn: Transaction, ttlSeconds?: number) {
    return this.memory.saveTransaction(txnId, txn, ttlSeconds);
  }

  async getTransaction(txnId: string) {
    return this.memory.getTransaction(txnId);
  }

  async deleteTransaction(txnId: string) {
    return this.memory.deleteTransaction(txnId);
  }

  async saveCode(code: string, txnId: string, ttlSeconds?: number) {
    return this.memory.saveCode(code, txnId, ttlSeconds);
  }

  getTxnIdByCode = (code: string) => this.memory.getTxnIdByCode(code);

  deleteCode = (code: string) => this.memory.deleteCode(code);

  async flush() {
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
      this.saveDebounceTimer = null;
    }
    await this.saveAsync();
  }

  stopCleanup = () => this.memory.stopCleanup();

  getStats() {
    return this.memory.getStats();
  }
}
