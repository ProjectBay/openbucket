import { Inject, Injectable } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'node:stream';

import { REPLICATION_CONFIG, type ReplicationConfig } from './replication-config';
import type {
  RemoteGetResult,
  RemoteHeadResult,
  RemoteObjectStore,
} from './remote-object-store';

/**
 * Reserved key prefix under which cold-object tiering (STORY-0901) stores tiered
 * blobs on the shared remote target. Namespacing by source bucket keeps two
 * source buckets from colliding and keeps tiered stubs clear of the raw-key
 * objects written by async replication (STORY-0900) into the same target bucket.
 */
const TIER_PREFIX = '_ob_tiered/';

export interface ReplicationPutInput {
  key: string;
  body: Readable;
  contentLength: number;
  contentType?: string;
  metadata?: Record<string, string>;
}

/** A remote object observed during a reconcile listing — raw S3 key + size/etag
 *  used to diff against the local current state (STORY-0902). */
export interface RemoteObjectRef {
  key: string;
  size?: number;
  etag?: string;
}

/** One page of a remote `ListObjectsV2` scan. */
export interface RemoteListPage {
  objects: RemoteObjectRef[];
  isTruncated: boolean;
}

/**
 * Thin wrapper around `@aws-sdk/client-s3` that writes/deletes a single object on
 * the configured external target (STORY-0900). One `S3Client` is constructed in
 * the constructor ONLY when `config.enabled` — a disabled deployment never
 * touches the SDK. Both operations are plain awaited SDK calls: the SDK's own
 * retry is disabled (`maxAttempts: 1`) because retry/backoff is the WORKER's job
 * (a double retry loop would multiply the effective attempt budget).
 *
 * The service sends object PLAINTEXT (the worker decrypts SSE before calling it),
 * so a plaintext `http://` endpoint leaks contents — the config factory warns at
 * boot. `secretAccessKey` is held only in the client's credentials closure and
 * is never logged.
 */
@Injectable()
export class ReplicationTargetService implements RemoteObjectStore {
  private readonly client?: S3Client;

  constructor(@Inject(REPLICATION_CONFIG) private readonly config: ReplicationConfig) {
    if (config.enabled) {
      this.client = new S3Client({
        endpoint: config.endpoint,
        region: config.region,
        forcePathStyle: config.forcePathStyle,
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
        // Retry/backoff is the worker's responsibility (per-key ordering +
        // dead-letter). Disable the SDK's own retry so a failure surfaces at once.
        maxAttempts: 1,
      });
    }
  }

  private requireClient(): S3Client {
    if (!this.client) {
      throw new Error('ReplicationTargetService: replication is not enabled');
    }
    return this.client;
  }

