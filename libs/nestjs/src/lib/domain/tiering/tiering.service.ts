import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/libsql';
import { InjectEntityManager } from '@mikro-orm/nestjs';
import type { Readable } from 'node:stream';

import { AppConfigService } from '../../common/config/app-config.service';
import { Clock } from '../../common/clock/clock';
import { ObjectEntity, ObjectLocation, StorageClass } from '../../persistence/index';
import { OPEN_BUCKET_ORM_CONTEXT } from '../../persistence/orm-context';
import { BlobStore } from '../../storage/blob-store';
import { FreeSpaceService } from '../../storage/free-space.service';
import { encodeKey } from '../../storage/key-codec';
import { createSseCipher, createSseDecipher } from '../../storage/sse-cipher';
import { SseKeyService } from '../../storage/sse-key.service';
import {
  REMOTE_OBJECT_STORE,
  type RemoteObjectStore,
} from '../../storage/replication/remote-object-store';
import { InternalError, NoSuchKeyError, SlowDownError } from '../../s3/errors/s3-error';

/**
 * Cold-object tiering orchestration (STORY-0901). Two seams over the STORY-0900
 * remote target ({@link RemoteObjectStore}):
 *
 *  - {@link tierToRemote} — the durable offload the sweep runner (TASK-2711)
 *    invokes: stream the local plaintext blob to the remote, confirm durability,
 *    then (only then) flip the row to a remote stub and soft-delete the local
 *    blob in one transaction. Ordering is the safety property — a crash before
 *    the swap simply leaves the object LOCAL and it is retried.
 *  - {@link rehydrate} — transparent read-through on GET (TASK-2712): fetch the
 *    bytes back, stage them via the two-phase {@link BlobStore}, verify the F1
 *    integrity digest, then flip the row back to LOCAL. Concurrent reads of the
 *    same key rehydrate once (single-flight); global concurrency + local
 *    free-space are bounded so a hot key or a lying remote can't exhaust the box.
 *
 * The `RemoteObjectStore` is `@Optional()`: when no remote target is configured
 * (or the provider is absent, as in unit tests) tiering reports disabled and both
 * seams are inert — a fresh single-node install behaves exactly as before.
 */
@Injectable()
export class TieringService {
  private readonly log = new Logger(TieringService.name);
  /** In-flight rehydrations keyed by `${bucket}/${key}` — the single-flight map. */
  private readonly inflight = new Map<string, Promise<void>>();
  /** Global count of concurrent rehydrations (disk + egress amplifier governor). */
  private activeRehydrations = 0;

  constructor(
    @InjectEntityManager(OPEN_BUCKET_ORM_CONTEXT) private readonly em: EntityManager,
    private readonly blobs: BlobStore,
    private readonly sseKey: SseKeyService,
    private readonly config: AppConfigService,
    private readonly clock: Clock,
    // Optional so unit tests / a no-remote deployment construct the service without
    // a target; when absent tiering is disabled (mirrors BlobStore↔FreeSpaceService).
    @Optional() @Inject(REMOTE_OBJECT_STORE) private readonly remote?: RemoteObjectStore,
    @Optional() private readonly freeSpace?: FreeSpaceService,
  ) {}

  /** True when a remote target is configured — read-through can serve stubs. */
  get remoteEnabled(): boolean {
    return !!this.remote?.enabled;
  }

  /** Objects at/under this size are proxied on read-through; larger ⇒ presign redirect. */
  get inlineMaxBytes(): number {
    return this.config.tierInlineMaxBytes;
  }

  /**
   * Durable offload of a current, local object to the remote target. Returns
   * `'skipped'` when there is nothing to do (no remote, row gone, already tiered,
   * blob already removed) and `'tiered'` after a successful swap. Throws on a
   * remote/IO failure so the caller can count it and leave the object LOCAL.
   */
  async tierToRemote(i: {
    em: EntityManager;
    bucket: string;
    key: string;
    storageClass: StorageClass;
  }): Promise<'tiered' | 'skipped'> {
    if (!this.remote?.enabled) return 'skipped';
    const { em, bucket, key, storageClass } = i;

    const obj = await em
      .fork()
      .findOne(
        ObjectEntity,
        { bucket: { name: bucket }, key, softDeleted: false },
        { populate: ['bucket'] },
      );
    if (!obj || obj.location !== ObjectLocation.Local) return 'skipped';

    // key-codec encoded — path-safe and not client-steerable (inherits the
    // filesystem-key guarantees), so a crafted object name can't steer the remote.
    const remoteKey = encodeKey(key);
    const size = Number(obj.size);

    // 1. Stream the DECRYPTED plaintext to the remote (SSE decrypted on the fly,
    //    exactly like openObjectStream). No local copy is touched yet.
    const opened = await this.openLocalPlaintext(bucket, key, obj.encryption ?? undefined);
    if (!opened) return 'skipped'; // blob already gone — nothing to offload
    try {
      await this.remote.put(bucket, remoteKey, opened.stream, {
        contentType: obj.contentType,
        contentLength: size,
      });
    } catch (err) {
      opened.stream.destroy();
      throw err;
    }

    // 2. Confirm durability BEFORE deleting the only local copy: the remote object
    //    must report the same byte length. A short/failed upload leaves the object
    //    LOCAL (the caller logs + counts a failure). The strong content digest is
    //    re-verified on read-back (rehydrate), so a size match is a sufficient
    //    pre-delete gate here without re-downloading the object.
    const head = await this.remote.head(bucket, remoteKey);
    if (head.contentLength !== size) {
      throw new Error(
        `tiering: remote size ${head.contentLength} != ${size} for ${bucket}/${key}; leaving LOCAL`,
      );
    }

    // 3. Durable swap: flip to a remote stub + soft-delete the local blob to trash
    //    (recoverable during the grace window — an extra safety net), atomically.
    await em.transactional(async (tem) => {
      const row = await tem.findOne(ObjectEntity, { bucket: { name: bucket }, key, softDeleted: false });
      if (!row || row.location !== ObjectLocation.Local) return; // raced with another writer
      row.location = ObjectLocation.Remote;
      row.remoteKey = remoteKey;
      row.tieredAt = new Date(this.clock.nowMs());
      row.storageClass = storageClass;
      tem.persist(row);
      await this.blobs.deleteBlob(bucket, key);
    });
    return 'tiered';
  }

