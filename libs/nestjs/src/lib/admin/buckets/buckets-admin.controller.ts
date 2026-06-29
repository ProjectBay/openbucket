import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiOperation, ApiOkResponse, ApiCreatedResponse } from '@nestjs/swagger';

import { BucketService } from '../../domain/buckets/bucket.service';
import { ObjectService } from '../../domain/objects/object.service';
import { CreateBucketDto } from './dto/create-bucket.dto';
import { BucketSummaryDto } from './dto/bucket-summary.dto';
import { ListBucketsResponseDto } from './dto/list-buckets-response.dto';
import { VersioningConfigDto } from './dto/versioning.dto';
import { TaggingDto } from './dto/tagging.dto';
import { EncryptionConfigDto } from './dto/encryption.dto';
import { LifecycleConfigDto } from './dto/lifecycle.dto';
import { CorsConfigDto } from './dto/cors.dto';
import { ObjectLockConfigDto } from './dto/object-lock.dto';
import { BucketPolicyDto } from './dto/policy.dto';
import { AuditService } from '../audit/audit.service';

/** The decoded admin JWT the guard attaches to `req.user` (§5.3). */
interface AdminPrincipal {
  sub: string;
  username: string;
}

/**
 * Admin bucket endpoints (§5.5) — a thin JSON adapter over the same
 * BucketService / ObjectService the S3 controllers use. Guarded by the global
 * JwtAuthGuard (no `@Public()`). Business rules live in the domain services;
 * this maps shapes and emits audit events.
 */
@Controller('api/admin/buckets')
export class BucketsAdminController {
  constructor(
    private readonly buckets: BucketService,
    private readonly objects: ObjectService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @ApiOperation({ operationId: 'listBuckets' })
  @ApiOkResponse({ type: ListBucketsResponseDto })
  async list(): Promise<ListBucketsResponseDto> {
    const items = await this.buckets.listWithStats();
    return {
      buckets: items.map((b) => ({
        name: b.name,
        createdAt: b.createdAt.toISOString(),
        versioning: b.versioning,
        objectLock: b.objectLock,
        objectCount: b.stats.objectCount,
        sizeBytes: b.stats.sizeBytes,
      })),
      total: items.length,
    };
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ operationId: 'createBucket' })
  @ApiCreatedResponse({ type: BucketSummaryDto })
  async create(@Body() dto: CreateBucketDto, @Req() req: Request): Promise<BucketSummaryDto> {
    const bucket = await this.buckets.create({
      name: dto.name,
      versioning: dto.versioning,
      objectLock: dto.objectLock,
      region: dto.region,
    });
    this.audit.emit({
      event: 'bucket.created',
      subject: (req as Request & { user: AdminPrincipal }).user.username,
      bucket: bucket.name,
      requestId: req.openbucket.requestId,
    });
    return {
      name: bucket.name,
      createdAt: bucket.createdAt.toISOString(),
      versioning: bucket.versioning,
      objectLock: bucket.objectLock?.enabled ?? false,
      objectCount: 0,
      sizeBytes: 0,
    };
  }

  @Get(':name')
  @ApiOperation({ operationId: 'getBucket' })
  @ApiOkResponse({ type: BucketSummaryDto })
  async get(@Param('name') name: string): Promise<BucketSummaryDto> {
    const bucket = await this.buckets.findByName(name);
    if (!bucket) throw new NotFoundException(`bucket ${name} not found`);
    const stats = await this.objects.statsFor(name);
    return {
      name: bucket.name,
      createdAt: bucket.createdAt.toISOString(),
      versioning: bucket.versioning,
      objectLock: bucket.objectLock?.enabled ?? false,
      objectCount: stats.objectCount,
      sizeBytes: stats.sizeBytes,
    };
  }

  @Delete(':name')
  @HttpCode(204)
  @ApiOperation({ operationId: 'deleteBucket' })
  async delete(@Param('name') name: string, @Req() req: Request): Promise<void> {
    await this.buckets.deleteByName(name); // throws BucketNotEmpty (409) if non-empty
    this.audit.emit({
      event: 'bucket.deleted',
      subject: (req as Request & { user: AdminPrincipal }).user.username,
      bucket: name,
      requestId: req.openbucket.requestId,
    });
  }

