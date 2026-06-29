import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Observable } from 'rxjs';

import { resolveS3Operation } from './operation-resolver';

/** Reflector key for the S3 operation name attached to a handler. */
export const S3_OPERATION_KEY = 's3:operation';

/**
 * `@S3Operation('PutObject')` annotates a single-op handler with its S3
 * operation name. The `OperationDispatcherInterceptor` (below) reads it.
 *
 * Most handlers aren't single-op — `ObjectController.put` etc. dispatch many
 * operations from one verb by query flag — so they carry no annotation; the
 * interceptor falls back to {@link resolveS3Operation} for those. See §2.8.
 */
export const S3Operation = (name: string): MethodDecorator =>
  SetMetadata(S3_OPERATION_KEY, name);

/**
 * Sets `req.openbucket.operation` for every S3 request. Bound globally
 * (`APP_INTERCEPTOR`) so it runs *before* the controller-scoped XmlInterceptor,
 * whose inbound XML-body parsing keys off the operation name. Prefers an
 * explicit `@S3Operation` annotation, else resolves from the request shape.
 * No-ops for non-S3 (admin/SPA) requests.
 */
@Injectable()
export class OperationDispatcherInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (req.openbucket?.kind === 's3') {
      const annotated = this.reflector.get<string | undefined>(
        S3_OPERATION_KEY,
        ctx.getHandler(),
      );
      const operation = annotated ?? resolveS3Operation(req);
      if (operation) {
        req.openbucket.operation = operation;
      }
    }
    return next.handle();
  }
}
