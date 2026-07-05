import { Module } from '@nestjs/common';

import { DomainModule } from '../../domain/domain.module';
import { ReplicationAdminController } from './replication-admin.controller';
import { AuditService } from '../audit/audit.service';

/**
 * Admin replication endpoints (STORY-0902). Imports DomainModule for the shared
 * `ReplicationStatusService` + `ReconcileService`; provides AuditService locally
 * (the other admin modules' pattern). Added to `ADMIN_CONTROLLER_MODULES` so it
 * mounts under both the standalone app and the embeddable RouterModule host mount.
 */
@Module({
  imports: [DomainModule],
  controllers: [ReplicationAdminController],
  providers: [AuditService],
})
export class ReplicationAdminModule {}
