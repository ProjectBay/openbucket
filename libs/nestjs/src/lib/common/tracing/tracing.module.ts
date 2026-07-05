import { Global, Module } from '@nestjs/common';

import { TracingService } from './tracing.service';

/**
 * `@Global` tracing module (STORY-1202, TASK-3624). Provides the single
 * {@link TracingService} the request-metrics interceptor injects to optionally
 * wrap request handling in a span. Being `@Global` keeps it available app-wide
 * without every module re-importing it; on its own it schedules and emits
 * nothing (a hard no-op unless tracing is enabled AND `@opentelemetry/api` +
 * an SDK are present in the host).
 */
@Global()
@Module({
  providers: [TracingService],
  exports: [TracingService],
})
export class TracingModule {}
