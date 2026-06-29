import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { OPEN_BUCKET_OPTIONS, type ResolvedOpenBucketOptions } from '../../open-bucket-options';
import { AppConfigService } from './app-config.service';
import { buildConfig } from './config-source';

/**
 * Provides `ConfigService` (the backing store) + the typed {@link AppConfigService}
 * wrapper, globally. `ConfigService` is built dual-mode (see {@link buildConfig}):
 * from `OPEN_BUCKET_OPTIONS` when a host wired `OpenBucketModule.forRoot(options)`,
 * else from `loadEnv(process.env)` (the standalone app). This replaces the old
 * `@nestjs/config` `ConfigModule.forRoot({ validate: loadEnv })`. See §1.6, §1.7.
 */
@Global()
@Module({
  providers: [
    {
      provide: ConfigService,
      useFactory: (opts?: ResolvedOpenBucketOptions) => new ConfigService(buildConfig(opts)),
      inject: [{ token: OPEN_BUCKET_OPTIONS, optional: true }],
    },
    AppConfigService,
  ],
  exports: [ConfigService, AppConfigService],
})
export class ConfigModule {}
