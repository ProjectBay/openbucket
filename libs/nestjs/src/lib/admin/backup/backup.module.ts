import { Module } from '@nestjs/common';

import { DomainModule } from '../../domain/domain.module';
import { StorageModule } from '../../storage/storage.module';
import { BackupController } from './backup.controller';
import { BackupService } from './backup.service';

/**
 * Admin backup & restore endpoints. Pulls the shared domain services
 * (BucketService/ObjectService) from DomainModule and ObjectWriterService from
 * StorageModule; the repositories are @Global (PersistenceModule).
 */
@Module({
  imports: [DomainModule, StorageModule],
  controllers: [BackupController],
  providers: [BackupService],
})
export class BackupModule {}
