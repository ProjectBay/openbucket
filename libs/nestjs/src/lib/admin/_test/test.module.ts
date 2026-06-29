import { Module } from '@nestjs/common';

import { TestController } from './test.controller';

/**
 * Registered by AppModule only when OPENBUCKET_TEST_MODE=1. Holds the
 * test-only routes used by the e2e suite. Excluded from production boots.
 */
@Module({
  controllers: [TestController],
})
export class TestModule {}
