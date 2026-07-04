import { createHash } from 'node:crypto';
import { Transform, TransformCallback } from 'node:stream';

import {
  BadDigestError,
  EntityTooLargeError,
  EntityTooSmallError,
  XAmzContentSHA256MismatchError,
} from '../errors/s3-error';
import { makeChecksummer, type Checksummer, type ChecksumAlgo } from './checksums';

/** Hashes and byte count, settled when the verified stream ends. */
export interface PutObjectHashes {
  md5Hex: string;
  md5Base64: string;
  sha256Hex: string;
}

export interface PutObjectStreamContext {
  /** A Readable that emits the verified, size-capped body. */
  readonly stream: NodeJS.ReadableStream;
  /** Lazily-resolved hashes; settle when the stream ends successfully. */
  readonly hashes: Promise<PutObjectHashes>;
  /** Total bytes that flowed through the stream. Set when `hashes` resolves. */
  readonly size: Promise<number>;
}

declare module 'http' {
  interface IncomingMessage {
    /** Populated by Put/PostObjectInterceptor with the verified body stream. */
    openbucketPutCtx?: PutObjectStreamContext;
  }
}

// 256 KB highWaterMark (§4.7): larger than a TCP MSS so we batch, smaller than
// the page-cache working set so we don't pool. The literal is duplicated in the
// interceptors (TEST-0316 pins it there); this is the shared default.
export const BODY_VERIFIER_HWM = 256 * 1024;

/** Configuration for {@link createBodyVerifier}. */
export interface BodyVerifierOptions {
  /** Hard byte cap: `bytes > maxBytes` aborts with `EntityTooLarge`. */
  maxBytes: number;
  /**
   * Minimum byte floor checked on flush (`bytes < minBytes` → `EntityTooSmall`).
   * Used by the POST content-length-range; omitted for plain PUT.
   */
  minBytes?: number;
  /** Expected `Content-MD5` (base64); mismatch → `BadDigest`. */
  expectedMd5Base64?: string;
  /** Expected body sha256 (hex); mismatch → `XAmzContentSHA256Mismatch`. Omit to skip. */
  expectedSha256Hex?: string;
  /** S3 flexible checksum (`x-amz-checksum-*`); mismatch → `BadDigest`. */
  checksum?: { algo: ChecksumAlgo; expected: string };
  /** Override the stream highWaterMark (defaults to {@link BODY_VERIFIER_HWM}). */
  highWaterMark?: number;
}

/** The verifier `Transform` plus its lazily-settled hash/size promises. */
export interface BodyVerifier {
  verifier: Transform;
  hashes: Promise<PutObjectHashes>;
  size: Promise<number>;
  /** Reject the pending hash/size promises (does not destroy the stream). */
  rejectPending(err: unknown): void;
}

/**
 * The shared streaming md5 + sha256 + size-cap verifier `Transform` (WHITEPAPER
 * §4.1.2). Computes both digests inline, enforces the size cap (and optional
 * floor), and on flush verifies `Content-MD5`, `x-amz-content-sha256`, and any
 * declared flexible checksum. Used by both `PutObjectInterceptor` (header/query
 * SigV4 PUT) and `PostObjectInterceptor` (browser POST-policy upload) so the
 * write path is byte-for-byte identical.
 */
export function createBodyVerifier(opts: BodyVerifierOptions): BodyVerifier {
  const md5 = createHash('md5');
  const sha256 = createHash('sha256');
  const checksummer: Checksummer | undefined = opts.checksum
    ? makeChecksummer(opts.checksum.algo)
    : undefined;
  let bytes = 0;
  let aborted = false;

  let resolveHashes!: (v: PutObjectHashes) => void;
  let rejectHashes!: (e: unknown) => void;
  const hashes = new Promise<PutObjectHashes>((res, rej) => {
    resolveHashes = res;
    rejectHashes = rej;
  });
  let resolveSize!: (n: number) => void;
  let rejectSize!: (e: unknown) => void;
  const size = new Promise<number>((res, rej) => {
    resolveSize = res;
    rejectSize = rej;
  });

  const verifier = new Transform({
    highWaterMark: opts.highWaterMark ?? BODY_VERIFIER_HWM,
    transform(chunk: Buffer, _enc, cb: TransformCallback) {
      bytes += chunk.length;
      if (bytes > opts.maxBytes) {
        aborted = true;
        return cb(new EntityTooLargeError(bytes, opts.maxBytes));
      }
      md5.update(chunk);
      sha256.update(chunk);
      checksummer?.update(chunk);
      cb(null, chunk);
    },
    flush(cb: TransformCallback) {
      if (aborted) return cb();
      const md5Hex = md5.digest('hex');
      const md5Base64 = Buffer.from(md5Hex, 'hex').toString('base64');
      const sha256Hex = sha256.digest('hex');

      if (opts.minBytes !== undefined && bytes < opts.minBytes) {
        return cb(new EntityTooSmallError());
      }
      if (opts.expectedMd5Base64 && opts.expectedMd5Base64 !== md5Base64) {
        return cb(new BadDigestError());
      }
      if (opts.expectedSha256Hex && opts.expectedSha256Hex.toLowerCase() !== sha256Hex) {
        return cb(new XAmzContentSHA256MismatchError());
      }
      if (opts.checksum && checksummer && checksummer.digestBase64() !== opts.checksum.expected) {
        return cb(new BadDigestError());
      }
      resolveHashes({ md5Hex, md5Base64, sha256Hex });
      resolveSize(bytes);
      cb();
    },
  });

  return {
    verifier,
    hashes,
    size,
    rejectPending(err: unknown): void {
      rejectHashes(err);
      rejectSize(err);
    },
  };
}
