import { createHash } from 'node:crypto';
import * as zlib from 'node:zlib';

/**
 * S3 flexible-checksum algorithms (`x-amz-checksum-<algo>`). Base64 digests, as
 * S3 sends them. Used to verify a client-declared checksum against the received
 * body on ingest (regular PUT + UploadPart). See put-object.interceptor.ts.
 */
export type ChecksumAlgo = 'crc32' | 'crc32c' | 'sha1' | 'sha256';
export const CHECKSUM_ALGOS: ChecksumAlgo[] = ['crc32', 'crc32c', 'sha1', 'sha256'];

export interface Checksummer {
  update(chunk: Buffer): void;
  digestBase64(): string;
}

// CRC-32C (Castagnoli, reflected poly 0x82F63B78) — not in the Node stdlib.
const CRC32C_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0x82f63b78 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function makeChecksummer(algo: ChecksumAlgo): Checksummer {
  if (algo === 'sha1' || algo === 'sha256') {
    const h = createHash(algo);
    return { update: (c) => void h.update(c), digestBase64: () => h.digest('base64') };
  }
  if (algo === 'crc32') {
    let crc = 0;
    return {
      update: (c) => void (crc = zlib.crc32(c, crc)),
      digestBase64: () => {
        const b = Buffer.alloc(4);
        b.writeUInt32BE(crc >>> 0);
        return b.toString('base64');
      },
    };
  }
  // crc32c
  let crc = 0xffffffff;
  return {
    update: (c) => {
      for (let i = 0; i < c.length; i++) crc = CRC32C_TABLE[(crc ^ c[i]) & 0xff] ^ (crc >>> 8);
    },
    digestBase64: () => {
      const b = Buffer.alloc(4);
      b.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
      return b.toString('base64');
    },
  };
}

/**
 * Find the single `x-amz-checksum-<algo>` header a request declared (S3 sends at
 * most one), if any. Returns the algo + expected base64 value, or undefined.
 */
export function declaredChecksum(
  headers: Record<string, string | string[] | undefined>,
): { algo: ChecksumAlgo; expected: string } | undefined {
  for (const algo of CHECKSUM_ALGOS) {
    const raw = headers[`x-amz-checksum-${algo}`];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value) return { algo, expected: value };
  }
  return undefined;
}
