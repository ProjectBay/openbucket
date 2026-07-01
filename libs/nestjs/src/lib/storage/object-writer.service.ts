import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/better-sqlite';
import { InjectEntityManager } from '@mikro-orm/nestjs';
import { Readable } from 'node:stream';
import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';

import {
  Bucket,
  ObjectEntity,
  ObjectVersion,
  StorageClass,
  VersioningState,
} from '../persistence/index';
import { OPEN_BUCKET_ORM_CONTEXT } from '../persistence/orm-context';

import { BlobRef, BlobStore } from './blob-store';
import { createSseCipher, generateIv } from './sse-cipher';
import { SseKeyService } from './sse-key.service';
import { faultpoint } from '../common/faultpoint';
import type { ObjectEncryptionState } from '../persistence/index';

export interface PutObjectCmd {
  bucket: string;
  key: string;
  body: Readable;
  contentType?: string;
  userMetadata?: Record<string, string>;
}

@Injectable()
export class ObjectWriterService {
  private readonly log = new Logger(ObjectWriterService.name);

  constructor(
    @InjectEntityManager(OPEN_BUCKET_ORM_CONTEXT) private readonly em: EntityManager,
    private readonly blobs: BlobStore,
    private readonly sseKey: SseKeyService,
  ) {}

  /**
   * Canonical two-phase write (WHITEPAPER §3.7) with versioning's
   * demote-on-write step (§3.11.3). Order is fixed:
   *   1. Open transaction.
   *   2. Look up bucket + existing pointer row.
   *   3. If versioned + existing currentVersionId: hard-link (or copy on
   *      EXDEV) the current pointer file into `<key>.v/<prevVersionId>`
   *      BEFORE the new blob's rename overwrites it. Idempotent under
   *      EEXIST; tolerant of ENOENT (missing pointer logged + skipped).
   *   4. Stage blob in tmp/ + fsync + atomic rename to final path.
   *   5. Insert/update ObjectEntity row + (if versioned) insert ObjectVersion.
   *   6. Commit.
   *   7. On failure after step 4: rollback + best-effort unlink of the
   *      renamed file. A crash between 4 and 6 leaves an orphan blob —
   *      reconciled by §3.8 (STORY-0210).
   */
  async put(cmd: PutObjectCmd): Promise<ObjectEntity> {
    const em = this.em.fork();
    await em.begin();

    let finalPath: string | undefined;
    try {
      const bucket = await em.findOneOrFail(Bucket, { name: cmd.bucket });

      let row = await em.findOne(ObjectEntity, {
        bucket: { name: cmd.bucket },
        key: cmd.key,
      });

      // STORY-0213 demote-on-write — must happen BEFORE putBlob renames over
      // the existing pointer file. Only applies to versioned buckets with an
      // existing current version on disk.
      if (bucket.versioning !== VersioningState.Disabled && row?.currentVersionId) {
        await this.demoteCurrent(cmd.bucket, cmd.key, row.currentVersionId);
      }

      // SSE-S3 at rest (STORY-0122): when the bucket has default encryption,
      // encrypt the blob with a per-object IV. The ETag/size stay over plaintext
      // (putBlob hashes the input before the cipher). The IV is stored per-object
      // (and per-version) so reads can decrypt.
      const encryption: ObjectEncryptionState | undefined =
        bucket.encryption?.algorithm === 'AES256'
          ? { algorithm: 'AES256', iv: generateIv().toString('base64') }
          : undefined;
      const cipher = encryption
        ? createSseCipher(this.sseKey.key(), Buffer.from(encryption.iv, 'base64'))
        : undefined;

      const put = await this.blobs.putBlob(cmd.bucket, cmd.key, cmd.body, cipher);
      finalPath = put.finalPath;

      // TEST-ONLY crash-consistency failpoint: the blob has been renamed into
      // its final path but the metadata row is NOT yet committed. No-op unless
      // OB_FAULT=after-rename (never set in prod/CI). See tests/fault/.
      await faultpoint('after-rename');

      if (!row) {
        row = new ObjectEntity();
        row.id = randomUUID();
        row.bucket = bucket;
        row.key = cmd.key;
      }
      row.size = put.size;
      row.etag = put.etag;
      row.contentType = cmd.contentType ?? 'application/octet-stream';
      row.userMetadata = cmd.userMetadata;
      row.storageClass = StorageClass.Standard;
      row.softDeleted = false;
      row.modifiedAt = new Date();
      row.encryption = encryption;

      if (bucket.versioning !== VersioningState.Disabled) {
        // Use UUIDv7 — sortable by time, matches §3.2.4's comment.
        const versionId = uuidv7();
        row.currentVersionId = versionId;

        const ver = em.create(ObjectVersion, {
          bucket,
          key: cmd.key,
          versionId,
          size: put.size,
          etag: put.etag,
          contentType: row.contentType,
          userMetadata: row.userMetadata,
          encryption,
          isDeleteMarker: false,
          createdAt: new Date(),
        });
        em.persist(ver);
      }

      em.persist(row);
      await em.commit();
      return row;
    } catch (err) {
      await em.rollback().catch(() => undefined);
      if (finalPath) {
        try {
          await fs.unlink(finalPath);
        } catch (unlinkErr) {
          this.log.warn(
            `failed to clean up post-rename file after commit error: ${finalPath}: ${(unlinkErr as Error).message}`,
          );
        }
      }
      throw err;
    }
  }

