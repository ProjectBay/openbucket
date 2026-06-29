import { Global, Module } from '@nestjs/common';

import { Clock, SystemClock, TestClock } from './clock';

/**
 * Provides the `Clock` service. `SystemClock` in production; `TestClock` when
 * `OPENBUCKET_TEST_MODE=1`. Test mode additionally exposes `TestClock` itself
 * so the gated `POST /api/admin/_test/advance-clock` controller can inject
 * it. See WHITEPAPER §4.11 / STORY-0318.
 *
 * Global so consumers don't need to import ClockModule in every feature
 * module. Env read at module-load time (no DI on the bootstrap flag).
 */
const TEST_MODE = process.env.OPENBUCKET_TEST_MODE === '1';

@Global()
@Module({
  providers: [
    // In test mode `Clock` must alias the SAME TestClock the /_test/advance-clock
    // controller advances (useExisting, not useClass) — otherwise the two tokens
    // resolve to separate instances and a fast-forward never reaches the services
    // that read `Clock` (refresh-token expiry, lifecycle sweeps; §4.11).
    ...(TEST_MODE
      ? [TestClock, { provide: Clock, useExisting: TestClock }]
      : [{ provide: Clock, useClass: SystemClock }]),
  ],
  exports: [Clock, ...(TEST_MODE ? [TestClock] : [])],
})
export class ClockModule {}
