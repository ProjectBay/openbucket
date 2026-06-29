import * as crypto from 'node:crypto';
import { Transform } from 'node:stream';

/**
 * SSE-S3 at-rest encryption primitive (STORY-0122). AES-256-**CTR** so reads are
 * seekable — a `Range` GET decrypts from any byte offset without the whole
 * object. CTR is length-preserving (ciphertext length == plaintext length), so
 * sizes/ETags (computed over plaintext) and on-disk file sizes stay aligned.
 *
 * The key is a single backend-managed 32-byte key (see `SseKeyService`); each
 * object gets a random 16-byte IV (the initial counter block), stored per-object.
 * Integrity is already covered by the stored ETag/SHA-256, so CTR (no AEAD tag)
 * is sufficient and keeps `Range` simple.
 */
const ALGO = 'aes-256-ctr';
export const SSE_IV_BYTES = 16;
export const SSE_KEY_BYTES = 32;

export function generateIv(): Buffer {
  return crypto.randomBytes(SSE_IV_BYTES);
}

/** A streaming cipher/decipher over the full object (counter starts at the IV). */
export function createSseCipher(key: Buffer, iv: Buffer): crypto.Cipher {
  return crypto.createCipheriv(ALGO, key, iv);
}
export function createSseDecipher(key: Buffer, iv: Buffer): crypto.Decipher {
  return crypto.createDecipheriv(ALGO, key, iv);
}

/**
 * The 128-bit counter block for plaintext byte offset `start`: the IV advanced by
 * `floor(start/16)` blocks (big-endian add, with carry). Pair with
 * {@link rangeSkip} to drop the intra-block prefix.
 */
export function counterForOffset(iv: Buffer, start: number): Buffer {
  const blocks = Math.floor(start / SSE_IV_BYTES);
  const ctr = Buffer.from(iv); // copy — never mutate the stored IV
  let carry = blocks;
  for (let i = ctr.length - 1; i >= 0 && carry > 0; i--) {
    const sum = ctr[i] + (carry % 256);
    ctr[i] = sum & 0xff;
    carry = Math.floor(carry / 256) + (sum >> 8);
  }
  return ctr;
}

/** Bytes to discard from the front of a block-aligned decrypt to reach `start`. */
export function rangeSkip(start: number): number {
  return start % SSE_IV_BYTES;
}

/** The block-aligned ciphertext offset to begin reading at for plaintext `start`. */
export function alignedStart(start: number): number {
  return Math.floor(start / SSE_IV_BYTES) * SSE_IV_BYTES;
}

/** Convenience: encrypt a whole buffer. */
export function encryptBuffer(key: Buffer, iv: Buffer, plaintext: Buffer): Buffer {
  const c = createSseCipher(key, iv);
  return Buffer.concat([c.update(plaintext), c.final()]);
}

/** Convenience: decrypt a whole buffer. */
export function decryptBuffer(key: Buffer, iv: Buffer, ciphertext: Buffer): Buffer {
  const d = createSseDecipher(key, iv);
  return Buffer.concat([d.update(ciphertext), d.final()]);
}

/**
 * Decrypt plaintext bytes `[start, end]` (inclusive) given the **block-aligned**
 * ciphertext slice that begins at {@link alignedStart}(start). Returns exactly
 * the requested range.
 */
export function decryptRange(
  key: Buffer,
  iv: Buffer,
  cipherFromAligned: Buffer,
  start: number,
  end: number,
): Buffer {
  // The counter for the block-aligned start; CTR keystream then lines up.
  const d = crypto.createDecipheriv(ALGO, key, counterForOffset(iv, start));
  const plainFromAligned = Buffer.concat([d.update(cipherFromAligned), d.final()]);
  const skip = rangeSkip(start);
  return plainFromAligned.subarray(skip, skip + (end - start + 1));
}

/** A streaming decipher whose counter is positioned at plaintext `start` (for Range reads). */
export function createRangeDecipher(key: Buffer, iv: Buffer, start: number): crypto.Decipher {
  return crypto.createDecipheriv(ALGO, key, counterForOffset(iv, start));
}

/** A Transform that drops the first `n` bytes (the block-aligned prefix of a Range decrypt). */
export function skipBytes(n: number): Transform {
  let remaining = n;
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      if (remaining <= 0) return cb(null, chunk);
      if (chunk.length <= remaining) {
        remaining -= chunk.length;
        return cb();
      }
      const out = chunk.subarray(remaining);
      remaining = 0;
      cb(null, out);
    },
  });
}
