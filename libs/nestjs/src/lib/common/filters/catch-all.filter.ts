import { Catch, ExceptionFilter, ArgumentsHost, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';

/**
 * Last-resort filter, registered below both kind-specific filters so it only
 * fires for requests the classifier left in an undefined state (theoretically
 * unreachable — defence in depth). Logs and returns 500 with no body.
 * See WHITEPAPER §1.6.2.
 */
@Catch()
export class CatchAllExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(CatchAllExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    this.logger.error(
      { err: exception, requestId: req.openbucket?.requestId },
      'Unclassified request reached the catch-all filter.',
    );
    res.status(500).end();
  }
}
