import { Module, Global } from '@nestjs/common';
import { APP_FILTER, APP_PIPE, APP_INTERCEPTOR } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';

import { ConfigModule as AppConfigInternalModule } from './config/config.module';
import { GlobalExceptionFilter } from './filters/global-exception.filter';
import { ShutdownTrackerInterceptor } from './interceptors/shutdown-tracker.interceptor';
import { RequestMetricsInterceptor } from './interceptors/request-metrics.interceptor';
import { RequestMetricsService } from './metrics/request-metrics.service';
import { ShutdownState } from './shutdown-state.service';
import { RequestIdMiddleware } from './middleware/request-id.middleware';
import { RequestClassifierMiddleware } from './middleware/request-classifier.middleware';

@Global()
@Module({
  imports: [AppConfigInternalModule],
  providers: [
    RequestIdMiddleware,
    RequestClassifierMiddleware,
    ShutdownState,
    ShutdownTrackerInterceptor,
    // Usage analytics (STORY-1102): app-singleton request/error counters, drained
    // per rollup tick by the BackgroundModule. Exported so BackgroundModule injects it.
    RequestMetricsService,

    // Pipes
    { provide: APP_PIPE, useClass: ZodValidationPipe },

    // Single global exception filter (§1.6.2): NestJS runs only one matching
    // global filter, so it dispatches by request kind internally rather than
    // relying on multiple filters "chaining" via rethrow (which they don't).
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },

    // Interceptors
    { provide: APP_INTERCEPTOR, useClass: ShutdownTrackerInterceptor },
    { provide: APP_INTERCEPTOR, useClass: RequestMetricsInterceptor },
  ],
  exports: [
    AppConfigInternalModule,
    RequestIdMiddleware,
    RequestClassifierMiddleware,
    ShutdownState,
    RequestMetricsService,
  ],
})
export class CommonModule {}
