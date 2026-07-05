import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation } from '@nestjs/swagger';

import { AuditQueryService } from '../../domain/audit/audit-query.service';
import { AuditQueryDto } from './dto/audit-query.dto';
import { AuditPageDto } from './dto/audit-page.dto';
import { AuditCatalogDto } from './dto/audit-catalog.dto';

/**
 * Read-only audit-log viewer API (§5.9, STORY-1103). Thin adapter over
 * {@link AuditQueryService}. Guarded by the global `JwtAuthGuard` (no
 * `@Public()`, so every route is authenticated) and the `default` throttler
 * (100/min per IP). Both routes are `GET`s over already-recorded events, so they
 * are intentionally NOT audited (read-only GETs aren't) and are safe to poll.
 * Admin-plane only — never exposed on the S3 data plane.
 */
@Controller('api/admin/audit')
export class AuditAdminController {
  constructor(private readonly svc: AuditQueryService) {}

  @Get()
  @ApiOperation({ operationId: 'listAuditEvents' })
  @ApiOkResponse({ type: AuditPageDto })
  list(@Query() q: AuditQueryDto): Promise<AuditPageDto> {
    return this.svc.list(q);
  }

  @Get('catalog')
  @ApiOperation({ operationId: 'getAuditCatalog' })
  @ApiOkResponse({ type: AuditCatalogDto })
  catalog(): AuditCatalogDto {
    return this.svc.catalog();
  }
}
