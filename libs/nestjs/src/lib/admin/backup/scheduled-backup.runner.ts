import { Inject, Injectable } from '@nestjs/common';

import { Clock } from '../../common/clock/clock';
import { ScheduledTask } from '../../common/background/background.service';
import { ScheduledBackupService } from './scheduled-backup.service';
import {
  SCHEDULED_BACKUP_CONFIG,
  type ScheduledBackupConfig,
} from './scheduled-backup-config';

/**
 * Scheduled-backup tick (STORY-1203). Registered unconditionally on the §4.9
 * background scheduler alongside the other runners; a no-op when scheduling is
 * disabled (like `ReplicationWorkerRunner`). It wakes on the fixed
 * `checkIntervalMs` tick, and if a snapshot is due (from the cron/interval
 * schedule + the filesystem-persisted last-run marker) delegates the actual work
 * to {@link ScheduledBackupService} — which the admin run-now shares, so both
 * take the same path under the same in-flight lock.
 *
 * `BackgroundService` already wraps each tick in a per-tick `RequestContext` and
 * enforces the no-pileup guard (a slow snapshot cycle simply skips the next
 * wake), so the runner needs no ORM plumbing of its own.
 */
@Injectable()
export class ScheduledBackupRunner implements ScheduledTask {
  readonly name = 'scheduled-backup';

  constructor(
    @Inject(SCHEDULED_BACKUP_CONFIG) private readonly config: ScheduledBackupConfig,
    private readonly svc: ScheduledBackupService,
    private readonly clock: Clock,
  ) {}

  /** Config-driven wake tick; the scheduler snapshots this into `setInterval`. */
  get intervalMs(): number {
    return this.config.checkIntervalMs;
  }

  async run(): Promise<void> {
    if (!this.config.enabled) return; // registered unconditionally; cheap no-op
    if (!(await this.svc.isDue(this.clock.nowMs()))) return;
    await this.svc.runSnapshotCycle('scheduled');
  }
}
