import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Inject,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';

import { isS3ThrottledRoute } from '../../s3/s3-throttle';
import { RequestMetricsService, Surface } from '../metrics/request-metrics.service';
import { PROM_METRICS, type PromMetrics } from '../metrics/metrics.registry';
import { routeClass, statusClass } from '../metrics/route-class';
import { TracingService, type TraceSpan } from '../tracing/tracing.service';

/**
 * Global interceptor (STORY-1102 / STORY-1202) that instruments EVERY request
 * exactly once. It is the SINGLE `RequestMetricsInterceptor` binding (registered
 * in `common.module.ts`); a second `APP_INTERCEPTOR` is deliberately NOT added,
 * so nothing is double-counted. Modelled on `ShutdownTrackerInterceptor` — it
 * only OBSERVES the response, so its ordering vs other global interceptors is
 * irrelevant.
 *
 * On completion it:
 *   1. records the in-memory per-surface counters (unchanged EPIC-12 path),
 *   2. increments the `prom-client` HTTP request counter + observes the latency
 *      histogram with a BOUNDED label set (surface / method / route_class /
 *      status_class — never the URL, key, bucket, or IP; CWE-770),
 *   3. increments the S3-operation counter from the already-resolved
 *      `req.openbucket.operation` (only for the S3 surface, only when set),
 *   4. optionally wraps handling in an OpenTelemetry span (a hard no-op unless
 *      tracing is enabled + an OTel SDK is present).
 *
 * Nothing about the URL, key, or signature is retained — counts + coarse labels
 * only (EPIC-08 STORY-0705 intact). The `/metrics` self-scrape flows through
 * here too and is counted (surface `admin`, route_class `admin`) — expected and
 * harmless (bounded).
 */
@Injectable()
export class RequestMetricsInterceptor implements NestInterceptor {
  constructor(
    private readonly metrics: RequestMetricsService,
    @Inject(PROM_METRICS) private readonly prom: PromMetrics,
    private readonly tracing: TracingService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const surface: Surface = isS3ThrottledRoute(context) ? 's3' : 'admin';
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    // All labels/attributes below are drawn from bounded, non-sensitive
    // dimensions only (finite verbs, the classifier's s3Scope, the resolved op).
    const method = (req.method ?? 'GET').toUpperCase();
    const route_class = routeClass(surface, req.openbucket?.s3Scope);
    const operation = req.openbucket?.operation;
    const start = process.hrtime.bigint();

    const done = (status: number, span: TraceSpan): void => {
      // 1. Unchanged in-memory per-surface counters (STORY-1102).
      this.metrics.record(surface, status);
      // 2. Prometheus HTTP counter + latency histogram (bounded labels).
      const labels = { surface, method, route_class, status_class: statusClass(status) };
      this.prom.httpRequestsTotal.inc(labels);
      this.prom.httpRequestDurationSeconds.observe(
        labels,
        Number(process.hrtime.bigint() - start) / 1e9,
      );
      // 3. S3-operation counter — only for the S3 surface and only when the
      //    OperationDispatcherInterceptor resolved a known op. Never synthesise
      //    an `unknown` label (keeps the family to the finite S3 op names).
      if (surface === 's3' && operation) {
        this.prom.s3OperationsTotal.inc({ operation });
      }
      // 4. Close the tracing span (no-op unless tracing is active).
      span.setHttpStatus(status);
      span.end();
    };

    // Span name + attributes are bounded (surface + route_class); the span is a
    // hard no-op when tracing is disabled/absent, in which case `fn` runs
    // synchronously with a no-op span and the returned Observable is unchanged.
    return this.tracing.startActiveSpan(
      `${surface} ${route_class}`,
      { 'http.method': method, route_class, surface },
      (span) =>
        next.handle().pipe(
          tap({
            next: () => done(res.statusCode, span),
            error: (err: unknown) => done(statusFromError(err), span),
          }),
        ),
    );
  }
}

/** Resolve the HTTP status a thrown error will render as (non-HTTP ⇒ 500). */
function statusFromError(err: unknown): number {
  return err instanceof HttpException ? err.getStatus() : 500;
}
