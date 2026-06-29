import 'express';

import type { ChunkSigningContext } from '../../s3/sigv4/chunk-signing';

declare module 'express' {
  interface Request {
    openbucket: OpenBucketRequestContext;
  }
}

export interface OpenBucketRequestContext {
  /** UUIDv7 — monotonic, sortable. Logged on every line, returned as `X-Request-Id`. */
  requestId: string;

  /** Routing class. Decided once by the classifier middleware. */
  kind: 's3' | 'admin' | 'spa';

  /** Wall-clock receive time, for latency measurement and SigV4 skew checks. */
  receivedAt: number;

  // ---- s3-only fields ----
  /** Resolved bucket name (from host header in vhost style, or first path segment in path style). */
  bucket?: string;
  /** Resolved object key, percent-decoded. Empty for bucket-level operations. */
  key?: string;
  /**
   * Raw (not URL-decoded) form of the key, used by SigV4 canonicalization
   * (STORY-0103). Populated by the classifier in S3 mode; falls back to
   * `key` when absent.
   */
  keyRaw?: string;
  /** 'virtual-host' | 'path'. Drives URL shape in SigV4 canonicalization [see §3]. */
  addressingStyle?: 'virtual-host' | 'path';
  /** Sub-operation hint: 'service' | 'bucket' | 'object'. */
  s3Scope?: 's3-service' | 's3-bucket' | 's3-object';

  // ---- populated by S3 controller-tree interceptors / guards (EPIC-02) ----
  /** S3 operation name set by `@S3Operation` via the OperationDispatcherInterceptor (STORY-0100). */
  operation?: string;
  /** Resolved accessKeyId after SigV4 verification (STORY-0103). */
  accessKeyId?: string;

  /**
   * Chunked-upload signing context (STORY-0119). Set by `SigV4Guard` only when
   * the header-signed request carries `x-amz-content-sha256:
   * STREAMING-AWS4-HMAC-SHA256-PAYLOAD`; consumed by `PutObjectInterceptor` to
   * drive the `ChunkedDecoder`.
   */
  chunkSigning?: ChunkSigningContext;
}
