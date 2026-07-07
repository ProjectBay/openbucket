/**
 * `OpenBucketFileInterceptor(field, opts)` — the one-line upload interceptor.
 *
 * `openBucketStorage` needs the `OpenBucketService` instance, but inside a
 * class-property `@UseInterceptors(...)` decorator `this` is not available. This
 * is the DI-friendly fix: a `mixin` interceptor whose constructor receives
 * `OpenBucketService` from the Nest container, wires it into a `FileInterceptor`,
 * and delegates. Drop it straight into a handler:
 *
 *   @Post()
 *   @UseFilters(UploadValidationExceptionFilter)
 *   @UseInterceptors(
 *     OpenBucketFileInterceptor('file', {
 *       bucket: 'uploads',
 *       key: 'uuid',
 *       validate: { maxBytes: 10 * 1024 * 1024, allowedContentTypes: ['image/*'] },
 *     }),
 *   )
 *   upload(@UploadedToBucket() file: UploadedFileInfo) { … }
 *
 * `bucket` / `key` / `validate` may each be a static value or a
 * `(req, file) => …` function, so the destination is derivable per request.
 */

import {
  Injectable,
  mixin,
  type NestInterceptor,
  type Type,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { OpenBucketService } from '../../open-bucket.service';

import {
  openBucketStorage,
  type OpenBucketStorageOptions,
} from './open-bucket-storage';

/**
 * Build a request-scoped file interceptor that streams the named multipart part
 * straight into OpenBucket. Returns a `mixin` class so Nest injects
 * {@link OpenBucketService} for you — no `this.ob` wiring in your controller.
 */
export function OpenBucketFileInterceptor(
  field: string,
  opts: OpenBucketStorageOptions,
): Type<NestInterceptor> {
  @Injectable()
  class OpenBucketInterceptor implements NestInterceptor {
    private readonly delegate: NestInterceptor;

    constructor(ob: OpenBucketService) {
      const Base = FileInterceptor(field, {
        storage: openBucketStorage(ob, opts),
      });
      this.delegate = new Base();
    }

    intercept(
      ...args: Parameters<NestInterceptor['intercept']>
    ): ReturnType<NestInterceptor['intercept']> {
      return this.delegate.intercept(...args);
    }
  }

  return mixin(OpenBucketInterceptor);
}
