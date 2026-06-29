import { Module } from '@nestjs/common';

import { DomainModule } from '../../domain/domain.module';
import { ObjectsAdminController } from './objects-admin.controller';
import { AuditService } from '../audit/audit.service';

/**
 * Admin object browser endpoints (§5.6). Imports DomainModule for the shared
 * ObjectService; provides AuditService locally (the other admin modules' pattern).
 */
@Module({
  imports: [DomainModule],
  controllers: [ObjectsAdminController],
  providers: [AuditService],
})
export class ObjectsAdminModule {}
