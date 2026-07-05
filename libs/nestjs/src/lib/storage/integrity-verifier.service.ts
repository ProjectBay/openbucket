import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';

import { BlobStore } from './blob-store';
import { createSseDecipher } from './sse-cipher';
import { SseKeyService } from './sse-key.service';

/** The verdict of a single blob re-hash (see {@link IntegrityVerifier}). */
export interface IntegrityResult {
  /** `recompute` always leaves this true; `verify` sets it iff the digest matched. */
  ok: boolean;
  /** Hex SHA-256 of the on-disk PLAINTEXT bytes (post-SSE-decrypt when encrypted). */
  actualSha256: string;
  /** Total plaintext bytes fed through the hash — the scrubber's per-tick byte budget. */
  bytesHashed: bigint;
}

/**
 * The shared whole-object SHA-256 re-hashing core (F1). Extracted verbatim from
 * `ObjectService.verifyBlobIntegrity` so the read-time integrity gate and the
 * background scrubber (STORY-1204) compute the SAME digest and can never drift.
 *
 * Unlike the read gate it NEVER throws on a mismatch — it returns a verdict — so
 * the scrubber can persist `corrupt` rather than 500 a request. The digest is
 * over PLAINTEXT (the SSE-S3 blob is decrypted first), so the one hash validates
 * single-part and multipart objects alike, exactly as the stored `contentSha256`.
 *
 * Streaming only: it reads at `getBlob`'s 256 KB highWaterMark and never buffers a
 * whole object; it takes no size cap of its own (the scrubber's per-tick byte
 * budget bounds total work). ENOENT is NOT swallowed — a missing blob rejects with
 * the raw `ENOENT` error so callers can branch on `err.code === 'ENOENT'`
 * (the scrubber treats a missing blob as `unchecked`, never `corrupt`).
 */
@Injectable()
export class IntegrityVerifier {
  constructor(private readonly blobs: BlobStore, private readonly sseKey: SseKeyService) {}

  /**
   * Re-read the blob at (bucket, key), decrypting SSE-S3 when `opts.encryption`
   * is set, and recompute its whole-object plaintext SHA-256. `ok` is always
   * true here — the caller compares the digest itself (or use {@link verify}).
   * Propagates `ENOENT` when the blob is missing.
   */
  async recompute(
    bucket: string,
    key: string,
    opts?: { encryption?: { iv: string } },
  ): Promise<IntegrityResult> {
    const { stream } = await this.blobs.getBlob(bucket, key);
    const sha = createHash('sha256');
    let bytesHashed = 0n;
    const plaintext: NodeJS.ReadableStream = opts?.encryption
      ? stream.pipe(createSseDecipher(this.sseKey.key(), Buffer.from(opts.encryption.iv, 'base64')))
      : stream;
    await new Promise<void>((resolve, reject) => {
      plaintext.on('data', (c: Buffer) => {
        sha.update(c);
        bytesHashed += BigInt(c.length);
      });
      plaintext.on('end', () => resolve());
      plaintext.on('error', reject);
      // A decipher failure must reject too, and the source's error must not be
      // lost if the pipe swallows it.
      if (plaintext !== stream) stream.on('error', reject);
    });
    return { ok: true, actualSha256: sha.digest('hex'), bytesHashed };
  }

  /**
   * {@link recompute} plus a comparison against `expectedSha256`: `ok` is
   * `actualSha256 === expectedSha256`. Non-throwing on a mismatch (that IS the
   * corrupt verdict); still propagates `ENOENT` for a missing blob.
   */
  async verify(
    bucket: string,
    key: string,
    expectedSha256: string,
    opts?: { encryption?: { iv: string } },
  ): Promise<IntegrityResult> {
    const res = await this.recompute(bucket, key, opts);
    return { ...res, ok: res.actualSha256 === expectedSha256 };
  }
}
