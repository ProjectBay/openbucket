import { Module } from '@nestjs/common';

import { DomainModule } from '../../domain/domain.module';
import { StorageModule } from '../../storage/storage.module';
import { AppConfigService } from '../../common/config/app-config.service';
import { BackupController } from './backup.controller';
import { BackupScheduleController } from './backup-schedule.controller';
import { BackupService } from './backup.service';
import { ScheduledBackupService } from './scheduled-backup.service';
import {
  SCHEDULED_BACKUP_CONFIG,
  resolveScheduledBackupConfig,
} from './scheduled-backup-config';

/**
 * Admin backup & restore endpoints. Pulls the shared domain services
 * (BucketService/ObjectService) from DomainModule and ObjectWriterService from
 * StorageModule; the repositories are @Global (PersistenceModule).
 *
 * STORY-1203 adds scheduled backups: `SCHEDULED_BACKUP_CONFIG` is resolved once
 * from `AppConfigService` (both config sources funnel through it, like
 * REPLICATION_CONFIG), and `ScheduledBackupService` (+ config) are exported so the
 * background `ScheduledBackupRunner` can share the same run path as the admin
 * run-now. `ReplicationTargetService` is pulled from the @Global ReplicationModule
 * (@Optional in the service).
 */
@Module({
  imports: [DomainModule, StorageModule],
  controllers: [BackupController, BackupScheduleController],
  providers: [
    BackupService,
    ScheduledBackupService,
    {
      provide: SCHEDULED_BACKUP_CONFIG,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => resolveScheduledBackupConfig(config),
    },
  ],
  exports: [ScheduledBackupService, SCHEDULED_BACKUP_CONFIG],
})
export class BackupModule {}
