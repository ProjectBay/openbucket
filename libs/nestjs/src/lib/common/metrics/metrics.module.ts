import { Global, Module } from '@nestjs/common';

import { MetricsController } from './metrics.controller';
import { MetricsAuthGuard } from './metrics-auth.guard';
import { METRICS_REGISTRY, PROM_METRICS, buildPromMetrics, type PromMetrics } from './metrics.registry';

/**
 * `@Global` metrics module (STORY-1202). Owns the single shared `prom-client`
 * `Registry` and every OpenBucket metric family, constructed exactly ONCE by the
 * `PROM_METRICS` value-factory. Being `@Global` + single-factory guarantees
 * `collectDefaultMetrics` runs once and the interceptor (TASK-3621), rollup
 * runner (TASK-3622) and `/metrics` controller (TASK-3623) all inject the SAME
 * instances.
 *
 * `METRICS_REGISTRY` is exported as a convenience alias (`PROM_METRICS.registry`)
 * for host apps that want to scrape the registry directly.
 *
 * The `/metrics` scrape endpoint itself is served by {@link MetricsController},
 * guarded by {@link MetricsAuthGuard} (mode `off`|`public`|`token`). The
 * controller is always registered; when the configured mode is `off` the guard
 * denies with a 404 so no registry body is ever leaked and the route is
 * indistinguishable from an unmapped one (TASK-3623).
 */
@Global()
@Module({
  controllers: [MetricsController],
  providers: [
    {
      provide: PROM_METRICS,
      useFactory: buildPromMetrics,
    },
    {
      provide: METRICS_REGISTRY,
      useFactory: (m: PromMetrics) => m.registry,
      inject: [PROM_METRICS],
    },
    MetricsAuthGuard,
  ],
  exports: [PROM_METRICS, METRICS_REGISTRY],
})
export class MetricsModule {}
