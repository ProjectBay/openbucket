import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import { Observable, tap } from 'rxjs';

import { isS3ThrottledRoute } from '../../s3/s3-throttle';
import { RequestMetricsService, Surface } from '../metrics/request-metrics.service';

/**
 * Global interceptor (STORY-1102, TASK-3321) that tallies request + error counts
 * per surface into {@link RequestMetricsService}. Modelled on
 * `ShutdownTrackerInterceptor` — it only OBSERVES the response, so its ordering
 * relative to other global interceptors is irrelevant.
 *
 * The surface is decided by the existing S3 signal (`isS3ThrottledRoute`) rather
 * than re-parsing paths: an `@S3Throttled` controller → `'s3'`, everything else
 * (including admin health/readiness probes) → `'admin'`. Nothing about the URL,
 * key, or signature is retained — counts only (EPIC-08 STORY-0705 intact).
 */
@Injectable()
export class RequestMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: RequestMetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const surface: Surface = isS3ThrottledRoute(context) ? 's3' : 'admin';
    const res = context.switchToHttp().getResponse<Response>();
    return next.handle().pipe(
      tap({
        next: () => this.metrics.record(surface, res.statusCode),
        error: (err: unknown) => this.metrics.record(surface, statusFromError(err)),
      }),
    );
  }
}

/** Resolve the HTTP status a thrown error will render as (non-HTTP ⇒ 500). */
function statusFromError(err: unknown): number {
  return err instanceof HttpException ? err.getStatus() : 500;
}
