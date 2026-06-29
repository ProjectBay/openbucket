import { Module } from '@nestjs/common';

import { DomainModule } from '../../domain/domain.module';
import { BucketsAdminController } from './buckets-admin.controller';
import { AuditService } from '../audit/audit.service';

/**
 * Admin bucket endpoints (§5.5). Imports DomainModule for the shared
 * BucketService / ObjectService; provides AuditService locally (the same
 * stateless-emitter pattern the other admin modules use).
 */
@Module({
  imports: [DomainModule],
  controllers: [BucketsAdminController],
  providers: [AuditService],
})
export class BucketsAdminModule {}
