import { BadRequestException, Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';

import { Public } from '../../common/auth/public.decorator';
import { TestClock } from '../../common/clock/clock';

/**
 * Test-only routes, registered by AppModule ONLY when OPENBUCKET_TEST_MODE=1.
 * Never present in a production container. See WHITEPAPER §4.11.
 *
 * - `/slow` + `/ping`: M0 STORY-0015 (shutdown drain e2e).
 * - `/advance-clock`: M1 STORY-0318 (fast-forward the TestClock so lifecycle
 *   conformance tests finish in ~60s instead of 24h).
 */
@Controller('api/admin/_test')
export class TestController {
  constructor(private readonly clock: TestClock) {}

  /** Holds the response open for `ms` (default 200, capped 60s) then returns. */
  @Public()
  @Get('slow')
  async slow(@Query('ms') ms?: string): Promise<{ slept: number }> {
    const duration = Math.min(Math.max(Number(ms) || 200, 0), 60_000);
    await new Promise((resolve) => setTimeout(resolve, duration));
    return { slept: duration };
  }

  @Public()
  @Get('ping')
  ping(): { pong: true } {
    return { pong: true };
  }

  /**
   * Fast-forward the injected TestClock by `ms` milliseconds. Forward-only —
   * negative deltas are a programmer error.
   */
  @Public()
  @Post('advance-clock')
  @HttpCode(200) // RPC-style: not a resource creation, so prefer 200 over Nest's POST-default 201.
  advanceClock(@Body() body: { ms: number }): { offsetMs: number } {
    if (typeof body?.ms !== 'number' || body.ms < 0 || !Number.isFinite(body.ms)) {
      throw new BadRequestException('ms must be a non-negative number');
    }
    this.clock.advance(body.ms);
    return { offsetMs: this.clock.nowMs() - Date.now() };
  }
}
