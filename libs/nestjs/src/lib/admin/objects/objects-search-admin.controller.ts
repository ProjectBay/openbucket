import { Controller, Get, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ObjectService } from '../../domain/objects/object.service';
import { AuditService } from '../audit/audit.service';
import { ObjectSearchQueryDto } from './dto/object-search-query.dto';
import { ObjectSearchResponseDto } from './dto/object-search-response.dto';

/** The decoded admin JWT the guard attaches to `req.user` (§5.3). */
interface AdminPrincipal {
  sub: string;
  username: string;
}

/**
 * Cross-bucket object search (§STORY-1101). A DEDICATED controller at
 * `api/admin/objects` — kept OFF the per-bucket `api/admin/buckets/:name/objects`
 * controller whose `@Get('*')` key catch-all would otherwise swallow `/search`.
 * Registered in `objects-admin.module.ts` (imported by AdminModule), so it
 * inherits the global `JwtAuthGuard` (401 without a bearer token) and the
 * `ThrottlerGuard` `default` bucket (100/min/IP → 429) with no extra wiring — no
 * bespoke guard, no policy-evaluator on the admin plane (EPIC-08 posture).
 *
 * Tagged `ObjectsAdmin` so the generated client folds `searchObjects` into the
 * existing `ObjectsAdminService` alongside the other object operations.
 */
@ApiTags('ObjectsAdmin')
@Controller('api/admin/objects')
export class ObjectsSearchAdminController {
  constructor(
    private readonly objects: ObjectService,
    private readonly audit: AuditService,
  ) {}

  @Get('search')
  @ApiOperation({ operationId: 'searchObjects' })
  @ApiOkResponse({ type: ObjectSearchResponseDto })
  async search(
    @Query() q: ObjectSearchQueryDto,
    @Req() req: Request,
  ): Promise<ObjectSearchResponseDto> {
    const page = await this.objects.search({
      q: q.q,
      mode: q.mode,
      bucket: q.bucket,
      tagKey: q.tagKey,
      tagValue: q.tagValue,
      cursor: q.cursor,
      limit: q.limit,
    });
    // Audit the SHAPE of the search (mode, whether a tag filter was used, result
    // count) — never the raw `q` term, to avoid logging sensitive key fragments.
    this.audit.emit({
      event: 'object.searched',
      subject: (req as Request & { user: AdminPrincipal }).user.username,
      mode: q.mode,
      hasTag: q.tagKey !== undefined,
      count: page.results.length,
      requestId: req.openbucket.requestId,
    });
    return {
      results: page.results.map((h) => ({
        bucket: h.bucket,
        key: h.key,
        size: h.size,
        etag: h.etag,
        lastModified: h.lastModified.toISOString(),
        storageClass: h.storageClass,
        contentType: h.contentType,
      })),
      isTruncated: page.isTruncated,
      nextCursor: page.nextCursor,
    };
  }
}
