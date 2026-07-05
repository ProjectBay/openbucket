import { type ArgumentsHost, Catch, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';

import { UploadValidationError } from '../../open-bucket-upload';

/** The stable JSON body this filter renders for a rejected upload. */
export interface UploadValidationErrorBody {
  statusCode: number;
  error: 'Bad Request';
  /** Stable union: `too_large` | `active_content` | `type_not_allowed` | `no_content_type` | `invalid_key`. */
  code: UploadValidationError['code'];
  message: string;
}

/**
 * Maps an {@link UploadValidationError} thrown out of the storage engine
 * (`openBucketStorage`) to an HTTP `400` with a stable `{ code, message }` body —
 * so a rejected upload (oversize, disallowed type, active content, unsafe key)
 * renders correct HTTP semantics instead of Nest's default opaque `500`.
 *
 * Register per-handler or globally (host's choice):
 * ```ts
 * @UseFilters(UploadValidationExceptionFilter)   // on the controller, or
 * app.useGlobalFilters(new UploadValidationExceptionFilter()); // globally
 * ```
 *
 * Scoped by `@Catch(UploadValidationError)`, so it never intercepts the host's
 * own errors or OpenBucket's S3 wire errors. In particular a `NoSuchBucketError`
 * from `uploadFrom` (absent bucket) falls THROUGH to the host's filters — ensure
 * the bucket exists, or map that error yourself.
 *
 * Redaction: `err.message` is composed only from validation facts (byte counts,
 * the normalized content type) and `err.code` is a fixed enum — neither carries a
 * credential, signature, or the object body. No request header is echoed.
 */
@Catch(UploadValidationError)
export class UploadValidationExceptionFilter implements ExceptionFilter {
  catch(err: UploadValidationError, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const body: UploadValidationErrorBody = {
      statusCode: err.statusHint,
      error: 'Bad Request',
      code: err.code,
      message: err.message,
    };
    res.status(err.statusHint).json(body);
  }
}
