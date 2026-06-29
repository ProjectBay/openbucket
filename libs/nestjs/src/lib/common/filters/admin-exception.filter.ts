import { Catch, ExceptionFilter, ArgumentsHost, HttpException, Logger } from '@nestjs/common';
import { ZodValidationException } from 'nestjs-zod';
import type { Request, Response } from 'express';
import type { ZodError } from 'zod';

import { S3Error } from '../../s3/errors/s3-error';

@Catch()
export class AdminExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AdminExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    if (req.openbucket?.kind !== 'admin') {
      throw exception;
    }

    const requestId = req.openbucket.requestId;

    if (exception instanceof ZodValidationException) {
      // nestjs-zod v5 types getZodError() as `unknown` (it spans Zod v3/v4);
      // we run Zod v4, whose error exposes `.issues`.
      const zodError = exception.getZodError() as ZodError;
      res.status(400).json({
        error: 'ValidationFailed',
        message: 'Request payload failed validation.',
        issues: zodError.issues,
        requestId,
      });
      return;
    }

    // Admin controllers reuse the S3 domain services, which throw S3Errors
    // (NoSuchBucket, BucketNotEmpty, …). Render them as admin JSON with their
    // own HTTP status rather than letting them fall through to a 500.
    if (exception instanceof S3Error) {
      res.status(exception.httpStatus).json({
        error: exception.code,
        message: exception.message,
        requestId,
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const payload = typeof body === 'string' ? { error: body } : (body as Record<string, unknown>);
      res.status(status).json({ ...payload, requestId });
      return;
    }

    this.logger.error({ err: exception, requestId }, 'Admin 5xx');
    res.status(500).json({
      error: 'InternalError',
      message: 'An unexpected error occurred.',
      requestId,
    });
  }
}