  // -------- Config sub-resources (STORY-0612) -------------------------

  @Put(':name/versioning')
  @HttpCode(204)
  @ApiOperation({ operationId: 'putBucketVersioning' })
  async putVersioning(
    @Param('name') name: string,
    @Body() dto: VersioningConfigDto,
    @Req() req: Request,
  ): Promise<void> {
    const { from, to } = await this.buckets.setVersioning(name, dto.status);
    this.audit.emit({
      event: 'bucket.versioning.changed',
      subject: (req as Request & { user: AdminPrincipal }).user.username,
      bucket: name,
      from,
      to,
      requestId: req.openbucket.requestId,
    });
  }

  @Get(':name/tagging')
  @ApiOperation({ operationId: 'getBucketTagging' })
  @ApiOkResponse({ type: TaggingDto })
  async getTagging(@Param('name') name: string): Promise<TaggingDto> {
    return { tags: await this.buckets.getTaggingMap(name) };
  }

  @Put(':name/tagging')
  @HttpCode(204)
  @ApiOperation({ operationId: 'putBucketTagging' })
  async putTagging(
    @Param('name') name: string,
    @Body() dto: TaggingDto,
    @Req() req: Request,
  ): Promise<void> {
    await this.buckets.setTagging(name, dto.tags);
    this.audit.emit({
      event: 'bucket.tagging.changed',
      subject: (req as Request & { user: AdminPrincipal }).user.username,
      bucket: name,
      requestId: req.openbucket.requestId,
    });
  }

  @Delete(':name/tagging')
  @HttpCode(204)
  @ApiOperation({ operationId: 'deleteBucketTagging' })
  async deleteTagging(@Param('name') name: string, @Req() req: Request): Promise<void> {
    await this.buckets.clearTagging(name);
    this.audit.emit({
      event: 'bucket.tagging.changed',
      subject: (req as Request & { user: AdminPrincipal }).user.username,
      bucket: name,
      requestId: req.openbucket.requestId,
    });
  }

  @Get(':name/encryption')
  @ApiOperation({ operationId: 'getBucketEncryption' })
  @ApiOkResponse({ type: EncryptionConfigDto })
  async getEncryption(@Param('name') name: string): Promise<EncryptionConfigDto> {
    return await this.buckets.getEncryptionConfig(name);
  }

  @Put(':name/encryption')
  @HttpCode(204)
  @ApiOperation({ operationId: 'putBucketEncryption' })
  async putEncryption(
    @Param('name') name: string,
    @Body() dto: EncryptionConfigDto,
    @Req() req: Request,
  ): Promise<void> {
    await this.buckets.setEncryption(name, dto.algorithm);
    this.audit.emit({
      event: 'bucket.encryption.changed',
      subject: (req as Request & { user: AdminPrincipal }).user.username,
      bucket: name,
      requestId: req.openbucket.requestId,
    });
  }

  @Delete(':name/encryption')
  @HttpCode(204)
  @ApiOperation({ operationId: 'deleteBucketEncryption' })
  async deleteEncryption(@Param('name') name: string, @Req() req: Request): Promise<void> {
    await this.buckets.clearEncryption(name);
    this.audit.emit({
      event: 'bucket.encryption.changed',
      subject: (req as Request & { user: AdminPrincipal }).user.username,
      bucket: name,
      requestId: req.openbucket.requestId,
    });
  }

  // -------- Lifecycle / CORS / Object-Lock / Policy (STORY-0612) ------

  @Get(':name/lifecycle')
  @ApiOperation({ operationId: 'getBucketLifecycle' })
  @ApiOkResponse({ type: LifecycleConfigDto })
  async getLifecycle(@Param('name') name: string): Promise<LifecycleConfigDto> {
    return { rules: await this.buckets.getLifecycleRules(name) };
  }

  @Put(':name/lifecycle')
  @HttpCode(204)
  @ApiOperation({ operationId: 'putBucketLifecycle' })
  async putLifecycle(
    @Param('name') name: string,
    @Body() dto: LifecycleConfigDto,
    @Req() req: Request,
  ): Promise<void> {
    await this.buckets.setLifecycle(name, dto.rules);
    this.audit.emit({
      event: 'bucket.lifecycle.changed',
      subject: (req as Request & { user: AdminPrincipal }).user.username,
      bucket: name,
      requestId: req.openbucket.requestId,
    });
  }

