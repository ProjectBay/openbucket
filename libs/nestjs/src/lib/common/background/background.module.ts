import { Module } from '@nestjs/common';

import { DomainModule } from '../../domain/domain.module';
import { StorageModule } from '../../storage/storage.module';
import { BackgroundService, SCHEDULED_TASKS, ScheduledTask } from './background.service';
import { DerivativeCacheGcRunner } from './derivative-cache-gc.runner';
import { LifecycleSweepRunner } from './lifecycle-sweep.runner';
import { MultipartCleanupRunner } from './multipart-cleanup.runner';
import { ReplicationWorkerRunner } from './replication.runner';
import { TrashPurgeRunner } from './trash-purge.runner';
import { WebhookDeliveryRunner } from '../../events/webhook-delivery.runner';

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
  imports: [StorageModule, DomainModule],
  providers: [
    BackgroundService,
    MultipartCleanupRunner,
    LifecycleSweepRunner,
    TrashPurgeRunner,
    DerivativeCacheGcRunner,
    WebhookDeliveryRunner,
    ReplicationWorkerRunner,
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
      ],
    },
  ],
  exports: [BackgroundService],
})
export class BackgroundModule {}
