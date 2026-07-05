import { Module } from '@nestjs/common';

import { DomainModule } from '../../domain/domain.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

/**
 * Admin usage-analytics endpoints (§STORY-1102). Imports DomainModule for the
 * shared BucketService (still-existing-bucket filtering); the sample tables are
 * read directly via the global ORM EntityManager. Read-only — no AuditService.
 */
@Module({
  imports: [DomainModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsAdminModule {}
