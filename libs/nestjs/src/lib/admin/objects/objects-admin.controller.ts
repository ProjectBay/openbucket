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
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Readable } from 'node:stream';
import { ApiOperation, ApiParam, ApiOkResponse } from '@nestjs/swagger';

import { ObjectService } from '../../domain/objects/object.service';
import { ListObjectsQueryDto } from './dto/list-objects-query.dto';
import { ListObjectsResponseDto } from './dto/list-objects-response.dto';
import { ObjectMetaDto } from './dto/object-meta.dto';
import { BulkDeleteDto } from './dto/bulk-delete.dto';
import { BulkDeleteResponseDto } from './dto/bulk-delete-response.dto';
import { ObjectVersionsQueryDto } from './dto/object-versions-query.dto';
import { ObjectVersionsResponseDto } from './dto/object-versions-response.dto';
import { ObjectTaggingDto } from './dto/object-tagging.dto';
import { RetentionDto } from './dto/retention.dto';
import { LegalHoldDto } from './dto/legal-hold.dto';
import { PresignRequestDto } from './dto/presign.dto';
import { PresignedUrlDto } from './dto/presigned-url.dto';
import { buildPresignedUrl, MAX_EXPIRES } from '../../s3/sigv4/presigned';
import { AppConfigService } from '../../common/config/app-config.service';
import { AuditService } from '../audit/audit.service';

/** The decoded admin JWT the guard attaches to `req.user` (§5.3). */
interface AdminPrincipal {
  sub: string;
  username: string;
}

/**
 * Admin object browser (§5.6) — folder-style listing, metadata, and delete over
 * ObjectService. Guarded by the global JwtAuthGuard.
 *
 * Slash-bearing keys: the whitepaper's `:key(*)` param syntax is Express 4 and
 * does not exist in this codebase's Express 5 / path-to-regexp 8. Instead the
 * key is read from the raw (still-encoded) request path and decoded EXACTLY once
 * (§5.13) — so a client double-encode (`%252F`) decodes to `%2F`, not `/`.
 */
@Controller('api/admin/buckets/:name/objects')
export class ObjectsAdminController {
  constructor(
    private readonly objects: ObjectService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
  ) {}

  @Get()
  @ApiOperation({ operationId: 'listObjects' })
  @ApiOkResponse({ type: ListObjectsResponseDto })
  async list(
    @Param('name') bucket: string,
    @Query() q: ListObjectsQueryDto,
  ): Promise<ListObjectsResponseDto> {
    const page = await this.objects.list({
      bucket,
      prefix: q.prefix,
      delimiter: q.delimiter,
      marker: q.marker,
      limit: q.limit,
    });
    return {
      bucket,
      prefix: q.prefix ?? '',
      delimiter: q.delimiter,
      marker: q.marker,
      nextMarker: page.nextMarker,
      isTruncated: page.isTruncated,
      contents: page.contents.map((o) => ({
        key: o.key,
        size: o.size,
        etag: o.etag,
        lastModified: o.lastModified.toISOString(),
        storageClass: o.storageClass,
        location: o.location,
      })),
      commonPrefixes: page.commonPrefixes,
    };
  }

  @Post('batch-delete')
  @HttpCode(200)
  @ApiOperation({ operationId: 'batchDeleteObjects' })
  @ApiOkResponse({ type: BulkDeleteResponseDto })
  async batchDelete(
    @Param('name') bucket: string,
    @Body() dto: BulkDeleteDto,
    @Req() req: Request,
  ): Promise<BulkDeleteResponseDto> {
    const deleted: BulkDeleteResponseDto['deleted'] = [];
    const errors: BulkDeleteResponseDto['errors'] = [];
    for (const entry of dto.keys) {
      try {
        const result = await this.objects.deleteOne(bucket, entry.key, entry.versionId);
        const versionId = result.versionId ?? entry.versionId;
        deleted.push(versionId ? { key: entry.key, versionId } : { key: entry.key });
        this.audit.emit({
          event: 'object.deleted',
          subject: (req as Request & { user: AdminPrincipal }).user.username,
          bucket,
          key: entry.key,
          requestId: req.openbucket.requestId,
        });
      } catch (err) {
        errors.push({
          key: entry.key,
          ...(entry.versionId ? { versionId: entry.versionId } : {}),
          code: 'InternalError',
          message: err instanceof Error ? err.message : 'delete failed',
        });
      }
    }
    return { deleted, errors };
  }

  // -------- Versions + tagging (STORY-0612) — literal routes registered
  // before the `*` key handlers so they win; the object key is a query param
  // (`?key=`) to stay clear of the slash-bearing `*` family.

