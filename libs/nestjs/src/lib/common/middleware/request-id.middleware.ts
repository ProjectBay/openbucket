import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { v7 as uuidv7 } from 'uuid';

import type { OpenBucketRequestContext } from '../types/request';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    // Honour upstream proxy's X-Request-Id if present (already validated UUIDv7-ish).
    const incoming = req.headers['x-request-id'];
    const requestId =
      typeof incoming === 'string' && /^[0-9a-f-]{36}$/i.test(incoming) ? incoming : uuidv7();

    const ctx: OpenBucketRequestContext = {
      requestId,
      kind: 's3', // overwritten by the classifier; this default never escapes
      receivedAt: 0, // set by the classifier
    };
    req.openbucket = ctx;

    res.setHeader('X-Request-Id', requestId);
    res.setHeader('X-Amz-Request-Id', requestId); // S3 SDKs surface this in error messages
    next();
  }
}
