import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { XMLBuilder } from 'fast-xml-parser';

import { InternalError, S3Error } from './s3-error';

/**
 * S3 XML exception filter — WHITEPAPER §2.7.
 *
 * Registered on the S3 controller tree via `@UseFilters` (EPIC-01 boilerplate).
 * Renders every thrown `S3Error` (and every normalised non-S3 exception) as the
 * canonical AWS `<Error>` XML envelope: `Code`, `Message`, any error-specific
 * `extra` fields, `Resource`, `RequestId`, and `HostId`.
 */
const builder = new XMLBuilder({
  attributeNamePrefix: '@_',
  ignoreAttributes: false,
  format: false,
  suppressEmptyNode: true,
  processEntities: true,
});

@Catch()
export class S3ExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(S3ExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    const err = this.normalise(exception);
    const requestId = req.openbucket?.requestId ?? 'unknown';
    const resource = this.resourceFor(req);

    if (err.httpStatus >= 500) {
      this.logger.error(
        {
          code: err.code,
          requestId,
          message: err.message,
          stack: (exception as Error)?.stack,
        },
        's3 internal error',
      );
    } else {
      this.logger.debug({ code: err.code, requestId, message: err.message }, 's3 client error');
    }

    const body = builder.build({
      '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8' },
      Error: {
        Code: err.code,
        Message: err.message,
        ...err.extra,
        Resource: resource,
        RequestId: requestId,
        HostId: requestId, // we have no separate host id
      },
    });

    if (res.headersSent) {
      // The handler began streaming before the error; we can only abort.
      res.destroy(err);
      return;
    }

    res.status(err.httpStatus);
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('x-amz-request-id', requestId);
    res.setHeader('Content-Length', Buffer.byteLength(body, 'utf8'));

    // HEAD must not write a body, even on error — AWS parity.
    if (req.method === 'HEAD') {
      res.end();
    } else {
      res.end(body);
    }
  }

  private normalise(exception: unknown): S3Error {
    if (exception instanceof S3Error) return exception;
    if (exception instanceof HttpException) {
      // Convert Nest 404/405/etc. into S3-shaped errors.
      const status = exception.getStatus();
      const wrapped = new InternalError();
      (wrapped as { httpStatus: number }).httpStatus = status;
      (wrapped as { code: string }).code =
        status === 405 ? 'MethodNotAllowed' : status === 404 ? 'NoSuchKey' : 'InternalError';
      (wrapped as { message: string }).message =
        (exception.getResponse() as { message?: string })?.message ?? exception.message;
      return wrapped as S3Error;
    }
    return new InternalError();
  }

  private resourceFor(req: Request): string {
    const ob = req.openbucket;
    if (!ob) return req.originalUrl;
    // `keyRaw` is only set by a §2.2-aware classifier; today's classifier
    // populates `key`, so fall back to it (matching the M0 global filter).
    const key = ob.keyRaw ?? ob.key;
    if (ob.bucket && key) return `/${ob.bucket}/${key}`;
    if (ob.bucket) return `/${ob.bucket}`;
    return '/';
  }
}