  /**
   * Write an object to the target. For a known `contentLength` below the
   * multipart threshold a single `PutObjectCommand` is used (the size is always
   * known — from the object row — so no multipart overhead on small objects).
   * Above the threshold `@aws-sdk/lib-storage` `Upload` streams the body as a
   * multipart upload so a multi-GB object never buffers in memory.
   */
  async putObject(input: ReplicationPutInput): Promise<void> {
    const client = this.requireClient();
    if (input.contentLength > this.config.largeObjectThresholdBytes) {
      const upload = new Upload({
        client,
        params: {
          Bucket: this.config.bucket,
          Key: input.key,
          Body: input.body,
          ContentType: input.contentType,
          Metadata: input.metadata,
        },
      });
      await upload.done();
      return;
    }
    await client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: input.key,
        Body: input.body,
        ContentLength: input.contentLength,
        ContentType: input.contentType,
        Metadata: input.metadata,
      }),
    );
  }

  /**
   * List one page of raw-key objects on the target for reconcile (STORY-0902).
   * Uses `ListObjectsV2` with `StartAfter` (exclusive lower bound, matching the
   * local range scan) and `MaxKeys`. Tiered blobs (under the reserved
   * {@link TIER_PREFIX}) are filtered out so they never masquerade as replicated
   * raw-key objects. The endpoint/credentials stay encapsulated in the client.
   */
  async listRemoteObjects(input: {
    prefix?: string;
    startAfter?: string;
    maxKeys: number;
  }): Promise<RemoteListPage> {
    const client = this.requireClient();
    const out = await client.send(
      new ListObjectsV2Command({
        Bucket: this.config.bucket,
        Prefix: input.prefix,
        StartAfter: input.startAfter,
        MaxKeys: input.maxKeys,
      }),
    );
    const objects: RemoteObjectRef[] = [];
    for (const c of out.Contents ?? []) {
      const key = c.Key;
      if (!key || key.startsWith(TIER_PREFIX)) continue;
      objects.push({
        key,
        size: c.Size,
        // ETag comes back quoted; strip for a clean comparison.
        etag: c.ETag ? c.ETag.replace(/^"|"$/g, '') : undefined,
      });
    }
    return { objects, isTruncated: out.IsTruncated ?? false };
  }

  /** Delete an object from the target. Idempotent — S3 DeleteObject returns 204
   *  whether or not the key existed, so a missing remote key is success. */
  async deleteObject(key: string): Promise<void> {
    const client = this.requireClient();
    await client.send(
      new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
  }

  // -------- RemoteObjectStore seam (STORY-0901, cold-object tiering) ---------
  // The same S3 target + client back both async replication (above) and tiering
  // (below). Tiered blobs live under a reserved, source-bucket-scoped key prefix
  // so they never collide with replication's raw-key objects.

  /** True when a remote target is configured — gates the tiering sweep + rehydrate. */
  get enabled(): boolean {
    return this.config.enabled;
  }

  /** The bucket-scoped remote object key a tiered (bucket, remoteKey) maps to. */
  private tierKey(bucket: string, remoteKey: string): string {
    return `${TIER_PREFIX}${bucket}/${remoteKey}`;
  }

  /** Upload a tiered object's plaintext bytes (mirrors {@link putObject}'s small
   *  vs. multipart split so a multi-GB offload never buffers in memory). */
  async put(
    bucket: string,
    remoteKey: string,
    body: Readable,
    opts: { contentType?: string; contentLength: number },
  ): Promise<void> {
    await this.putObject({
      key: this.tierKey(bucket, remoteKey),
      body,
      contentLength: opts.contentLength,
      contentType: opts.contentType,
    });
  }

  /** Open a read stream for a tiered object (bounded by `opts.signal`). */
  async get(
    bucket: string,
    remoteKey: string,
    opts?: { signal?: AbortSignal; range?: string },
  ): Promise<RemoteGetResult> {
    const client = this.requireClient();
    const out = await client.send(
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: this.tierKey(bucket, remoteKey),
        Range: opts?.range,
      }),
      { abortSignal: opts?.signal },
    );
    return {
      stream: out.Body as Readable,
      contentLength: out.ContentLength,
      contentType: out.ContentType,
    };
  }

  /** Stat a tiered object — confirms durability after an offload. */
  async head(bucket: string, remoteKey: string): Promise<RemoteHeadResult> {
    const client = this.requireClient();
    const out = await client.send(
      new HeadObjectCommand({ Bucket: this.config.bucket, Key: this.tierKey(bucket, remoteKey) }),
    );
    return {
      contentLength: out.ContentLength ?? 0,
      // ETag comes back quoted; strip the quotes for a clean comparison.
      etag: out.ETag ? out.ETag.replace(/^"|"$/g, '') : undefined,
    };
  }

  /** A short-lived presigned GET URL (SigV4 query auth — no static credentials). */
  async presignGet(
    bucket: string,
    remoteKey: string,
    ttlSeconds: number,
    range?: string,
  ): Promise<string> {
    const client = this.requireClient();
    const command = new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: this.tierKey(bucket, remoteKey),
      Range: range,
    });
    // Cast through the presigner's own parameter types: @aws-sdk/client-s3 and
    // @aws-sdk/s3-request-presigner can resolve distinct @smithy/types copies whose
    // structurally-identical Client types don't unify. Safe — same runtime client.
    return getSignedUrl(
      client as unknown as Parameters<typeof getSignedUrl>[0],
      command as unknown as Parameters<typeof getSignedUrl>[1],
      { expiresIn: ttlSeconds },
    );
  }

  /** Release the underlying SDK sockets on shutdown. */
  destroy(): void {
    this.client?.destroy();
  }
}
