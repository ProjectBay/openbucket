import { Module } from '@nestjs/common';

import { DomainModule } from '../../domain/domain.module';
import { ObjectsAdminController } from './objects-admin.controller';
import { ObjectsSearchAdminController } from './objects-search-admin.controller';
import { AuditService } from '../audit/audit.service';

/**
 * Admin object browser endpoints (§5.6) + cross-bucket search (§STORY-1101).
 * Imports DomainModule for the shared ObjectService; provides AuditService
 * locally (the other admin modules' pattern). The search controller sits on its
 * own `api/admin/objects` base so the per-bucket `@Get('*')` catch-all can't
 * swallow it.
 */
@Module({
  imports: [DomainModule],
  controllers: [ObjectsAdminController, ObjectsSearchAdminController],
  providers: [AuditService],
})
export class ObjectsAdminModule {}