  @Get('versions')
  @ApiOperation({ operationId: 'listObjectVersions' })
  @ApiOkResponse({ type: ObjectVersionsResponseDto })
  async listVersions(
    @Param('name') bucket: string,
    @Query() q: ObjectVersionsQueryDto,
  ): Promise<ObjectVersionsResponseDto> {
    return this.objects.listVersionsJson(bucket, {
      prefix: q.prefix,
      keyMarker: q.keyMarker,
      versionIdMarker: q.versionIdMarker,
      maxKeys: q.maxKeys,
    });
  }

  @Get('tagging')
  @ApiOperation({ operationId: 'getObjectTagging' })
  @ApiOkResponse({ type: ObjectTaggingDto })
  async getObjectTagging(
    @Param('name') bucket: string,
    @Query('key') key: string,
  ): Promise<ObjectTaggingDto> {
    return { tags: await this.objects.getTaggingMap(bucket, key) };
  }

  @Put('tagging')
  @HttpCode(204)
  @ApiOperation({ operationId: 'putObjectTagging' })
  async putObjectTagging(
    @Param('name') bucket: string,
    @Query('key') key: string,
    @Body() dto: ObjectTaggingDto,
    @Req() req: Request,
  ): Promise<void> {
    await this.objects.setTaggingMap(bucket, key, dto.tags);
    this.audit.emit({
      event: 'object.tagging.changed',
      subject: (req as Request & { user: AdminPrincipal }).user.username,
      bucket,
      key,
      requestId: req.openbucket.requestId,
    });
  }

  @Delete('tagging')
  @HttpCode(204)
  @ApiOperation({ operationId: 'deleteObjectTagging' })
  async deleteObjectTagging(
    @Param('name') bucket: string,
    @Query('key') key: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.objects.clearTaggingMap(bucket, key);
    this.audit.emit({
      event: 'object.tagging.changed',
      subject: (req as Request & { user: AdminPrincipal }).user.username,
      bucket,
      key,
      requestId: req.openbucket.requestId,
    });
  }

  @Get('retention')
  @ApiOperation({ operationId: 'getObjectRetention' })
  @ApiOkResponse({ type: RetentionDto })
  async getObjectRetention(
    @Param('name') bucket: string,
    @Query('key') key: string,
  ): Promise<RetentionDto> {
    return this.objects.getRetentionJson(bucket, key);
  }

  @Put('retention')
  @HttpCode(204)
  @ApiOperation({ operationId: 'putObjectRetention' })
  async putObjectRetention(
    @Param('name') bucket: string,
    @Query('key') key: string,
    @Body() dto: RetentionDto,
    @Req() req: Request,
  ): Promise<void> {
    await this.objects.setRetention(bucket, key, dto.mode, dto.retainUntil);
    this.audit.emit({
      event: 'object.retention.changed',
      subject: (req as Request & { user: AdminPrincipal }).user.username,
      bucket,
      key,
      requestId: req.openbucket.requestId,
    });
  }

  @Get('legal-hold')
  @ApiOperation({ operationId: 'getObjectLegalHold' })
  @ApiOkResponse({ type: LegalHoldDto })
  async getObjectLegalHold(
    @Param('name') bucket: string,
    @Query('key') key: string,
  ): Promise<LegalHoldDto> {
    return this.objects.getLegalHoldStatus(bucket, key);
  }

  @Put('legal-hold')
  @HttpCode(204)
  @ApiOperation({ operationId: 'putObjectLegalHold' })
  async putObjectLegalHold(
    @Param('name') bucket: string,
    @Query('key') key: string,
    @Body() dto: LegalHoldDto,
    @Req() req: Request,
  ): Promise<void> {
    await this.objects.setLegalHold(bucket, key, dto.status === 'ON');
    this.audit.emit({
      event: 'object.legalhold.changed',
      subject: (req as Request & { user: AdminPrincipal }).user.username,
      bucket,
      key,
      requestId: req.openbucket.requestId,
    });
  }

  @Post('presign')
  @HttpCode(200)
  @ApiOperation({ operationId: 'presignObject' })
  @ApiOkResponse({ type: PresignedUrlDto })
  async presignObject(
    @Param('name') bucket: string,
    @Query('key') key: string,
    @Body() dto: PresignRequestDto,
    @Req() req: Request,
  ): Promise<PresignedUrlDto> {
    const expiresIn = Math.min(dto.expiresIn, MAX_EXPIRES);
    const now = new Date();
    const url = buildPresignedUrl({
      accessKeyId: this.config.rootAccessKeyId,
      secretAccessKey: this.config.rootSecretAccessKey,
      region: this.config.region,
      host: req.headers.host ?? 'localhost',
      scheme: req.protocol,
      method: 'GET',
      bucket,
      key,
      expiresIn,
      now,
    });
    this.audit.emit({
      event: 'object.presigned',
      subject: (req as Request & { user: AdminPrincipal }).user.username,
      bucket,
      key,
      expiresIn,
      requestId: req.openbucket.requestId,
    });
    return { url, expiresAt: new Date(now.getTime() + expiresIn * 1000).toISOString() };
  }

