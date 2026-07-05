import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation } from '@nestjs/swagger';

import { ReconcileService } from '../../domain/replication/reconcile.service';
import { ReplicationStatusService } from '../../domain/replication/replication-status.service';
import type { ReconcileJob } from '../../persistence/entities/reconcile-job.entity';
import { AuditService } from '../audit/audit.service';
import { ReconcileJobDto } from './dto/reconcile-job.dto';
import { ReconcileRequestDto } from './dto/reconcile-request.dto';
import { ReplicationStatusDto } from './dto/replication-status.dto';

/** The decoded admin JWT the guard attaches to `req.user` (§5.3). */
interface AdminPrincipal {
  sub: string;
  username: string;
}

/**
 * Admin replication endpoints (STORY-0902) — a thin JSON adapter over
 * `ReplicationStatusService` (read model) and `ReconcileService` (backfill
 * trigger). Guarded by the global `JwtAuthGuard` (no `@Public()`) and the
 * `default` 100/min throttler. Unlike `BackupController` this is JSON and MUST
 * appear in the OpenAPI doc, so it is NOT `@ApiExcludeController()`.
 *
 * `POST /reconcile` is single-flight in `ReconcileService` (a `ConflictException`
 * → 409 when a job is already active): throttling + single-flight together bound
 * remote-listing load. No remote endpoint/credential is ever surfaced or audited.
 */
@Controller('api/admin/replication')
export class ReplicationAdminController {
  constructor(
    private readonly status: ReplicationStatusService,
    private readonly reconcile: ReconcileService,
    private readonly audit: AuditService,
  ) {}

  @Get('status')
  @ApiOperation({ operationId: 'getReplicationStatus' })
  @ApiOkResponse({ type: ReplicationStatusDto })
  async getStatus(): Promise<ReplicationStatusDto> {
    // Read-only — not audited (v1 "no read auditing" rule). Always 200, even
    // when replication is unconfigured (enabled:false, zeroed counters).
    return (await this.status.getStatus()) as ReplicationStatusDto;
  }

  @Post('reconcile')
  @HttpCode(202)
  @ApiOperation({ operationId: 'startReconcile' })
  @ApiCreatedResponse({ type: ReconcileJobDto })
  async startReconcile(
    @Body() dto: ReconcileRequestDto,
    @Req() req: Request,
  ): Promise<ReconcileJobDto> {
    const subject = (req as Request & { user: AdminPrincipal }).user.username;
    // Delegates single-flight enforcement to the service: a second concurrent
    // request while a job is active throws ConflictException → 409.
    const job = await this.reconcile.start({
      scope: dto.bucket ? 'bucket' : 'instance',
      bucket: dto.bucket,
      subject,
    });
    this.audit.emit({
      event: 'replication.reconcile.started',
      subject,
      jobId: job.id,
      ...(dto.bucket ? { bucket: dto.bucket } : {}),
      requestId: req.openbucket.requestId,
    });
    return toJobDto(job);
  }

  @Get('reconcile/:jobId')
  @ApiOperation({ operationId: 'getReconcileJob' })
  @ApiOkResponse({ type: ReconcileJobDto })
  async getJob(@Param('jobId') jobId: string): Promise<ReconcileJobDto> {
    const job = await this.reconcile.get(jobId);
    if (!job) throw new NotFoundException(`reconcile job ${jobId} not found`);
    return toJobDto(job);
  }
}

/** Map the durable job entity to its wire DTO. */
function toJobDto(job: ReconcileJob): ReconcileJobDto {
  return {
    jobId: job.id,
    scope: job.scope,
    bucket: job.bucket,
    state: job.state,
    localScanned: job.localScanned,
    remoteScanned: job.remoteScanned,
    missingRequeued: job.missingRequeued,
    startedAt: job.startedAt ? job.startedAt.toISOString() : null,
    finishedAt: job.finishedAt ? job.finishedAt.toISOString() : undefined,
    error: job.error,
  };
}