  @Delete(':name/lifecycle')
  @HttpCode(204)
  @ApiOperation({ operationId: 'deleteBucketLifecycle' })
  async deleteLifecycle(@Param('name') name: string, @Req() req: Request): Promise<void> {
    await this.buckets.clearLifecycle(name);
    this.audit.emit({
      event: 'bucket.lifecycle.changed',
      subject: (req as Request & { user: AdminPrincipal }).user.username,
      bucket: name,
      requestId: req.openbucket.requestId,
    });
  }

  @Get(':name/cors')
  @ApiOperation({ operationId: 'getBucketCors' })
  @ApiOkResponse({ type: CorsConfigDto })
  async getCors(@Param('name') name: string): Promise<CorsConfigDto> {
    return { rules: await this.buckets.getCorsRules(name) };
  }

  @Put(':name/cors')
  @HttpCode(204)
  @ApiOperation({ operationId: 'putBucketCors' })
  async putCors(
    @Param('name') name: string,
    @Body() dto: CorsConfigDto,
    @Req() req: Request,
  ): Promise<void> {
    await this.buckets.setCors(name, dto.rules);
    this.audit.emit({
      event: 'bucket.cors.changed',
      subject: (req as Request & { user: AdminPrincipal }).user.username,
      bucket: name,
      requestId: req.openbucket.requestId,
    });
  }

  @Delete(':name/cors')
  @HttpCode(204)
  @ApiOperation({ operationId: 'deleteBucketCors' })
  async deleteCors(@Param('name') name: string, @Req() req: Request): Promise<void> {
    await this.buckets.clearCors(name);
    this.audit.emit({
      event: 'bucket.cors.changed',
      subject: (req as Request & { user: AdminPrincipal }).user.username,
      bucket: name,
      requestId: req.openbucket.requestId,
    });
  }

  @Get(':name/object-lock')
  @ApiOperation({ operationId: 'getBucketObjectLock' })
  @ApiOkResponse({ type: ObjectLockConfigDto })
  async getObjectLock(@Param('name') name: string): Promise<ObjectLockConfigDto> {
    return await this.buckets.getObjectLock(name);
  }

  @Put(':name/object-lock')
  @HttpCode(204)
  @ApiOperation({ operationId: 'putBucketObjectLock' })
  async putObjectLock(
    @Param('name') name: string,
    @Body() dto: ObjectLockConfigDto,
    @Req() req: Request,
  ): Promise<void> {
    await this.buckets.setObjectLock(name, dto);
    this.audit.emit({
      event: 'bucket.objectlock.changed',
      subject: (req as Request & { user: AdminPrincipal }).user.username,
      bucket: name,
      requestId: req.openbucket.requestId,
    });
  }

  @Get(':name/policy')
  @ApiOperation({ operationId: 'getBucketPolicy' })
  @ApiOkResponse({ type: BucketPolicyDto })
  async getPolicy(@Param('name') name: string): Promise<BucketPolicyDto> {
    return { policy: (await this.buckets.getPolicyDoc(name)) as unknown as Record<string, unknown> };
  }

  @Put(':name/policy')
  @HttpCode(204)
  @ApiOperation({ operationId: 'putBucketPolicy' })
  async putPolicy(
    @Param('name') name: string,
    @Body() dto: BucketPolicyDto,
    @Req() req: Request,
  ): Promise<void> {
    await this.buckets.setPolicy(name, dto.policy);
    this.audit.emit({
      event: 'bucket.policy.changed',
      subject: (req as Request & { user: AdminPrincipal }).user.username,
      bucket: name,
      requestId: req.openbucket.requestId,
    });
  }

  @Delete(':name/policy')
  @HttpCode(204)
  @ApiOperation({ operationId: 'deleteBucketPolicy' })
  async deletePolicy(@Param('name') name: string, @Req() req: Request): Promise<void> {
    await this.buckets.clearPolicy(name);
    this.audit.emit({
      event: 'bucket.policy.changed',
      subject: (req as Request & { user: AdminPrincipal }).user.username,
      bucket: name,
      requestId: req.openbucket.requestId,
    });
  }
}
