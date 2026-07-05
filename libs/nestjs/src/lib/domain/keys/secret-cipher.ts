import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

import type { Env } from '../../common/config/env.schema';

const VERSION = 'v1';
const IV_BYTES = 12; // GCM standard nonce length
const KEK_BYTES = 32; // AES-256
const HKDF_SALT = 'openbucket/kek/v1';
const HKDF_INFO = 'access-key-secret';

/**
 * SecretCipher (EPIC-11, TASK-3001) — reversible at-rest encryption for scoped
 * sub-key secrets so SigV4 can recover a plaintext to verify a signature.
 *
 * AES-256-GCM with a random 12-byte IV per secret; serialized as
 * `v1.<iv_b64>.<tag_b64>.<ct_b64>`. The 32-byte KEK is HKDF-SHA256 derived from
 * `KEY_ENCRYPTION_SECRET` (if set) else `ROOT_SECRET_ACCESS_KEY`. The GCM auth
 * tag rejects tampering; a tampered/rotated-key blob throws on `decrypt`. The
 * KEK and plaintext are NEVER logged (see the pino redact list).
 */
@Injectable()
export class SecretCipher {
  private kek?: Buffer;

  constructor(private readonly config: ConfigService<Env, true>) {}

  private key(): Buffer {
    if (this.kek) return this.kek;
    const material =
      this.config.get('KEY_ENCRYPTION_SECRET', { infer: true }) ??
      this.config.get('ROOT_SECRET_ACCESS_KEY', { infer: true });
    if (!material) throw new Error('SecretCipher: no key material configured');
    this.kek = Buffer.from(hkdfSync('sha256', Buffer.from(material, 'utf8'), HKDF_SALT, HKDF_INFO, KEK_BYTES));
    return this.kek;
  }

  /** Encrypt a plaintext secret to `v1.<iv>.<tag>.<ct>` (base64url segments). */
  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, b64(iv), b64(tag), b64(ct)].join('.');
  }

  /** Decrypt a `v1.<iv>.<tag>.<ct>` blob. Throws on a malformed or tampered blob. */
  decrypt(blob: string): string {
    const parts = blob.split('.');
    if (parts.length !== 4 || parts[0] !== VERSION) {
      throw new Error('SecretCipher: malformed ciphertext');
    }
    const iv = unb64(parts[1]);
    const tag = unb64(parts[2]);
    const ct = unb64(parts[3]);
    const decipher = createDecipheriv('aes-256-gcm', this.key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  }
}

function b64(b: Buffer): string {
  return b.toString('base64url');
}

function unb64(s: string): Buffer {
  return Buffer.from(s, 'base64url');
}
