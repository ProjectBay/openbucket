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

import { CompletePart, MultipartService } from '../../domain/multipart/multipart.service';
import { ObjectService } from '../../domain/objects/object.service';
import { PolicyAuthorizationGuard } from '../authz/policy-authorization.guard';
import { NotImplementedError } from '../errors/s3-error';
import { S3ExceptionFilter } from '../errors/s3-exception.filter';
import { PutObjectInterceptor } from '../object/put-object.interceptor';
import { RouteResolver } from '../routing/route-resolver';
import { S3Throttled } from '../s3-throttle';
import { SigV4Guard } from '../sigv4/sigv4.guard';
import { XmlInterceptor } from '../xml/xml.interceptor';

/**
 * Object-scope controller (§2.1.1). One method per HTTP verb dispatches on
 * query params + the `x-amz-copy-source` header to the right service method.
 *
 * SCAFFOLD (STORY-0100): wires the dispatch logic. All targeted service
 * methods are stubs that throw `NotImplementedError` until their respective
 * stories land (PutObject → STORY-0302, GetObject → STORY-0303, multipart
 * → STORY-0110 / STORY-0305…0308, tagging/acl/lock → STORY-0111/0115, etc.).
 *
 * The `:bucket` prefix + `*` wildcard captures multi-segment keys; the
 * RouteResolver returns `(bucket, key)` from `req.openbucket` (set by the
 * classifier middleware). The route parameter names are decorative — bucket
 * + key come from the classifier, not from Nest's path parser.
 */
@Controller(':bucket')
@S3Throttled()
@UseGuards(SigV4Guard, PolicyAuthorizationGuard)
@UseFilters(S3ExceptionFilter)
@UseInterceptors(XmlInterceptor)
export class ObjectController {
  constructor(
    private readonly objects: ObjectService,
    private readonly multipart: MultipartService,
    private readonly routes: RouteResolver,
  ) {}

  // --- PUT family --------------------------------------------------------
  // Dispatches PutObject, UploadPart, CopyObject, UploadPartCopy,
  // PutObjectTagging, PutObjectAcl, PutObjectRetention, PutObjectLegalHold.
  @Put('*')
  @UseInterceptors(PutObjectInterceptor)
  put(@Req() req: Request, @Res({ passthrough: true }) res: Response): unknown {
    const { bucket, key } = this.routes.resolve(req);
    const q = req.query as Record<string, string | undefined>;

    if (q.uploadId !== undefined && q.partNumber !== undefined) {
      if (req.headers['x-amz-copy-source'] !== undefined) {
        return this.multipart.uploadPartCopy(req, res, bucket, key, q);
      }
      return this.multipart.uploadPart(req, res, bucket, key, q);
    }
    if ('tagging' in q) return this.objects.putTagging(req, bucket, key);
    if ('acl' in q) return this.objects.putAcl(req, bucket, key);
    if ('retention' in q) return this.objects.putRetention(req, bucket, key);
    if ('legal-hold' in q) return this.objects.putLegalHold(req, bucket, key);
    if (req.headers['x-amz-copy-source']) {
      return this.objects.copyObject(req, res, bucket, key);
    }
    return this.objects.putObject(req, res, bucket, key);
  }

  // --- GET family --------------------------------------------------------
  // GetObject streams the body directly to `res`, so this handler uses
  // library-specific mode (`@Res()` without passthrough): Nest must NOT
  // finalize the response, or it ends it with 0 body bytes against the
  // Content-Length we set. The sub-resource GET ops (tagging/acl/…) are stubs
  // today; when they return XML POJOs (STORY-0111+) they must write `res`
  // themselves under this mode.
  @Get('*')
  get(@Req() req: Request, @Res() res: Response): unknown {
    const { bucket, key } = this.routes.resolve(req);
    const q = req.query as Record<string, string | undefined>;

    if ('tagging' in q) return this.objects.getTagging(req, res, bucket, key);
    if ('acl' in q) return this.objects.getAcl(req, res, bucket, key);
    if ('retention' in q) return this.objects.getRetention(req, res, bucket, key);
    if ('legal-hold' in q) return this.objects.getLegalHold(req, res, bucket, key);
    if ('attributes' in q) return this.objects.getObjectAttributes(req, res, bucket, key);
    if ('torrent' in q) throw new NotImplementedError('GetObjectTorrent');
    if (q.uploadId !== undefined) {
      return this.multipart.listParts(req, res, bucket, key, q.uploadId);
    }
    return this.objects.getObject(req, res, bucket, key);
  }

  @Head('*')
  head(@Req() req: Request, @Res({ passthrough: true }) res: Response): unknown {
    const { bucket, key } = this.routes.resolve(req);
    return this.objects.headObject(req, res, bucket, key);
  }

  // --- POST family (multipart init/complete + browser-form PostObject) ---
  @Post('*')
  async post(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<unknown> {
    const { bucket, key } = this.routes.resolve(req);
    const q = req.query as Record<string, string | undefined>;

    if ('uploads' in q) return this.multipart.createUpload(req, res, bucket, key);
    if (q.uploadId !== undefined) {
      const parts = this.readCompleteBody(req);
      return this.multipart.completeUpload(req, res, bucket, key, q.uploadId, parts);
    }
    if ('restore' in q) return this.objects.restoreObject(req, res, bucket, key);
    if ('select' in q) throw new NotImplementedError('SelectObjectContent');
    return this.objects.postObject(req, res, bucket, key); // browser form upload
  }

  /**
   * Map the parsed `<CompleteMultipartUpload>` body into the service's
   * CompletePart shape. The body is parsed upstream by XmlInterceptor and
   * attached as `req.xmlBody` (CompleteMultipartUpload ∈ XML_REQUEST_OPS, gated
   * by the operation the global OperationDispatcherInterceptor now resolves).
   * `Part` is always an array (XmlParser `isArray` hint); an empty body yields
   * an undefined `xmlBody` → no parts, and completeUpload rejects it.
   */
  private readCompleteBody(req: Request): CompletePart[] {
    const body = (
      req as unknown as {
        xmlBody?: {
          CompleteMultipartUpload?: { Part?: Array<{ PartNumber?: unknown; ETag?: unknown }> };
        };
      }
    ).xmlBody;
    const parts = body?.CompleteMultipartUpload?.Part ?? [];
    return parts.map((p) => ({ partNumber: Number(p.PartNumber), etag: String(p.ETag ?? '') }));
  }

  // --- DELETE ------------------------------------------------------------
  @Delete('*')
  delete(@Req() req: Request, @Res({ passthrough: true }) res: Response): unknown {
    const { bucket, key } = this.routes.resolve(req);
    const q = req.query as Record<string, string | undefined>;
    if (q.uploadId !== undefined) {
      return this.multipart.abortUpload(req, res, bucket, key, q.uploadId);
    }
    if ('tagging' in q) return this.objects.deleteTagging(req, res, bucket, key);
    return this.objects.deleteObject(req, res, bucket, key);
  }
}
