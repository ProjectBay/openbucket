import { Controller, Get, Inject, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';

import { Public } from '../auth/public.decorator';
import { PROM_METRICS, type PromMetrics } from './metrics.registry';
import { MetricsAuthGuard } from './metrics-auth.guard';

/**
 * Prometheus scrape endpoint at `<mountPath>/metrics` (STORY-1202, TASK-3623).
 * Serializes the shared registry as text exposition format. Mirrors the
 * `HealthController` public-probe pattern:
 *
 *  - `@Public()` exempts it from the global admin `JwtAuthGuard` — Prometheus
 *    cannot perform a JWT login. Authorization is delegated to
 *    {@link MetricsAuthGuard} (mode `off`|`public`|`token`).
 *  - The classifier tags bare `/metrics` as `admin`-kind so `SigV4Guard` skips
 *    it (a signed vs unsigned scrape behave identically), and the module is
 *    registered BEFORE `S3Module` so the greedy `:bucket` route can't shadow it.
 *
 * The scrape is subject to the `default` (admin, 100/min) throttler bucket — the
 * correct DoS bound — and its cost is O(series), which the bounded label
 * cardinality (TASK-3620/3621/3622) keeps cheap and non-amplifying.
 */
@Controller('metrics')
export class MetricsController {
  constructor(@Inject(PROM_METRICS) private readonly metrics: PromMetrics) {}

  @Public()
  @Get()
  @UseGuards(MetricsAuthGuard)
  async scrape(@Res() res: Response): Promise<void> {
    const registry = this.metrics.registry;
    res.type(registry.contentType); // text/plain; version=0.0.4; charset=utf-8
    res.send(await registry.metrics());
  }
}
