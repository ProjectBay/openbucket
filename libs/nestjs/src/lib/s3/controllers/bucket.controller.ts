import {
  Controller,
  Delete,
  Get,
  Head,
  Post,
  Put,
  Req,
  Res,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { BucketService, DeleteEntry } from '../../domain/buckets/bucket.service';
import { MultipartService } from '../../domain/multipart/multipart.service';
import { PolicyAuthorizationGuard } from '../authz/policy-authorization.guard';
import { S3ExceptionFilter } from '../errors/s3-exception.filter';
import { RouteResolver } from '../routing/route-resolver';
import { S3Throttled } from '../s3-throttle';
import { SigV4Guard } from '../sigv4/sigv4.guard';
import { XmlInterceptor } from '../xml/xml.interceptor';

/**
 * Bucket-scope controller. Dispatches on the bucket-scope query flags
 * (§2.1 / §2.8.2): `?versioning`, `?cors`, `?lifecycle`, `?tagging`,
 * `?policy`, `?encryption`, `?location`, `?versions`, `?uploads`, `?delete`,
 * plus the read-only stub flags. CreateBucket/DeleteBucket/HeadBucket and the
 * listing operations are live (STORY-0107/0108).
 */
@Controller(':bucket')
@S3Throttled()
@UseGuards(SigV4Guard, PolicyAuthorizationGuard)
@UseFilters(S3ExceptionFilter)
@UseInterceptors(XmlInterceptor)
export class BucketController {
  constructor(
    private readonly buckets: BucketService,
    private readonly multipart: MultipartService,
    private readonly routes: RouteResolver,
  ) {}

  @Get()
  get(@Req() req: Request, @Res({ passthrough: true }) res: Response): unknown {
    const { bucket } = this.routes.resolve(req);
    const q = req.query as Record<string, string | undefined>;
    if ('versioning' in q) return this.buckets.getVersioning(req, bucket);
    if ('cors' in q) return this.buckets.getCors(req, bucket);
    if ('lifecycle' in q) return this.buckets.getLifecycle(req, bucket);
    if ('object-lock' in q) return this.buckets.getObjectLockConfig(req, bucket);
    if ('acl' in q) return this.buckets.getBucketAcl(req, bucket);
    if ('tagging' in q) return this.buckets.getTagging(req, bucket);
    if ('policy' in q) return this.buckets.getPolicy(req, res, bucket);
    if ('encryption' in q) return this.buckets.getEncryption(req, bucket);
    if ('location' in q) return this.buckets.getLocation();
    if ('replication' in q) return this.buckets.getReplication();
    if ('notification' in q) return this.buckets.getNotification();
    if ('accelerate' in q) return this.buckets.getAccelerate();
    if ('logging' in q) return this.buckets.getLogging();
    if ('requestPayment' in q) return this.buckets.getRequestPayment();
    if ('website' in q) return this.buckets.getWebsite();
    if ('versions' in q) return this.buckets.listObjectVersions(req, bucket);
    if ('uploads' in q) return this.multipart.listMultipartUploads(req, bucket);
    if (q['list-type'] === '2') return this.buckets.listObjectsV2(req, res, bucket);
    return this.buckets.listObjectsV1(req, bucket);
  }

  @Put()
  put(@Req() req: Request, @Res({ passthrough: true }) res: Response): unknown {
    const { bucket } = this.routes.resolve(req);
    const q = req.query as Record<string, string | undefined>;
    if ('versioning' in q) return this.buckets.putVersioning(req, bucket);
    if ('cors' in q) return this.buckets.putCors(req, bucket);
    if ('lifecycle' in q) return this.buckets.putLifecycle(req, bucket);
    if ('object-lock' in q) return this.buckets.putObjectLockConfig(req, bucket);
    if ('acl' in q) return this.buckets.putBucketAcl(req, bucket);
    if ('tagging' in q) return this.buckets.putTagging(req, bucket);
    if ('policy' in q) return this.buckets.putPolicy(req, bucket);
    if ('encryption' in q) return this.buckets.putEncryption(req, bucket);
    if ('website' in q) return this.buckets.putWebsite();
    if ('notification' in q) return this.buckets.putNotification();
    return this.buckets.createBucket(req, res, bucket);
  }

  @Post()
  async post(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<unknown> {
    const { bucket } = this.routes.resolve(req);
    const q = req.query as Record<string, string | undefined>;
    if ('delete' in q) {
      const { entries, quiet } = this.readDeleteBody(req);
      return this.buckets.bulkDelete(res, bucket, entries, quiet);
    }
    return this.buckets.createBucket(req, res, bucket);
  }

  @Delete()
  delete(@Req() req: Request, @Res({ passthrough: true }) res: Response): unknown {
    const { bucket } = this.routes.resolve(req);
    const q = req.query as Record<string, string | undefined>;
    if ('cors' in q) return this.buckets.deleteCors(req, res, bucket);
    if ('lifecycle' in q) return this.buckets.deleteLifecycle(req, res, bucket);
    if ('tagging' in q) return this.buckets.deleteTagging(req, res, bucket);
    if ('policy' in q) return this.buckets.deletePolicy(req, res, bucket);
    if ('encryption' in q) return this.buckets.deleteEncryption(req, res, bucket);
    return this.buckets.deleteBucket(req, res, bucket);
  }

  @Head()
  head(@Req() req: Request, @Res({ passthrough: true }) res: Response): unknown {
    const { bucket } = this.routes.resolve(req);
    return this.buckets.headBucket(req, res, bucket);
  }

  /**
   * Map the parsed `<Delete>` body for bulk DeleteObjects into DeleteEntry[].
   * The body is parsed upstream by XmlInterceptor and attached as `req.xmlBody`
   * (DeleteObjects ∈ XML_REQUEST_OPS, gated by the operation the global
   * OperationDispatcherInterceptor now resolves). `Object` is always an array
   * (XmlParser `isArray` hint); an empty body yields an undefined `xmlBody`.
   */
  private readDeleteBody(req: Request): { entries: DeleteEntry[]; quiet: boolean } {
    const body = (
      req as unknown as {
        xmlBody?: {
          Delete?: { Object?: Array<{ Key?: unknown; VersionId?: unknown }>; Quiet?: unknown };
        };
      }
    ).xmlBody;
    const del = body?.Delete ?? {};
    const entries: DeleteEntry[] = (del.Object ?? []).map((o) => ({
      key: String(o.Key ?? ''),
      versionId: o.VersionId !== undefined ? String(o.VersionId) : undefined,
    }));
    return { entries, quiet: del.Quiet === true };
  }
}
