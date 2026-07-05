import type { Readable } from 'node:stream';

/** Bytes + known metadata of a remote object read. */
export interface RemoteGetResult {
  stream: Readable;
  contentLength?: number;
  contentType?: string;
}

/** Remote HEAD result — enough to verify a tiered stub before/after transfer. */
export interface RemoteHeadResult {
  contentLength: number;
  etag?: string;
}

/**
 * Remote object-access seam for cold-object tiering (STORY-0901). Implemented by
 * {@link ReplicationTargetService} over the same STORY-0900 S3-compatible target,
 * so tiering reuses the one configured remote rather than standing up a second.
 *
 * `enabled` reflects whether a remote target is configured; when it is `false`
 * (or the provider is absent) the tiering sweep and read-through rehydration are
 * no-ops. All methods take the *source* bucket + the row-derived `remoteKey`
 * (key-codec encoded, never client-steerable) and the implementation maps them to
 * a bucket-scoped key on the remote target so two source buckets never collide.
 */
export interface RemoteObjectStore {
  /** True when a remote target is configured (else every operation is a no-op). */
  readonly enabled: boolean;

  /** Upload the object's plaintext bytes to the remote target. */
  put(
    bucket: string,
    remoteKey: string,
    body: Readable,
    opts: { contentType?: string; contentLength: number },
  ): Promise<void>;

  /** Open a read stream for the remote object (bounded by `opts.signal`). */
  get(
    bucket: string,
    remoteKey: string,
    opts?: { signal?: AbortSignal; range?: string },
  ): Promise<RemoteGetResult>;

  /** Stat the remote object — used to confirm durability after an offload. */
  head(bucket: string, remoteKey: string): Promise<RemoteHeadResult>;

  /** A short-lived presigned GET URL (no static credentials) for the remote object. */
  presignGet(bucket: string, remoteKey: string, ttlSeconds: number, range?: string): Promise<string>;
}

/** DI token for the {@link RemoteObjectStore} (provided by the ReplicationModule). */
export const REMOTE_OBJECT_STORE = Symbol('REMOTE_OBJECT_STORE');
