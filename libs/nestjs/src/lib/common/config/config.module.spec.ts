import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { OPEN_BUCKET_OPTIONS, resolveOptions } from '../../open-bucket-options';
import { AppConfigService } from './app-config.service';
import { ConfigModule } from './config.module';

/**
 * Phase 1 proof: when a host wires `OpenBucketModule.forRoot(options)`, the
 * OPEN_BUCKET_OPTIONS token feeds the dual-mode ConfigService → AppConfigService
 * reads the option values — WITHOUT any OpenBucket env vars set.
 */
describe('ConfigModule (library / options path)', () => {
  it('AppConfigService reads from OPEN_BUCKET_OPTIONS, not env', async () => {
    // Make sure no env leaks in for the asserted keys.
    delete process.env.DATA_DIR;
    delete process.env.OPENBUCKET_REGION;

    // Mirror the real forRoot flow: OPEN_BUCKET_OPTIONS is provided GLOBALLY so the
    // descendant ConfigModule factory can inject it.
    const optionsProvider = {
      provide: OPEN_BUCKET_OPTIONS,
      useValue: resolveOptions({
        dataDir: '/srv/store',
        region: 'ap-south-1',
        rootCredentials: { accessKeyId: 'AKIAEXAMPLE', secretAccessKey: 'sk' },
        admin: { username: 'root', passwordHash: '$argon2id$x', jwtSecret: 'jwt' },
        limits: { maxObjectSizeMb: 512 },
      }),
    };
    @Global()
    @Module({ providers: [optionsProvider], exports: [OPEN_BUCKET_OPTIONS] })
    class TestOptionsModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [TestOptionsModule, ConfigModule],
    }).compile();

    const cfg = moduleRef.get(AppConfigService);
    expect(cfg.dataDir).toBe('/srv/store');
    expect(cfg.region).toBe('ap-south-1');
    expect(cfg.rootAccessKeyId).toBe('AKIAEXAMPLE');
    expect(cfg.adminUsername).toBe('root');
    expect(cfg.jwtSecret).toBe('jwt');
    expect(cfg.maxObjectSizeMb).toBe(512);
    expect(cfg.multipartTtlHours).toBe(24); // default applied
    await moduleRef.close();
  });
});
