import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

import { AppConfigService } from '../common/config/app-config.service';
import { SSE_KEY_BYTES } from './sse-cipher';

/**
 * The single backend-managed SSE-S3 key (STORY-0122). Loaded at boot from
 * `OPENBUCKET_SSE_KEY` (base64 32 bytes) when set, otherwise generated once and
 * persisted to `<DATA_DIR>/sse.key` (mode 0600). Losing this key makes every
 * SSE-encrypted object unreadable — operators must back it up.
 */
@Injectable()
export class SseKeyService implements OnModuleInit {
  private readonly log = new Logger(SseKeyService.name);
  private masterKey?: Buffer;

  constructor(private readonly config: AppConfigService) {}

  async onModuleInit(): Promise<void> {
    const fromEnv = this.config.sseKey;
    if (fromEnv) {
      this.masterKey = Buffer.from(fromEnv, 'base64');
      this.log.log('SSE-S3 key loaded from OPENBUCKET_SSE_KEY');
      return;
    }
    const keyPath = join(this.config.dataDir, 'sse.key');
    try {
      const existing = await fs.readFile(keyPath);
      if (existing.length === SSE_KEY_BYTES) {
        this.masterKey = existing;
        this.log.log(`SSE-S3 key loaded from ${keyPath}`);
        return;
      }
      this.log.warn(`${keyPath} is not ${SSE_KEY_BYTES} bytes; regenerating`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    const generated = randomBytes(SSE_KEY_BYTES);
    await fs.mkdir(this.config.dataDir, { recursive: true });
    try {
      await fs.writeFile(keyPath, generated, { mode: 0o600, flag: 'wx' });
      this.masterKey = generated;
      this.log.log(`SSE-S3 key generated + persisted to ${keyPath}`);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
        this.masterKey = await fs.readFile(keyPath); // lost a create race — re-read
        return;
      }
      throw e;
    }
  }

  /** The 32-byte SSE key. Throws if accessed before `onModuleInit`. */
  key(): Buffer {
    if (!this.masterKey) throw new Error('SSE key not initialised');
    return this.masterKey;
  }
}
