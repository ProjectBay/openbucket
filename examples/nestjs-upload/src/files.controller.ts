import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Res,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { OpenBucketService } from '@openbucket/nestjs';
import {
  OpenBucketFileInterceptor,
  UploadedToBucket,
  UploadValidationExceptionFilter,
  type UploadedFileInfo,
} from '@openbucket/nestjs/multer';

const BUCKET = 'uploads';

@Controller('files')
@UseFilters(UploadValidationExceptionFilter) // a rejected upload → clean HTTP 400
export class FilesController {
  constructor(private readonly ob: OpenBucketService) {}

  /**
   * POST /files — multipart field "file". `OpenBucketFileInterceptor` streams the
   * part straight into the store (no temp file, no `file.buffer`), sniffs the real
   * content type, caps the size, and derives a safe key. `@UploadedToBucket()`
   * hands us the committed object.
   */
  @Post()
  @UseInterceptors(
    OpenBucketFileInterceptor('file', {
      bucket: BUCKET,
      // 'uuid-flat' → `${uuid}${ext}`: a collision-free, single-segment key, so
      // the read route below is a plain `:key` (no slash to escape). Use 'uuid'
      // for date-partitioned `${year}/${uuid}${ext}` keys.
      key: 'uuid-flat',
      validate: {
        maxBytes: 10 * 1024 * 1024, // 10 MiB
        allowedContentTypes: ['image/*'], // matched against the SNIFFED type
      },
    }),
  )
  upload(@UploadedToBucket() file: UploadedFileInfo) {
    // Persist the STABLE identity (bucket + key) in your DB — never a signed URL.
    return {
      key: file.key,
      contentType: file.contentType,
      size: file.size,
      // Read it back at:  GET /files/<key>
      readPath: `/files/${file.key}`,
    };
  }

  /**
   * GET /files/<key> — stream the bytes back.
   *
   * Alternative: mint a short-lived redirect instead of proxying bytes —
   *   const url = this.ob.presignGetUrl(BUCKET, key, {
   *     baseUrl: 'http://localhost:3000', expiresIn: 3600,
   *   });
   *   res.redirect(url);
   */
  @Get(':key')
  async download(@Param('key') key: string, @Res() res: Response): Promise<void> {
    const info = await this.ob.headObject(BUCKET, key);
    if (!info) throw new NotFoundException(`No object at ${key}`);

    const body = await this.ob.getObjectBuffer(BUCKET, key);
    res.setHeader('Content-Type', info.contentType);
    res.setHeader('Content-Length', String(info.size));
    res.send(body);
  }
}
