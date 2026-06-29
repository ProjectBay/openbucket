import { Module } from '@nestjs/common';

import { HealthController } from './health.controller';

/**
 * Liveness/readiness endpoints. Imported directly by AppModule in M0 (the
 * full AdminModule tree is owned by EPIC-05). ShutdownState is provided
 * globally by CommonModule. See WHITEPAPER §1.8.
 */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
