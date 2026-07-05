import { Module } from '@nestjs/common';

import { DomainModule } from '../../domain/domain.module';
import { BackgroundModule } from '../../common/background/background.module';
import { IntegrityAdminController } from './integrity-admin.controller';
import { AuditService } from '../audit/audit.service';

/**
 * Admin integrity endpoints (STORY-1204). Imports DomainModule for the shared
 * `IntegrityStatusService` (read model) and BackgroundModule for the
 * `IntegrityScrubRunner` (the manual "scrub now" kick); provides AuditService
 * locally (the other admin modules' pattern). Added to `ADMIN_CONTROLLER_MODULES`
 * so it mounts under both the standalone app and the embeddable RouterModule host.
 */
@Module({
  imports: [DomainModule, BackgroundModule],
  controllers: [IntegrityAdminController],
  providers: [AuditService],
})
export class IntegrityAdminModule {}