  @Get('*')
  @ApiOperation({ operationId: 'getObject' })
  @ApiParam({ name: 'path', description: 'Object key; may contain "/" and is percent-encoded once.' })
  @ApiOkResponse({ type: ObjectMetaDto })
  async get(
    @Param('name') bucket: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const key = this.decodeOnce(this.rawTail(req, bucket).replace(/\/(meta|content)$/, ''));

    // `?content` (inline, for image preview) / `?download` (attachment) → stream
    // the raw bytes. Otherwise return metadata JSON (the detail-panel default).
    if ('content' in req.query || 'download' in req.query) {
      if (!(await this.objects.head(bucket, key))) {
        throw new NotFoundException(`object ${key} not found`);
      }
      if ('download' in req.query) {
        const filename = key.split('/').pop() || 'download';
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
      } else {
        // Inline preview (`?content`): never let previewed object bytes land in a
        // shared/browser cache — matters for multi-operator installs. The
        // `?download` attachment path is left untouched.
        res.setHeader('Cache-Control', 'private, no-store');
      }
      // Reuse the S3 streamer: sets Content-Type, supports Range, releases the fd
      // on client disconnect. It writes `res` directly (library mode here). It also
      // applies `applySafeObjectResponseHeaders` (CSP `default-src 'none'; sandbox`,
      // nosniff, and HTML/SVG forced to attachment/octet-stream) — the preview
      // frontend relies on that neutralization.
      await this.objects.getObject(req, res, bucket, key);
      return;
    }

    const obj = await this.objects.head(bucket, key);
    if (!obj) throw new NotFoundException(`object ${key} not found`);
    const meta: ObjectMetaDto = {
      key: obj.key,
      bucket,
      size: obj.size,
      etag: obj.etag,
      contentType: obj.contentType,
      lastModified: obj.lastModified.toISOString(),
      userMetadata: obj.userMetadata,
      tagging: obj.tagging,
      versionId: obj.versionId,
      storageClass: obj.storageClass,
      location: obj.location,
    };
    res.json(meta);
  }

  @Put('*')
  @ApiOperation({ operationId: 'uploadObject' })
  @ApiParam({ name: 'path', description: 'Object key; may contain "/" and is percent-encoded once.' })
  async upload(
    @Param('name') bucket: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ key: string; etag: string }> {
    const key = this.decodeOnce(this.rawTail(req, bucket));
    const contentType =
      typeof req.headers['content-type'] === 'string' ? req.headers['content-type'] : undefined;
    // bodyParser is off globally (§1.2.3), so `req` is the raw object stream.
    const { etag, versionId } = await this.objects.putFromStream(
      bucket,
      key,
      req as unknown as Readable,
      contentType,
    );
    res.setHeader('ETag', `"${etag}"`);
    if (versionId) res.setHeader('x-amz-version-id', versionId);
    this.audit.emit({
      event: 'object.uploaded',
      subject: (req as Request & { user: AdminPrincipal }).user.username,
      bucket,
      key,
      requestId: req.openbucket.requestId,
    });
    return { key, etag };
  }

  @Delete('*')
  @HttpCode(204)
  @ApiOperation({ operationId: 'deleteObject' })
  @ApiParam({ name: 'path', description: 'Object key; may contain "/" and is percent-encoded once.' })
  async delete(@Param('name') bucket: string, @Req() req: Request): Promise<void> {
    const key = this.decodeOnce(this.rawTail(req, bucket));
    await this.objects.delete(bucket, key);
    this.audit.emit({
      event: 'object.deleted',
      subject: (req as Request & { user: AdminPrincipal }).user.username,
      bucket,
      key,
      requestId: req.openbucket.requestId,
    });
  }

  /** The raw (still-encoded) path tail after `…/objects/`. */
  private rawTail(req: Request, bucket: string): string {
    const prefix = `/api/admin/buckets/${bucket}/objects/`;
    const idx = req.path.indexOf(prefix);
    return idx === -1 ? '' : req.path.slice(idx + prefix.length);
  }

  /** Decode the URL-encoded key exactly once (§5.13). */
  private decodeOnce(raw: string): string {
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
}
