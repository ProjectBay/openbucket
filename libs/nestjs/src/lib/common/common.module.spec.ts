import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';

import { CommonModule } from './common.module';
import { ConfigModule as AppConfigInternalModule } from './config/config.module';
import { GlobalExceptionFilter } from './filters/global-exception.filter';
import { ShutdownTrackerInterceptor } from './interceptors/shutdown-tracker.interceptor';
import { RequestMetricsInterceptor } from './interceptors/request-metrics.interceptor';
import { MetricsModule } from './metrics/metrics.module';
import { TracingModule } from './tracing/tracing.module';
import { RequestClassifierMiddleware } from './middleware/request-classifier.middleware';
import { RequestIdMiddleware } from './middleware/request-id.middleware';

/**
 * TEST-0009 — CommonModule provider registration.
 * Introspects the module's reflected metadata.
 */
type Provider = { provide?: unknown; useClass?: unknown };

function providers(): Provider[] {
  return (Reflect.getMetadata('providers', CommonModule) ?? []) as Provider[];
}
function byToken(token: unknown): unknown[] {
  return providers()
    .filter((p) => typeof p === 'object' && p.provide === token)
    .map((p) => p.useClass);
}

describe('CommonModule', () => {
  it('case 1: imports AppConfigInternalModule + the @Global Metrics/Tracing modules', () => {
    const imports = (Reflect.getMetadata('imports', CommonModule) ?? []) as unknown[];
    expect(imports).toContain(AppConfigInternalModule);
    // STORY-1202: the @Global metrics + tracing modules are imported so the
    // request-metrics interceptor can inject PROM_METRICS / TracingService.
    expect(imports).toContain(MetricsModule);
    expect(imports).toContain(TracingModule);
    expect(imports).toHaveLength(3);
  });

  it('case 2: APP_FILTER is the single GlobalExceptionFilter dispatcher', () => {
    expect(byToken(APP_FILTER)).toEqual([GlobalExceptionFilter]);
  });

  it('case 3: APP_PIPE is ZodValidationPipe', () => {
    expect(byToken(APP_PIPE)).toEqual([ZodValidationPipe]);
  });

  it('case 4: APP_INTERCEPTOR is the shutdown tracker + request-metrics interceptors', () => {
    expect(byToken(APP_INTERCEPTOR)).toEqual([
      ShutdownTrackerInterceptor,
      RequestMetricsInterceptor,
    ]);
  });

  it('case 5: re-exports config module and middlewares', () => {
    const exports = (Reflect.getMetadata('exports', CommonModule) ?? []) as unknown[];
    expect(exports).toContain(AppConfigInternalModule);
    expect(exports).toContain(RequestIdMiddleware);
    expect(exports).toContain(RequestClassifierMiddleware);
  });

  it('case 6: is decorated @Global()', () => {
    // @Global() sets a metadata marker on the class.
    const isGlobal = Reflect.getMetadata('__module:global__', CommonModule);
    expect(isGlobal).toBe(true);
  });
});
