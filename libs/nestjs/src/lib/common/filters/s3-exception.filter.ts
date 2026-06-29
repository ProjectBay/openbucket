import { Catch, ExceptionFilter, ArgumentsHost, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';

import { S3Error } from '../../s3/errors/s3-error'; // owned by §3
// import { renderS3ErrorXml } from '../../s3/wire/render-error-xml'; // owned by §3

@Catch()
export class S3ExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(S3ExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    // Only handle S3-classified requests. Anything else falls through to the
    // admin filter or the catch-all.
    if (req.openbucket?.kind !== 's3') {
      throw exception;
    }

    const { status, code, message } = mapToS3Shape(exception);
    const bucket = req.openbucket.bucket ?? '';
    const key = req.openbucket.key ?? '';
    const requestId = req.openbucket.requestId;

    // The XML shape itself is owned by the S3 agent. The placeholder below is
    // the minimum a client will accept; replace with renderS3ErrorXml() once
    // §3 lands.
    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<Error>` +
      `<Code>${escapeXml(code)}</Code>` +
      `<Message>${escapeXml(message)}</Message>` +
      `<Resource>${escapeXml('/' + bucket + (key ? '/' + key : ''))}</Resource>` +
      `<RequestId>${escapeXml(requestId)}</RequestId>` +
      `</Error>\n`;

    if (status >= 500) {
      this.logger.error({ err: exception, requestId, code }, 'S3 5xx');
    }

    res.status(status);
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('x-amz-request-id', requestId);
    res.send(xml);
  }
}

function mapToS3Shape(exception: unknown): { status: number; code: string; message: string } {
  if (exception instanceof S3Error) {
    return { status: exception.httpStatus, code: exception.code, message: exception.message };
  }
  if (exception instanceof HttpException) {
    return {
      status: exception.getStatus(),
      code: 'InternalError',
      message: exception.message,
    };
  }
  return { status: 500, code: 'InternalError', message: 'We encountered an internal error.' };
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
