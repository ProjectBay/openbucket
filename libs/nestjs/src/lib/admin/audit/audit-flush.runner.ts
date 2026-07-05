import { Injectable, Logger } from '@nestjs/common';

import { AuditLogRepository } from '../../persistence/repositories/audit-log.repository';
import { AppConfigService } from '../../common/config/app-config.service';
import { ScheduledTask } from '../../common/background/background.service';
import { AuditSink } from './audit-sink';

const MS_PER_DAY = 86_400_000;
const DRAIN_BATCH = 1000;

/**
 * Drains {@link AuditSink} to `audit_logs` and prunes past retention
 * (STORY-1103, TASK-3331). A {@link ScheduledTask} mirroring
 * `trash-purge.runner.ts` / `usage-rollup.runner.ts`: the scheduler wraps
 * `run()` in a per-tick MikroORM `RequestContext` and skips overlapping ticks,
 * so there is no identity-map leakage and no pile-up.
 *
 * Each tick batch-inserts every buffered row, then (at most once per UTC day —
 * guarded by `lastPruneDay`) deletes rows older than `AUDIT_RETENTION_DAYS`. A
 * non-zero drop count from the sink is logged. An insert failure propagates to
 * the scheduler's try/catch: the drained rows are lost but their Pino lines
 * survived (acceptable, logged).
 */
@Injectable()
export class AuditFlushRunner implements ScheduledTask {
  readonly name = 'audit-flush';
  private readonly log = new Logger(AuditFlushRunner.name);
  private lastPruneDay = -1;

  constructor(
    private readonly sink: AuditSink,
    private readonly repo: AuditLogRepository,
    private readonly config: AppConfigService,
  ) {}

  /** Config-driven; the scheduler snapshots this into its `setInterval` at boot. */
  get intervalMs(): number {
    return this.config.auditFlushMs;
  }

  async run(): Promise<void> {
    // Drain-and-insert until the buffer is empty (a burst may exceed one batch).
    let flushed = 0;
    for (;;) {
      const batch = this.sink.drain(DRAIN_BATCH);
      if (batch.length === 0) break;
      await this.repo.insertMany(batch);
      flushed += batch.length;
    }

    const dropped = this.sink.takeDropped();
    if (dropped > 0) {
      this.log.warn(
        `audit-flush: buffer overflow dropped ${dropped} event(s) — raise AUDIT_BUFFER_MAX or lower AUDIT_FLUSH_MS`,
      );
    }
    if (flushed > 0) {
      this.log.debug(`audit-flush: persisted ${flushed} audit event(s)`);
    }

    // Retention prune — at most once per UTC day (bounded table growth).
    const now = Date.now();
    const today = Math.floor(now / MS_PER_DAY);
    if (today !== this.lastPruneDay) {
      this.lastPruneDay = today;
      const cutoff = new Date(now - this.config.auditRetentionDays * MS_PER_DAY);
      const removed = await this.repo.pruneOlderThan(cutoff);
      if (removed > 0) {
        this.log.log(`audit-flush: pruned ${removed} audit event(s) older than retention`);
      }
    }
  }
}
