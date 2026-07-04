import { Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/libsql';
import { InjectEntityManager } from '@mikro-orm/nestjs';
import { promises as fs } from 'node:fs';
import { v7 as uuidv7 } from 'uuid';

import { ConfigService } from '@nestjs/config';

import { ObjectEntity, ObjectVersion, ObjectRepository } from '../persistence/index';
import { OPEN_BUCKET_ORM_CONTEXT } from '../persistence/orm-context';

import { BlobStore } from './blob-store';
import { PathResolver } from './paths';

/**
 * Versioning-side service (WHITEPAPER §3.11). Owns:
 *   - promoteToCurrent (restore a stored version as the current pointer)
 *   - writeDeleteMarker (hide the current pointer; preserve history)
 *   - listVersions (paginated newest-first per key; delegates to the repo)
 *
 * The demote-on-write step (linking the previous pointer into `<key>.v/`
 * before a new PUT lands) lives in `ObjectWriterService` for transactional
 * correctness (§3.11.3 corrected ordering).
 */
@Injectable()
export class VersionStoreService {
  private readonly paths: PathResolver;

  constructor(
    @InjectEntityManager(OPEN_BUCKET_ORM_CONTEXT) private readonly em: EntityManager,
    private readonly blobs: BlobStore,
    config: ConfigService,
  ) {
    this.paths = new PathResolver(config.getOrThrow<string>('DATA_DIR'));
  }

  /**
   * Promote a stored non-current version to be the bucket's current pointer.
   * Throws `NotFoundException` for unknown versions and for delete-markers.
   * Two-phase commit: stat the version blob → compose over the pointer →
   * update `ObjectEntity.currentVersionId` in the same EM transaction.
   */
  async promoteToCurrent(bucket: string, key: string, versionId: string): Promise<void> {
    const em = this.em.fork();
    await em.begin();
    try {
      const ver = await em.findOne(ObjectVersion, {
        bucket: { name: bucket },
        key,
        versionId,
      });
      if (!ver || ver.isDeleteMarker) {
        throw new NotFoundException('version not found or is a delete marker');
      }

      const versionPath = this.paths.versionPath(bucket, key, versionId);
      await fs.stat(versionPath); // confirms the blob is on disk

      await this.blobs.composeBlobs([{ path: versionPath, size: ver.size }], bucket, key);

      const row = await em.findOneOrFail(ObjectEntity, {
        bucket: { name: bucket },
        key,
      });
      row.currentVersionId = versionId;
      row.size = ver.size;
      row.etag = ver.etag;
      row.contentType = ver.contentType;
      row.userMetadata = ver.userMetadata;
      row.softDeleted = false;
      row.modifiedAt = new Date();
      em.persist(row);

      await em.commit();
    } catch (err) {
      await em.rollback().catch(() => undefined);
      throw err;
    }
  }

  /**
   * Write a delete-marker version. No blob is created. The current pointer
   * file is moved to trash so subsequent GETs return 404; historical version
   * blobs under `<key>.v/` are untouched.
   *
   * `beforeCommit` (STORY-0801) runs on the SAME transaction, after the marker is
   * created and before `em.commit()`, so a caller can enqueue a durable webhook
   * row atomically with the delete-marker (transactional outbox). It receives the
   * marker so the caller can read `marker.versionId`.
   */
  async writeDeleteMarker(
    bucket: string,
    key: string,
    beforeCommit?: (em: EntityManager, marker: ObjectVersion) => void,
  ): Promise<ObjectVersion> {
    const em = this.em.fork();
    await em.begin();
    try {
      const row = await em.findOne(ObjectEntity, {
        bucket: { name: bucket },
        key,
      });
      if (!row) {
        throw new NotFoundException('object not found');
      }

      const marker = em.create(ObjectVersion, {
        bucket: row.bucket,
        key,
        versionId: uuidv7(),
        size: 0n,
        etag: '',
        contentType: '',
        userMetadata: undefined,
        isDeleteMarker: true,
        createdAt: new Date(),
      });
      em.persist(marker);

      row.currentVersionId = marker.versionId;
      row.softDeleted = true;
      row.modifiedAt = new Date();
      em.persist(row);

      await this.blobs.deleteBlob(bucket, key); // move pointer file to trash
      beforeCommit?.(em, marker);
      await em.commit();
      return marker;
    } catch (err) {
      await em.rollback().catch(() => undefined);
      throw err;
    }
  }

  /**
   * List all versions for keys with `prefix`, newest first per key. Backs the
   * S3 ListObjectVersions operation. Delegates to the repo's range-scan
   * implementation (§3.4.2).
   */
  async listVersions(
    bucket: string,
    prefix: string,
    keyMarker: string | undefined,
    versionMarker: string | undefined,
    limit: number,
  ): Promise<ObjectVersion[]> {
    const repo = this.em.getRepository(ObjectEntity) as unknown as ObjectRepository;
    return repo.listVersionsByPrefix(bucket, prefix, keyMarker, versionMarker, limit);
  }
}
