import { Controller, Get, HttpCode, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ApiOkResponse, ApiOperation } from '@nestjs/swagger';

import { IntegrityStatusService } from '../../domain/integrity/integrity-status.service';
import { IntegrityScrubRunner } from '../../common/background/integrity-scrub.runner';
import { AuditService } from '../audit/audit.service';
import { CorruptListDto, CorruptQueryDto } from './dto/corrupt-object.dto';
import { IntegrityStatusDto } from './dto/integrity-status.dto';

/** The decoded admin JWT the guard attaches to `req.user` (§5.3). */
interface AdminPrincipal {
  sub: string;
  username: string;
}

/**
 * Admin integrity endpoints (STORY-1204) — a thin JSON adapter over
 * `IntegrityStatusService` (read model) and the `IntegrityScrubRunner` manual
 * kick. Guarded by the global `JwtAuthGuard` (no `@Public()`) and the `default`
 * 100/min throttler. JSON, so it MUST appear in the OpenAPI doc — NOT
 * `@ApiExcludeController()`.
 *
 * The read routes return counts + object identities only — never a remote
 * endpoint or credential (EPIC-08). Read routes are not audited (v1 "no read
 * auditing" rule); only the `POST scrub` trigger is.
 */
@Controller('api/admin/integrity')
export class IntegrityAdminController {
  constructor(
    private readonly status: IntegrityStatusService,
    private readonly scrub: IntegrityScrubRunner,
    private readonly audit: AuditService,
  ) {}

  @Get('status')
  @ApiOperation({ operationId: 'getIntegrityStatus' })
  @ApiOkResponse({ type: IntegrityStatusDto })
  async getStatus(): Promise<IntegrityStatusDto> {
    // Always 200, even when the scrub is disabled/unconfigured (enabled:false,
    // zeroed counters). Not audited (read-only).
    return (await this.status.getStatus()) as IntegrityStatusDto;
  }

  @Get('corrupt')
  @ApiOperation({ operationId: 'listCorruptObjects' })
  @ApiOkResponse({ type: CorruptListDto })
  async listCorrupt(@Query() q: CorruptQueryDto): Promise<CorruptListDto> {
    // `limit` capped at 200 by the DTO — the route can't become an unbounded scan.
    return (await this.status.listCorrupt({ limit: q.limit, offset: q.offset })) as CorruptListDto;
  }

  @Post('scrub')
  @HttpCode(202)
  @ApiOperation({ operationId: 'startIntegrityScrub' })
  @ApiOkResponse({ description: 'Scrub requested; runs on the next tick.' })
  async startScrub(@Req() req: Request): Promise<{ triggered: boolean }> {
    // Sets the runner's in-memory one-shot flag; honored on the next tick and does
    // NOT bypass the per-tick byte/object budget. Audited (state-changing).
    this.scrub.triggerManual();
    const subject = (req as Request & { user: AdminPrincipal }).user.username;
    this.audit.emit({
      event: 'integrity.scrub.started',
      subject,
      requestId: req.openbucket?.requestId,
    });
    return { triggered: true };
  }
}
