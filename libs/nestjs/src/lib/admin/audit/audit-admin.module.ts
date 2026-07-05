import { Module } from '@nestjs/common';

import { AuditQueryService } from '../../domain/audit/audit-query.service';
import { AuditAdminController } from './audit-admin.controller';

/**
 * Admin audit-viewer endpoints (§5.9, STORY-1103). Provides the read-only
 * {@link AuditQueryService} (which reads `AuditLogRepository` from the @Global
 * PersistenceModule) and its controller. Listed in `ADMIN_CONTROLLER_MODULES`
 * (so the provider/controller are wired) AND as a RouterModule child in
 * `open-bucket.module.ts` (so `/api/admin/audit` is mounted). Read-only — no
 * AuditService, and the global JwtAuthGuard + throttler apply unchanged.
 */
@Module({
  controllers: [AuditAdminController],
  providers: [AuditQueryService],
})
export class AuditAdminModule {}
