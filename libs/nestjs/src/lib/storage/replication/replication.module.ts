import { Global, Module } from '@nestjs/common';

import { AppConfigService } from '../../common/config/app-config.service';
import { REPLICATION_CONFIG, resolveReplicationConfig } from './replication-config';
import { ReplicationOutboxService } from './replication-outbox.service';
import { ReplicationTargetService } from './replication-target.service';

/**
 * Async replication to an external S3-compatible target (STORY-0900). `@Global`
 * so the storage layer (`ObjectWriterService`) and domain layer (`ObjectService`,
 * `VersionStoreService`) can inject the `@Optional()` `ReplicationOutboxService`
 * enqueue seam without an import cycle, and the background `ReplicationWorkerRunner`
 * can inject `ReplicationTargetService` — mirroring the `@Global` `EventsModule`.
 *
 * `REPLICATION_CONFIG` is resolved once from `AppConfigService` (both the env and
 * the `forRoot`-options sources funnel through it). When replication is unset the
 * config is `{ enabled: false }`, `ReplicationTargetService` never constructs an
 * `S3Client`, and every enqueue is a no-op — the feature costs nothing.
 */
@Global()
@Module({
  providers: [
    {
      provide: REPLICATION_CONFIG,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => resolveReplicationConfig(config),
    },
    ReplicationOutboxService,
    ReplicationTargetService,
  ],
  exports: [REPLICATION_CONFIG, ReplicationOutboxService, ReplicationTargetService],
})
export class ReplicationModule {}
