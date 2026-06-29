import { Controller, Get, Req, Res, UseFilters, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Request, Response } from 'express';

import { BucketService } from '../../domain/buckets/bucket.service';
import { S3ExceptionFilter } from '../errors/s3-exception.filter';
import { S3Operation } from '../routing/operation.decorator';
import { SigV4Guard } from '../sigv4/sigv4.guard';
import { XmlInterceptor } from '../xml/xml.interceptor';

/**
 * Service-scope controller (GET / → ListBuckets, per §2.1 layout).
 *
 * `GET /` is the only service-scope verb; everything else is handled by the
 * bucket/object controllers. The handler returns a POJO that the
 * `XmlInterceptor` envelopes as `<ListAllMyBucketsResult>` (STORY-0107).
 */
@Controller()
@UseGuards(SigV4Guard)
@UseFilters(S3ExceptionFilter)
@UseInterceptors(XmlInterceptor)
export class ServiceController {
  constructor(private readonly buckets: BucketService) {}

  @Get()
  @S3Operation('ListBuckets')
  listBuckets(@Req() req: Request, @Res({ passthrough: true }) res: Response): unknown {
    return this.buckets.listBuckets(req, res);
  }
}