  /**
   * Two-phase commit for a CompleteMultipartUpload (§4.4.3): compose the staged
   * parts into the final blob and insert/update the object row with the supplied
   * **multipart ETag** (`md5(concat(md5ᵢ))-N`, not the composed-bytes md5).
   * Mirrors {@link put}'s versioning + cleanup discipline.
   */
  async putComposed(cmd: {
    bucket: string;
    key: string;
    parts: BlobRef[];
    etag: string;
    contentType?: string;
  }): Promise<ObjectEntity> {
    const em = this.em.fork();
    await em.begin();

    let finalPath: string | undefined;
    try {
      const bucket = await em.findOneOrFail(Bucket, { name: cmd.bucket });
      let row = await em.findOne(ObjectEntity, { bucket: { name: cmd.bucket }, key: cmd.key });

      if (bucket.versioning !== VersioningState.Disabled && row?.currentVersionId) {
        await this.demoteCurrent(cmd.bucket, cmd.key, row.currentVersionId);
      }

      const composed = await this.blobs.composeBlobs(cmd.parts, cmd.bucket, cmd.key);
      finalPath = composed.finalPath;

      if (!row) {
        row = new ObjectEntity();
        row.id = randomUUID();
        row.bucket = bucket;
        row.key = cmd.key;
      }
      row.size = composed.size;
      row.etag = cmd.etag;
      row.contentType = cmd.contentType ?? 'application/octet-stream';
      row.userMetadata = undefined;
      row.storageClass = StorageClass.Standard;
      row.softDeleted = false;
      row.modifiedAt = new Date();

      if (bucket.versioning !== VersioningState.Disabled) {
        const versionId = uuidv7();
        row.currentVersionId = versionId;
        em.persist(
          em.create(ObjectVersion, {
            bucket,
            key: cmd.key,
            versionId,
            size: composed.size,
            etag: cmd.etag,
            contentType: row.contentType,
            userMetadata: undefined,
            isDeleteMarker: false,
            createdAt: new Date(),
          }),
        );
      }

      em.persist(row);
      await em.commit();
      return row;
    } catch (err) {
      await em.rollback().catch(() => undefined);
      if (finalPath) {
        await fs.unlink(finalPath).catch(() => undefined);
      }
      throw err;
    }
  }

  /**
   * Move the current pointer file into `<key>.v/<prevVersionId>`. Hard-link
   * first (cheap, no copy on same filesystem), falling back to copyFile on
   * EXDEV. EEXIST is a no-op (idempotent). ENOENT (no pointer file present
   * for some reason — e.g. a prior partial state) logs a warning and skips:
   * the new PUT can still proceed, and any orphan is reconciled later by the
   * recovery scan.
   */
  private async demoteCurrent(bucket: string, key: string, prevVersionId: string): Promise<void> {
    const src = this.blobs.paths.blobPath(bucket, key);
    const dst = this.blobs.paths.versionPath(bucket, key, prevVersionId);
    await fs.mkdir(dirname(dst), { recursive: true });
    try {
      await fs.link(src, dst);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') return;
      if (code === 'EXDEV') {
        await fs.copyFile(src, dst);
        return;
      }
      if (code === 'ENOENT') {
        this.log.warn(`demote: current pointer missing for ${bucket}/${key}; skipping`);
        return;
      }
      throw err;
    }
  }
}
