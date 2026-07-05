import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiOkResponse } from '@nestjs/swagger';

import { AnalyticsService } from './analytics.service';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';
import { StorageSeriesDto } from './dto/storage-series.dto';
import { BucketBreakdownDto } from './dto/bucket-breakdown.dto';
import { RequestSeriesDto } from './dto/request-series.dto';

/**
 * Read-only usage-analytics endpoints (§STORY-1102, §5). Thin adapter over
 * {@link AnalyticsService}. Guarded by the global `JwtAuthGuard` (no `@Public()`,
 * so every route is authenticated) and the `default` throttler (100/min); these
 * are `GET`s, so they are intentionally NOT audited and are safe to poll.
 */
@Controller('api/admin/analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('storage')
  @ApiOperation({ operationId: 'getStorageAnalytics' })
  @ApiOkResponse({ type: StorageSeriesDto })
  getStorage(@Query() q: AnalyticsQueryDto): Promise<StorageSeriesDto> {
    return this.analytics.storageSeries(q.range, q.bucket);
  }

  @Get('buckets')
  @ApiOperation({ operationId: 'getBucketBreakdown' })
  @ApiOkResponse({ type: BucketBreakdownDto })
  getBuckets(): Promise<BucketBreakdownDto> {
    return this.analytics.bucketBreakdown();
  }

  @Get('requests')
  @ApiOperation({ operationId: 'getRequestAnalytics' })
  @ApiOkResponse({ type: RequestSeriesDto })
  getRequests(@Query() q: AnalyticsQueryDto): Promise<RequestSeriesDto> {
    return this.analytics.requestSeries(q.range);
  }
}
