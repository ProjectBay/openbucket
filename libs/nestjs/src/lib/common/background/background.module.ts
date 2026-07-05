import { Module } from '@nestjs/common';

import { DomainModule } from '../../domain/domain.module';
import { StorageModule } from '../../storage/storage.module';
import { AuditService } from '../../admin/audit/audit.service';
import { BackupModule } from '../../admin/backup/backup.module';
import { ScheduledBackupRunner } from '../../admin/backup/scheduled-backup.runner';
import { BackgroundService, SCHEDULED_TASKS, ScheduledTask } from './background.service';
import { DerivativeCacheGcRunner } from './derivative-cache-gc.runner';
import { IntegrityScrubRunner } from './integrity-scrub.runner';
import { LifecycleSweepRunner } from './lifecycle-sweep.runner';
import { MultipartCleanupRunner } from './multipart-cleanup.runner';
import { ReconcileRunner } from './reconcile.runner';
import { ReplicationWorkerRunner } from './replication.runner';
import { TagIndexBackfillRunner } from './tag-index-backfill.runner';
import { TieringSweepRunner } from './tiering-sweep.runner';
import { TrashPurgeRunner } from './trash-purge.runner';
import { UsageRollupRunner } from './usage-rollup.runner';
import { WebhookDeliveryRunner } from '../../events/webhook-delivery.runner';
import { AuditFlushRunner } from '../../admin/audit/audit-flush.runner';

/**
 * Hosts the in-process tick scheduler (§4.9). Recurring runners implement
 * ScheduledTask and are collected under the `SCHEDULED_TASKS` token; the
 * scheduler discovers and schedules them. NestJS has no Angular-style `multi`
 * flag, so the token is provided by a single factory that injects every runner
 * and returns them as an array — add new runners both to `providers` and to the
 * factory's `inject` list. MikroORM / Clock / AppConfigService are global;
 * StorageModule supplies BlobStore for the staging paths. The @Global EventsModule
 * supplies WebhookSigner + (via PersistenceModule) EventDeliveryRepository for the
 * WebhookDeliveryRunner (STORY-0801).
 */
@Module({
  imports: [StorageModule, DomainModule, BackupModule],
  providers: [
    BackgroundService,
    AuditService,
    MultipartCleanupRunner,
    LifecycleSweepRunner,
    TrashPurgeRunner,
    DerivativeCacheGcRunner,
    WebhookDeliveryRunner,
    ReplicationWorkerRunner,
    ReconcileRunner,
    TieringSweepRunner,
    TagIndexBackfillRunner,
    UsageRollupRunner,
    // STORY-1204: throttled bit-rot detection + repair-from-replication.
    IntegrityScrubRunner,
    // STORY-1203: shares ScheduledBackupService (exported by BackupModule) with
    // the admin run-now, so the tick + run-now take one path / one in-flight lock.
    ScheduledBackupRunner,
    {
      provide: SCHEDULED_TASKS,
      useFactory: (...tasks: ScheduledTask[]) => tasks,
      inject: [
        MultipartCleanupRunner,
        LifecycleSweepRunner,
        TrashPurgeRunner,
        DerivativeCacheGcRunner,
        WebhookDeliveryRunner,
        ReplicationWorkerRunner,
        ReconcileRunner,
        TieringSweepRunner,
        TagIndexBackfillRunner,
        UsageRollupRunner,
        IntegrityScrubRunner,
        ScheduledBackupRunner,
        // Provided + exported by the @Global AuditModule (STORY-1103); collected
        // here since BackgroundModule owns the app-wide SCHEDULED_TASKS list.
        AuditFlushRunner,
      ],
    },
  ],
  // IntegrityScrubRunner is exported so the admin "scrub now" trigger (STORY-1204)
  // can call its in-memory one-shot kick without going through the scheduler.
  exports: [BackgroundService, IntegrityScrubRunner],
})
export class BackgroundModule {}
