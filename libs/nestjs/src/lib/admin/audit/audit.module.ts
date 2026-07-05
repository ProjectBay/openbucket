import { Global, Module } from '@nestjs/common';

import { AppConfigService } from '../../common/config/app-config.service';
import { AuditFlushRunner } from './audit-flush.runner';
import { AuditSink } from './audit-sink';

/**
 * Durable-audit wiring (STORY-1103, TASK-3331). `@Global` — like
 * `PersistenceModule` — so the single {@link AuditSink} buffer is shared by
 * every locally-provided `AuditService` instance (each `emit` dual-writes to
 * it) and by the {@link AuditFlushRunner}.
 *
 * The sink's DoS bound (`AUDIT_BUFFER_MAX`) is read from config here. The flush
 * runner is a `ScheduledTask`; it is collected into the tick scheduler by
 * `BackgroundModule`'s `SCHEDULED_TASKS` factory (the app-wide single source of
 * registered runners), so it is exported here for that factory to inject.
 */
@Global()
@Module({
  providers: [
    {
      provide: AuditSink,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => new AuditSink(config.auditBufferMax),
    },
    AuditFlushRunner,
  ],
  exports: [AuditSink, AuditFlushRunner],
})
export class AuditModule {}
