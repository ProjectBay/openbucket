import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';

import { AppConfigService } from '../config/app-config.service';
import { OPENBUCKET_VERSION } from '../../version';

/**
 * Minimal STRUCTURAL view of the `@opentelemetry/api` surface we touch. Declared
 * locally (not imported from `@opentelemetry/api`) so the library type-checks and
 * bundles WITHOUT the package installed — it is an OPTIONAL peer, resolved
 * dynamically at runtime and a hard no-op when absent.
 */
interface OtelSpanLike {
  setAttribute(key: string, value: string | number | boolean): unknown;
  setStatus(status: { code: number }): unknown;
  end(): void;
}
interface OtelTracerLike {
  startActiveSpan<T>(
    name: string,
    options: { attributes?: Record<string, string | number> },
    fn: (span: OtelSpanLike) => T,
  ): T;
}
export interface OtelApiLike {
  trace: { getTracer(name: string, version?: string): OtelTracerLike };
  SpanStatusCode: { OK: number; ERROR: number };
}

/**
 * The span handle the interceptor drives. When tracing is a no-op (disabled, api
 * absent, or no SDK), a {@link NOOP_SPAN} is passed and every method is inert.
 */
export interface TraceSpan {
  /** Record the final HTTP status + set span status (ERROR for 5xx). */
  setHttpStatus(code: number): void;
  /** Close the span. Idempotent from the caller's perspective. */
  end(): void;
}

const NOOP_SPAN: TraceSpan = {
  setHttpStatus() {
    /* no-op */
  },
  end() {
    /* no-op */
  },
};

/**
 * Optional OpenTelemetry tracing seam (STORY-1202, TASK-3624). A genuine no-op
 * unless BOTH (a) tracing is enabled in config AND (b) `@opentelemetry/api` is
 * installed in the host process. The library NEVER hard-depends on any
 * `@opentelemetry/*` package: it resolves the api dynamically and falls back to
 * a no-op tracer when absent, so hosts that never opt in pay nothing and the
 * bundle builds/boots without OTel installed.
 *
 * Even when the api IS present, spans do nothing until an SDK calls
 * `trace.setGlobalTracerProvider(...)` — that is the api package's own default
 * no-op tracer, which satisfies the "no-op unless SDK present" requirement for
 * free. The config gate avoids even constructing spans when disabled.
 *
 * Span attributes are held to the SAME redaction posture as logs (STORY-0705):
 * only bounded, non-sensitive dimensions (method / route_class / surface) — never
 * the URL, object key, bucket, or any header/credential.
 */
@Injectable()
export class TracingService implements OnModuleInit {
  private readonly log = new Logger(TracingService.name);
  private api: OtelApiLike | null = null;
  private tracer: OtelTracerLike | null = null;

  constructor(private readonly config: AppConfigService) {}

  onModuleInit(): void {
    if (!this.config.tracingEnabled) return; // disabled → never touch the api
    const api = this.loadApi();
    if (!api) {
      // Enabled but the optional peer is absent: fail OPEN to availability
      // (tracing is non-critical telemetry). Exactly one boot warning, no throw.
      this.log.warn('tracing enabled but @opentelemetry/api not found — tracing disabled');
      return;
    }
    this.api = api;
    this.tracer = api.trace.getTracer('openbucket', OPENBUCKET_VERSION);
  }

  /** True only when tracing is enabled AND the api resolved. */
  get enabled(): boolean {
    return this.tracer !== null;
  }

  /**
   * Run `fn` inside an active span named `name` with the given bounded
   * `attributes`. When tracing is a no-op, `fn` is called SYNCHRONOUSLY with a
   * no-op span (zero allocation, no api require) so the hot path pays nothing.
   * The caller ends the span (on both the success and error completion paths).
   */
  startActiveSpan<T>(
    name: string,
    attributes: Record<string, string | number>,
    fn: (span: TraceSpan) => T,
  ): T {
    const tracer = this.tracer;
    const api = this.api;
    if (!tracer || !api) return fn(NOOP_SPAN);

    return tracer.startActiveSpan(name, { attributes }, (span) => {
      const handle: TraceSpan = {
        setHttpStatus: (code) => {
          span.setAttribute('http.status_code', code);
          span.setStatus({
            code: code >= 500 ? api.SpanStatusCode.ERROR : api.SpanStatusCode.OK,
          });
        },
        end: () => span.end(),
      };
      return fn(handle);
    });
  }

  /**
   * Resolve `@opentelemetry/api` at runtime WITHOUT a static import, so neither
   * `tsc` nor the app's webpack bundle needs the (optional, possibly-absent)
   * package. `eval('require')` is opaque to webpack's static analysis, so the
   * bundler never tries to resolve/externalize it. Returns `null` when the
   * package is not installed → tracing is a hard no-op. Overridable in tests.
   */
  protected loadApi(): OtelApiLike | null {
    try {
      // eslint-disable-next-line no-eval
      const dynamicRequire = eval('require') as NodeRequire;
      return dynamicRequire('@opentelemetry/api') as OtelApiLike;
    } catch {
      return null; // package not installed → hard no-op
    }
  }
}
