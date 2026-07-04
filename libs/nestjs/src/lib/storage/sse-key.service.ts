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
 *
 * KEY MODEL / THREAT-MODEL BOUNDARY (TASK-2131, audit finding [10], CWE-522):
 * this is the intended **SSE-S3** design — one instance-wide key used verbatim
 * for every object, with no per-object/per-tenant HKDF derivation, no key-id, and
 * therefore no in-place rotation in v1 (rotation would need bulk re-encryption).
 * The cipher is non-AEAD `aes-256-ctr`; decryption is gated on the mutable DB
 * flag `obj.encryption`, and a "flag-flip downgrade" does NOT disclose plaintext
 * (the on-disk bytes are ciphertext) — it is caught on the read path by the
 * stored-`contentSha256` integrity gate. Both attack legs (read of the key file /
 * write of the DB) already require privileged access that defeats the at-rest
 * model. Per-object/tenant keys + key-id/rotation + AEAD binding are a documented
 * roadmap item, not shipped in v1. Operators must deliver the key via a secrets
 * manager/file (see libs/nestjs/README.md), not an inline env var.
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
