import { Module } from '@nestjs/common';

import { DomainModule } from '../../domain/domain.module';
import { StorageModule } from '../../storage/storage.module';
import { BackgroundService, SCHEDULED_TASKS, ScheduledTask } from './background.service';
import { LifecycleSweepRunner } from './lifecycle-sweep.runner';
import { MultipartCleanupRunner } from './multipart-cleanup.runner';
import { TrashPurgeRunner } from './trash-purge.runner';

/**
 * Hosts the in-process tick scheduler (§4.9). Recurring runners implement
 * ScheduledTask and are collected under the `SCHEDULED_TASKS` token; the
 * scheduler discovers and schedules them. NestJS has no Angular-style `multi`
 * flag, so the token is provided by a single factory that injects every runner
 * and returns them as an array — add new runners both to `providers` and to the
 * factory's `inject` list. MikroORM / Clock / AppConfigService are global;
 * StorageModule supplies BlobStore for the staging paths.
 */
@Module({
  imports: [StorageModule, DomainModule],
  providers: [
    BackgroundService,
    MultipartCleanupRunner,
    LifecycleSweepRunner,
    TrashPurgeRunner,
    {
      provide: SCHEDULED_TASKS,
      useFactory: (...tasks: ScheduledTask[]) => tasks,
      inject: [MultipartCleanupRunner, LifecycleSweepRunner, TrashPurgeRunner],
    },
  ],
  exports: [BackgroundService],
})
export class BackgroundModule {}
