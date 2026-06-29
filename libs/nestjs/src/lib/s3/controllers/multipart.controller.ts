import { Controller, UseFilters, UseGuards, UseInterceptors } from '@nestjs/common';

import { S3ExceptionFilter } from '../errors/s3-exception.filter';
import { SigV4Guard } from '../sigv4/sigv4.guard';
import { XmlInterceptor } from '../xml/xml.interceptor';

/**
 * Multipart-scope controller (§2.1 layout).
 *
 * SCAFFOLD (STORY-0100): empty controller registered so the topology test
 * confirms the four-controller layout. In practice the ObjectController
 * dispatcher already routes multipart sub-operations (UploadPart,
 * CompleteMultipartUpload, AbortMultipartUpload, ListParts) via its query
 * branches; this controller exists for future multipart-only endpoints
 * (e.g. `GET /?uploads` ListMultipartUploads at service scope) — STORY-0110.
 */
@Controller()
@UseGuards(SigV4Guard)
@UseFilters(S3ExceptionFilter)
@UseInterceptors(XmlInterceptor)
export class MultipartController {}
