import { Logger } from '@nestjs/common';

import type { AppConfigService } from '../config/app-config.service';
import { OtelApiLike, TracingService } from './tracing.service';

/** A TracingService whose optional-api resolution is stubbed for the test. */
class TestTracingService extends TracingService {
  loadApiCalls = 0;
  constructor(
    config: AppConfigService,
    private readonly apiToReturn: OtelApiLike | null,
  ) {
    super(config);
  }
  protected loadApi(): OtelApiLike | null {
    this.loadApiCalls += 1;
    return this.apiToReturn;
  }
}

function configWith(enabled: boolean): AppConfigService {
  return { tracingEnabled: enabled } as unknown as AppConfigService;
}

/** A structural stub of the `@opentelemetry/api` surface + a recording tracer. */
function stubApi() {
  const spans: Array<{
    name: string;
    attributes: Record<string, string | number> | undefined;
    statuses: number[];
    attrs: Record<string, string | number | boolean>;
    ended: boolean;
  }> = [];
  const api: OtelApiLike = {
    SpanStatusCode: { OK: 1, ERROR: 2 },
    trace: {
      getTracer: () => ({
        startActiveSpan: <T>(
          name: string,
          options: { attributes?: Record<string, string | number> },
          fn: (span: {
            setAttribute(k: string, v: string | number | boolean): void;
            setStatus(s: { code: number }): void;
            end(): void;
          }) => T,
        ): T => {
          const rec = { name, attributes: options.attributes, statuses: [] as number[], attrs: {} as Record<string, string | number | boolean>, ended: false };
          spans.push(rec);
          return fn({
            setAttribute: (k, v) => {
              rec.attrs[k] = v;
            },
            setStatus: (s) => {
              rec.statuses.push(s.code);
            },
            end: () => {
              rec.ended = true;
            },
          });
        },
      }),
    },
  };
  return { api, spans };
}

/** TEST-1202 — TracingService no-op fallback + span emission through a stub. */
describe('TracingService (TEST-1202)', () => {
  it('disabled: never resolves the api and calls fn() directly with a no-op span', () => {
    const svc = new TestTracingService(configWith(false), null);
    svc.onModuleInit();
    expect(svc.loadApiCalls).toBe(0); // the api module is never required
    expect(svc.enabled).toBe(false);

    let ran = false;
    const result = svc.startActiveSpan('s3 s3-object', { surface: 's3' }, (span) => {
      // no-op span methods must be safe to call
      span.setHttpStatus(200);
      span.end();
      ran = true;
      return 42;
    });
    expect(ran).toBe(true);
    expect(result).toBe(42);
  });

  it('enabled but api absent: logs exactly one boot warning, does not throw, no-ops', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const svc = new TestTracingService(configWith(true), null);
      expect(() => svc.onModuleInit()).not.toThrow();
      expect(svc.loadApiCalls).toBe(1);
      expect(svc.enabled).toBe(false);
      expect(warn).toHaveBeenCalledTimes(1);

      const out = svc.startActiveSpan('admin admin', {}, () => 'ok');
      expect(out).toBe('ok');
    } finally {
      warn.mockRestore();
    }
  });

  it('enabled with a stub tracer: emits a span with bounded name + attributes, status + end', () => {
    const { api, spans } = stubApi();
    const svc = new TestTracingService(configWith(true), api);
    svc.onModuleInit();
    expect(svc.enabled).toBe(true);

    const ret = svc.startActiveSpan(
      's3 s3-object',
      { 'http.method': 'PUT', route_class: 's3-object', surface: 's3' },
      (span) => {
        span.setHttpStatus(503);
        span.end();
        return 'done';
      },
    );

    expect(ret).toBe('done');
    expect(spans).toHaveLength(1);
    const s = spans[0];
    expect(s.name).toBe('s3 s3-object');
    expect(s.attributes).toEqual({ 'http.method': 'PUT', route_class: 's3-object', surface: 's3' });
    // Only bounded attributes — no URL/key/secret.
    expect(Object.keys(s.attributes ?? {}).sort()).toEqual(['http.method', 'route_class', 'surface']);
    // 5xx → ERROR status, status_code attribute recorded, span ended.
    expect(s.attrs['http.status_code']).toBe(503);
    expect(s.statuses).toEqual([api.SpanStatusCode.ERROR]);
    expect(s.ended).toBe(true);
  });

  it('enabled with a stub tracer: 2xx maps to OK status', () => {
    const { api, spans } = stubApi();
    const svc = new TestTracingService(configWith(true), api);
    svc.onModuleInit();
    svc.startActiveSpan('admin admin', {}, (span) => {
      span.setHttpStatus(200);
      span.end();
    });
    expect(spans[0].statuses).toEqual([api.SpanStatusCode.OK]);
  });
});
