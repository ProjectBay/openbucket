import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/libsql';
import { InjectEntityManager } from '@mikro-orm/nestjs';
import { promises as fs } from 'node:fs';

import { MultipartUpload } from '../../persistence/index';
import { OPEN_BUCKET_ORM_CONTEXT } from '../../persistence/orm-context';

import { AppConfigService } from '../config/app-config.service';
import { Clock } from '../clock/clock';
import { BlobStore } from '../../storage/blob-store';
import { ScheduledTask } from './background.service';

const FIVE_MIN = 5 * 60_000;

/**
 * Reaps abandoned multipart sessions (§4.9 / §4.4.4): sessions whose
 * `initiatedAt` is older than `MULTIPART_TTL_HOURS` have their `multipart_uploads`
 * row deleted (cascading to parts) and their `multipart/<uploadId>/` staging dir
 * removed. Runs every 5 minutes via the BackgroundService scheduler; reads the
 * Clock so conformance tests can fast-forward. A failure on one session is
 * logged and the sweep continues.
 */
@Injectable()
export class MultipartCleanupRunner implements ScheduledTask {
  readonly name = 'multipart-cleanup';
  readonly intervalMs = FIVE_MIN;
  private readonly log = new Logger(MultipartCleanupRunner.name);

  constructor(
    @InjectEntityManager(OPEN_BUCKET_ORM_CONTEXT) private readonly em: EntityManager,
    private readonly blobs: BlobStore,
    private readonly config: AppConfigService,
    private readonly clock: Clock,
  ) {}

  async run(): Promise<void> {
    const ttlMs = this.config.multipartTtlHours * 60 * 60 * 1000;
    const cutoff = new Date(this.clock.nowMs() - ttlMs);

    const em = this.em.fork();
    const expired = await em.find(MultipartUpload, { initiatedAt: { $lt: cutoff } });

    let reaped = 0;
    for (const upload of expired) {
      const uploadId = upload.uploadId;
      try {
        // Row first (cascades to parts), then the on-disk staging dir.
        await em.removeAndFlush(upload);
        await fs.rm(this.blobs.paths.multipartDir(uploadId), { recursive: true, force: true });
        reaped++;
      } catch (err) {
        this.log.error(`multipart-cleanup: failed to reap ${uploadId}`, err as Error);
      }
    }
    if (reaped > 0) {
      this.log.log(`multipart-cleanup: reaped ${reaped} abandoned upload(s)`);
    }
  }
}