  /**
   * A short-lived presigned GET URL for a tiered object's remote bytes — used to
   * redirect (307) large reads off this process entirely. No static credentials
   * are embedded (SigV4 query auth) and the URL is TTL-boxed + object-scoped.
   */
  async redirectUrlFor(bucket: string, remoteKey: string, range?: string): Promise<string> {
    if (!this.remote?.enabled) throw new InternalError();
    return this.remote.presignGet(bucket, remoteKey, this.config.tierPresignTtlSeconds, range);
  }

  /**
   * Read-through rehydration with single-flight: N concurrent GETs of the same
   * stub trigger exactly one remote fetch. On completion the row is LOCAL and the
   * blob is staged + integrity-verified on disk.
   */
  async rehydrate(bucket: string, key: string): Promise<void> {
    const id = `${bucket}/${key}`;
    let p = this.inflight.get(id);
    if (!p) {
      p = this.doRehydrate(bucket, key).finally(() => this.inflight.delete(id));
      this.inflight.set(id, p);
    }
    return p;
  }

  /** Fetch the remote bytes, stage + verify them, and flip the row back to LOCAL. */
  private async doRehydrate(bucket: string, key: string): Promise<void> {
    if (!this.remote?.enabled) throw new InternalError();

    // Global concurrency cap: excess rehydrations get 503 SlowDown so a hot key
    // can't launch unbounded multi-GB downloads (composes with the S3 rate limit).
    const max = this.config.tierMaxConcurrentRehydrate;
    if (max > 0 && this.activeRehydrations >= max) {
      throw new SlowDownError('Too many concurrent rehydrations; retry shortly.');
    }
    this.activeRehydrations++;

    const em = this.em.fork();
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.tierReadThroughTimeoutMs,
    );
    try {
      const obj = await em.findOne(
        ObjectEntity,
        { bucket: { name: bucket }, key, softDeleted: false },
        { populate: ['bucket'] },
      );
      if (!obj) throw new NoSuchKeyError(key);
      if (obj.location === ObjectLocation.Local) return; // already local (raced)
      if (!obj.remoteKey) throw new InternalError();
      const size = Number(obj.size);

      // Rehydrate consumes local disk — the DoS vector. Guard first, then the
      // putBlob `maxSize` cap backstops a lying remote (mirrors TASK-2140).
      await this.freeSpace?.assertWritable(size);

      const remoteGet = await this.remote.get(bucket, obj.remoteKey, { signal: controller.signal });
      const cipher = obj.encryption
        ? createSseCipher(this.sseKey.key(), Buffer.from(obj.encryption.iv, 'base64'))
        : undefined;

      let put;
      try {
        put = await this.blobs.putBlob(bucket, key, remoteGet.stream, cipher, size);
      } catch (err) {
        remoteGet.stream.destroy?.();
        if (controller.signal.aborted) {
          throw new SlowDownError('Rehydration timed out fetching from the remote; retry.');
        }
        throw err;
      }

      // F1: the staged plaintext digest must match the row BEFORE the swap. On
      // mismatch drop the staged blob (never serve unverified bytes) and 500.
      if (obj.contentSha256 && put.sha256 !== obj.contentSha256) {
        await this.blobs.deleteBlob(bucket, key);
        this.log.error(
          `rehydrate integrity FAILED for ${bucket}/${key}: staged sha256=${put.sha256} != stored ${obj.contentSha256}`,
        );
        throw new InternalError();
      }

      // Swap back to LOCAL. `storageClass` is intentionally left as-is: a
      // rehydrated object stays "cold-tier managed" so a later sweep can re-tier
      // it, and HEAD still advertises the configured class.
      await em.transactional(async (tem) => {
        const row = await tem.findOne(ObjectEntity, { bucket: { name: bucket }, key, softDeleted: false });
        if (!row) return;
        row.location = ObjectLocation.Local;
        row.remoteKey = undefined;
        row.tieredAt = undefined;
        tem.persist(row);
      });
    } finally {
      clearTimeout(timeout);
      this.activeRehydrations--;
    }
  }

  /**
   * Open the local blob as a DECRYPTED plaintext stream (mirrors
   * `ObjectService.openObjectStream`). Returns null when the blob is already gone.
   */
  private async openLocalPlaintext(
    bucket: string,
    key: string,
    encryption?: { iv: string },
  ): Promise<{ stream: Readable } | null> {
    let blob: { stream: import('node:fs').ReadStream };
    try {
      blob = await this.blobs.getBlob(bucket, key);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
    if (!encryption) return { stream: blob.stream };
    const iv = Buffer.from(encryption.iv, 'base64');
    const stream = blob.stream.pipe(createSseDecipher(this.sseKey.key(), iv));
    // A decipher error must tear down the source fd too.
    stream.on('error', () => blob.stream.destroy());
    return { stream };
  }
}
