import { Injectable, Logger, Optional } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/libsql';
import { InjectEntityManager } from '@mikro-orm/nestjs';

import { IntegrityStatus } from '../persistence/entities/types';
import { ObjectEntity } from '../persistence/entities/object.entity';
import { OPEN_BUCKET_ORM_CONTEXT } from '../persistence/orm-context';
import { ReplicationTargetService } from './replication/replication-target.service';
import { BlobStore } from './blob-store';
import { IntegrityVerifier } from './integrity-verifier.service';
import { createSseCipher } from './sse-cipher';
import { SseKeyService } from './sse-key.service';

/** The outcome of a single repair attempt. */
export type RepairOutcome = 'repaired' | 'skipped-no-target' | 'failed';

/**
 * Repairs a corrupt blob from the replication target (STORY-1204, TASK-3643).
 * When the scrubber marks a blob `corrupt` AND a replication target is configured,
 * it fetches the good remote copy (async replication stores it PLAINTEXT under the
 * RAW key), stages it through {@link BlobStore.putBlob}'s two-phase writer
 * (tmp → fsync → atomic rename), re-verifies the on-disk bytes against the stored
 * `contentSha256`, and flips the row back to `ok`. A no-op (leaves the row
 * `corrupt`) when no target is configured.
 *
 * Overwrite-safety (F2/F3): the current (corrupt) blob is hard-linked aside with
 * {@link BlobStore.backupCurrentBlob} BEFORE the rewrite, so if the remote copy is
 * ALSO bad — or the fetch/write fails — the local blob is restored and the row is
 * left `corrupt` (never a bad overwrite). The `maxSize = o.size` cap bounds remote
 * egress / disk write against a divergent remote object. No remote endpoint or
 * credential is ever logged (the caller redacts any error string).
 */
@Injectable()
export class IntegrityRepairService {
  private readonly log = new Logger(IntegrityRepairService.name);

  constructor(
    // @Optional so StorageModule doesn't hard-depend on the @Global
    // ReplicationModule being in the graph (e.g. isolated S3Module unit tests);
    // an absent target simply means "no target configured" → repair is a no-op.
    @Optional() private readonly target: ReplicationTargetService | undefined,
    private readonly blobs: BlobStore,
    private readonly verifier: IntegrityVerifier,
    private readonly sseKey: SseKeyService,
    @InjectEntityManager(OPEN_BUCKET_ORM_CONTEXT) private readonly em: EntityManager,
  ) {}

  async repair(o: ObjectEntity): Promise<RepairOutcome> {
    // No target configured → repair is a no-op; the row stays `corrupt` (operator
    // must restore from backup instead).
    if (!this.target?.enabled) return 'skipped-no-target';

    const bucket = o.bucket.name;

    // Fetch the remote copy FIRST so a missing remote key never disturbs the local
    // blob (getReplicated throws NoSuchKey → 'failed', local untouched).
    let remote;
    try {
      remote = await this.target!.getReplicated(o.key);
    } catch (err) {
      this.log.warn(`integrity-repair: no remote copy for ${bucket}/${o.key}`);
      throw err instanceof Error ? err : new Error(String(err));
    }

    // Hard-link the current (corrupt) blob aside so a bad remote / failed write
    // can be rolled back (F2/F3 overwrite-safety primitives).
    const backupPath = await this.blobs.backupCurrentBlob(bucket, o.key);

    // Re-encrypt to the same at-rest form when the object is SSE-S3 (the remote
    // copy is plaintext); cap with maxSize = o.size against a divergent remote.
    const cipher = o.encryption
      ? createSseCipher(this.sseKey.key(), Buffer.from(o.encryption.iv, 'base64'))
      : undefined;

    try {
      await this.blobs.putBlob(bucket, o.key, remote.stream, cipher, Number(o.size));
    } catch (err) {
      // Partial/oversized/failed fetch → restore the original and bail. putBlob
      // already unlinked its tmp file; restore the backed-up inode over any
      // half-written final (none, since the rename is the last step).
      if (backupPath) await this.blobs.restoreBackupBlob(bucket, o.key, backupPath);
      this.log.warn(`integrity-repair: staging ${bucket}/${o.key} failed`);
      throw err instanceof Error ? err : new Error(String(err));
    }

    // Re-verify the JUST-WRITTEN on-disk bytes against the stored digest (reads
    // the ciphertext back + decrypts, so this validates the encrypted form too).
    const check = await this.verifier.verify(bucket, o.key, o.contentSha256!, {
      encryption: o.encryption ?? undefined,
    });
    if (!check.ok) {
      // The remote copy is ALSO bad — undo the overwrite, leave the row `corrupt`.
      if (backupPath) await this.blobs.restoreBackupBlob(bucket, o.key, backupPath);
      this.log.warn(
        `integrity-repair: remote copy of ${bucket}/${o.key} also fails the digest; left corrupt`,
      );
      return 'failed';
    }

    // Success: drop the backup and flip the row back to `ok`.
    if (backupPath) await this.blobs.discardBackupBlob(backupPath);
    await this.em.nativeUpdate(
      ObjectEntity,
      { bucket: { name: bucket }, key: o.key },
      {
        integrityStatus: IntegrityStatus.Ok,
        integrityCheckedAt: new Date(),
        integrityDetail: 'repaired from replication target',
      },
    );
    this.log.log(`integrity-repair: repaired ${bucket}/${o.key} from replication target`);
    return 'repaired';
  }
}
