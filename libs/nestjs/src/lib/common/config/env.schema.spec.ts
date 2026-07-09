import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { AppConfigService } from './app-config.service';
import { loadEnv, normalizeMount } from './env.schema';

/**
 * TEST-0012 — env schema validation + refuse-to-boot semantics.
 */
const baseEnv = {
  DATA_DIR: '/data',
  // CSPRNG-style high-entropy fixtures (32 / 40 chars) that pass the strong-secret
  // guard (TASK-2151): not all-identical, not a placeholder, ≥8 distinct chars.
  JWT_SECRET: 'k7Jf2pQrwStN9vB3zX1cM4dL0eR6yU2h',
  ADMIN_PASSWORD_HASH: '$argon2id$v=19$m=65536,t=3,p=4$abc$def',
  ROOT_ACCESS_KEY_ID: 'AKIA1234567890ABCD',
  ROOT_SECRET_ACCESS_KEY: 'k7Jf2pQrwStN9vB3zX1cM4dL0eR6yU2h7gK3nP5s',
};

describe('loadEnv', () => {
  let errSpy: jest.SpyInstance;

  beforeEach(() => {
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    errSpy.mockRestore();
  });

  it('case 1: accepts baseEnv and applies documented defaults', () => {
    const env = loadEnv({ ...baseEnv });
    expect(env.PORT).toBe(9000);
    expect(env.OPENBUCKET_REGION).toBe('us-east-1');
    expect(env.SHUTDOWN_DRAIN_MS).toBe(30_000);
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('case 2: empty DATA_DIR refuses to boot and lists the key', () => {
    expect(() => loadEnv({ ...baseEnv, DATA_DIR: '' })).toThrow(
      'Refusing to boot: invalid environment.',
    );
    expect(errSpy.mock.calls[0][0]).toContain('  - DATA_DIR: ');
  });

  it('case 3: trailing-slash DATA_DIR is rejected with the documented message', () => {
    expect(() => loadEnv({ ...baseEnv, DATA_DIR: '/data/' })).toThrow();
    expect(errSpy.mock.calls[0][0]).toContain('DATA_DIR must not have a trailing slash');
  });

  it('case 4: short JWT_SECRET is rejected', () => {
    expect(() => loadEnv({ ...baseEnv, JWT_SECRET: 'short' })).toThrow();
    expect(errSpy.mock.calls[0][0]).toContain('JWT_SECRET must be at least 32 characters');
  });

  it('case 4a: all-identical 32-char JWT_SECRET is rejected (TASK-2151, CWE-521)', () => {
    expect(() => loadEnv({ ...baseEnv, JWT_SECRET: 'a'.repeat(32) })).toThrow(
      'Refusing to boot: invalid environment.',
    );
    expect(errSpy.mock.calls[0][0]).toContain('JWT_SECRET must not be a single repeated character');
  });

  it('case 4b: placeholder JWT_SECRET (padded ≥32) is rejected (TASK-2151)', () => {
    // Padded with a char already in the word → 7 distinct chars, below the floor.
    expect(() => loadEnv({ ...baseEnv, JWT_SECRET: 'changeme'.padEnd(32, 'e') })).toThrow();
    expect(errSpy.mock.calls[0][0]).toContain('JWT_SECRET has too few distinct characters');
  });

  it('case 4c: exact placeholder word is rejected by the denylist (TASK-2151)', () => {
    // A known placeholder value (case-insensitive) → denylist refine flags it.
    expect(() => loadEnv({ ...baseEnv, JWT_SECRET: 'PLEASE-CHANGE-ME' })).toThrow();
    expect(errSpy.mock.calls[0][0]).toContain('JWT_SECRET must not be a known placeholder value');
  });

  it('case 4d: too-few-distinct-character JWT_SECRET is rejected (TASK-2151)', () => {
    // 32 chars, only two distinct characters → below the 8-distinct entropy proxy.
    expect(() => loadEnv({ ...baseEnv, JWT_SECRET: 'ab'.repeat(16) })).toThrow();
    expect(errSpy.mock.calls[0][0]).toContain('JWT_SECRET has too few distinct characters');
  });

  it('case 4e: low-entropy ROOT_SECRET_ACCESS_KEY is rejected (TASK-2151)', () => {
    expect(() => loadEnv({ ...baseEnv, ROOT_SECRET_ACCESS_KEY: 'x'.repeat(40) })).toThrow();
    expect(errSpy.mock.calls[0][0]).toContain(
      'ROOT_SECRET_ACCESS_KEY must not be a single repeated character',
    );
  });

  it('case 4f: a high-entropy base64 secret boots cleanly (TASK-2151)', () => {
    // 44-char base64-style value (CSPRNG output shape).
    const env = loadEnv({
      ...baseEnv,
      JWT_SECRET: 'Zm9vYmFyMTIzNDU2Nzg5MEFCQ0RFRkdISUpLTE1OT1A',
    });
    expect(env.JWT_SECRET).toBe('Zm9vYmFyMTIzNDU2Nzg5MEFCQ0RFRkdISUpLTE1OT1A');
  });

  it('case 5: lowercase ROOT_ACCESS_KEY_ID is rejected', () => {
    expect(() => loadEnv({ ...baseEnv, ROOT_ACCESS_KEY_ID: 'lowercasekey1234' })).toThrow();
  });

  it('case 6: non-argon2id ADMIN_PASSWORD_HASH is rejected', () => {
    expect(() =>
      loadEnv({ ...baseEnv, ADMIN_PASSWORD_HASH: '$argon2i$v=19$m=65536$abc$def' }),
    ).toThrow();
  });

  it('case 6a: ADMIN_PASSWORD is accepted in place of ADMIN_PASSWORD_HASH', () => {
    const { ADMIN_PASSWORD_HASH: _omit, ...noHash } = baseEnv;
    const env = loadEnv({ ...noHash, ADMIN_PASSWORD: 'a-strong-admin-password' });
    expect(env.ADMIN_PASSWORD).toBe('a-strong-admin-password');
    expect(env.ADMIN_PASSWORD_HASH).toBeUndefined();
  });

  it('case 6b: neither ADMIN_PASSWORD_HASH nor ADMIN_PASSWORD refuses to boot', () => {
    const { ADMIN_PASSWORD_HASH: _omit, ...noHash } = baseEnv;
    expect(() => loadEnv({ ...noHash })).toThrow();
  });

  it('case 6c: a too-short ADMIN_PASSWORD is rejected', () => {
    const { ADMIN_PASSWORD_HASH: _omit, ...noHash } = baseEnv;
    expect(() => loadEnv({ ...noHash, ADMIN_PASSWORD: 'short' })).toThrow();
  });

  it('case 7: malformed OPENBUCKET_ENDPOINT is rejected', () => {
    expect(() => loadEnv({ ...baseEnv, OPENBUCKET_ENDPOINT: 'INVALID_DOMAIN' })).toThrow();
  });

  it('case 8: unknown env keys are stripped, not rejected', () => {
    // §1.7 correction: validate() runs against the full process.env, so the
    // schema cannot be strict. Unknown keys are stripped silently.
    const env = loadEnv({ ...baseEnv, EXTRA_KEY: 'unused' }) as Record<string, unknown>;
    expect(env.EXTRA_KEY).toBeUndefined();
    expect(env.DATA_DIR).toBe('/data');
  });

  it('case 9: numeric strings are coerced', () => {
    const env = loadEnv({ ...baseEnv, SHUTDOWN_DRAIN_MS: '5000' });
    expect(env.SHUTDOWN_DRAIN_MS).toBe(5000);
  });

  it('case 11: MAX_OBJECT_SIZE_MB defaults to 5 GiB, not 5 TiB (TASK-2140)', () => {
    const env = loadEnv({ ...baseEnv });
    expect(env.MAX_OBJECT_SIZE_MB).toBe(5_120); // 5 GiB
  });

  it('case 12: the new hardening limits apply their documented defaults (TASK-2140/2141/2143/2144)', () => {
    const env = loadEnv({ ...baseEnv });
    expect(env.DATA_DIR_MIN_FREE_BYTES).toBe(100 * 1024 * 1024);
    expect(env.STORAGE_QUOTA_BYTES).toBe(0);
    expect(env.STORAGE_QUOTA_OBJECTS).toBe(0);
    expect(env.MAX_CONCURRENT_MULTIPART_UPLOADS).toBe(1_000);
    expect(env.S3_THROTTLE_LIMIT).toBe(1_000);
    expect(env.S3_THROTTLE_TTL_MS).toBe(60_000);
    expect(env.RESTORE_MAX_MANIFEST_BYTES).toBe(4 * 1024 * 1024);
    expect(env.RESTORE_MAX_ENTRIES).toBe(1_000_000);
  });

  it('case 13: image-transform knobs apply their documented defaults (TASK-2403)', () => {
    const env = loadEnv({ ...baseEnv });
    expect(env.IMAGE_TRANSFORM_ENABLED).toBe(true);
    expect(env.MAX_TRANSFORM_DIMENSION).toBe(4_096);
    expect(env.MAX_TRANSFORM_INPUT_BYTES).toBe(50 * 1024 * 1024);
    expect(env.IMAGE_TRANSFORM_LIMIT_INPUT_PIXELS).toBe(24_000 * 24_000);
    expect(env.IMAGE_TRANSFORM_CONCURRENCY).toBe(4);
    expect(env.DERIVATIVE_CACHE_MAX_BYTES).toBe(5 * 1024 * 1024 * 1024);
  });

  it('case 14: MAX_TRANSFORM_DIMENSION out of range is rejected at boot (TASK-2403)', () => {
    expect(() => loadEnv({ ...baseEnv, MAX_TRANSFORM_DIMENSION: '0' })).toThrow(
      'Refusing to boot: invalid environment.',
    );
    expect(() => loadEnv({ ...baseEnv, MAX_TRANSFORM_DIMENSION: '999999' })).toThrow(
      'Refusing to boot: invalid environment.',
    );
  });

  it('case 15: IMAGE_TRANSFORM_ENABLED=false coerces to boolean false (TASK-2403)', () => {
    // z.coerce.boolean() would wrongly yield `true` for the string "false"; the
    // custom envBoolean coercion makes the kill-switch actually disable-able.
    expect(loadEnv({ ...baseEnv, IMAGE_TRANSFORM_ENABLED: 'false' }).IMAGE_TRANSFORM_ENABLED).toBe(
      false,
    );
    expect(loadEnv({ ...baseEnv, IMAGE_TRANSFORM_ENABLED: '0' }).IMAGE_TRANSFORM_ENABLED).toBe(
      false,
    );
    expect(loadEnv({ ...baseEnv, IMAGE_TRANSFORM_ENABLED: 'true' }).IMAGE_TRANSFORM_ENABLED).toBe(
      true,
    );
  });

  it('case 16: DERIVATIVE_CACHE_MAX_BYTES=0 is accepted (unbounded opt-in) (TASK-2403)', () => {
    expect(loadEnv({ ...baseEnv, DERIVATIVE_CACHE_MAX_BYTES: '0' }).DERIVATIVE_CACHE_MAX_BYTES).toBe(
      0,
    );
  });

  // --- object-event webhooks (STORY-0801) ---
  it('case 17: webhooks off by default (no WEBHOOK_URL) with documented delivery defaults', () => {
    const env = loadEnv({ ...baseEnv });
    expect(env.WEBHOOK_URL).toBeUndefined();
    expect(env.WEBHOOK_MAX_ATTEMPTS).toBe(8);
    expect(env.WEBHOOK_TIMEOUT_MS).toBe(5_000);
    expect(env.WEBHOOK_POLL_MS).toBe(15_000);
    expect(env.WEBHOOK_EVENTS).toBe('object.created,object.deleted,multipart.completed');
  });

  it('case 18: WEBHOOK_URL with a strong secret boots and enables webhooks', () => {
    const env = loadEnv({
      ...baseEnv,
      WEBHOOK_URL: 'https://hooks.example.com/ob',
      WEBHOOK_SECRET: 'k7Jf2pQrwStN9vB3zX1cM4dL0eR6yU2h',
    });
    expect(env.WEBHOOK_URL).toBe('https://hooks.example.com/ob');
  });

  it('case 19: WEBHOOK_URL set with a missing/weak secret refuses to boot (fail-closed)', () => {
    expect(() =>
      loadEnv({ ...baseEnv, WEBHOOK_URL: 'https://hooks.example.com/ob' }),
    ).toThrow('Refusing to boot: invalid environment.');
    expect(errSpy.mock.calls[0][0]).toContain('WEBHOOK_SECRET');

    errSpy.mockClear();
    expect(() =>
      loadEnv({
        ...baseEnv,
        WEBHOOK_URL: 'https://hooks.example.com/ob',
        WEBHOOK_SECRET: 'short',
      }),
    ).toThrow('Refusing to boot: invalid environment.');
    expect(errSpy.mock.calls[0][0]).toContain('WEBHOOK_SECRET must be at least 32 characters');
  });

  it('case 20: a non-https, non-loopback WEBHOOK_URL is rejected at config time', () => {
    expect(() =>
      loadEnv({
        ...baseEnv,
        WEBHOOK_URL: 'http://hooks.example.com/ob',
        WEBHOOK_SECRET: 'k7Jf2pQrwStN9vB3zX1cM4dL0eR6yU2h',
      }),
    ).toThrow('Refusing to boot: invalid environment.');
    expect(errSpy.mock.calls[0][0]).toContain('WEBHOOK_URL must use https');
  });

  it('case 21: http is allowed for a loopback host (dev)', () => {
    const env = loadEnv({
      ...baseEnv,
      WEBHOOK_URL: 'http://localhost:4000/hooks',
      WEBHOOK_SECRET: 'k7Jf2pQrwStN9vB3zX1cM4dL0eR6yU2h',
    });
    expect(env.WEBHOOK_URL).toBe('http://localhost:4000/hooks');
  });

  // --- async replication to external S3 target (STORY-0900) ---
  it('case 22: replication off by default with documented drain/dead-letter defaults', () => {
    const env = loadEnv({ ...baseEnv });
    expect(env.OPENBUCKET_REPLICATION_ENABLED).toBe(false);
    expect(env.OPENBUCKET_REPLICATION_REGION).toBe('us-east-1');
    expect(env.OPENBUCKET_REPLICATION_FORCE_PATH_STYLE).toBe(true);
    expect(env.OPENBUCKET_REPLICATION_MAX_ATTEMPTS).toBe(12);
    expect(env.OPENBUCKET_REPLICATION_DRAIN_INTERVAL_MS).toBe(5_000);
    expect(env.OPENBUCKET_REPLICATION_BATCH_KEYS).toBe(50);
    expect(env.OPENBUCKET_REPLICATION_LARGE_OBJECT_THRESHOLD_BYTES).toBe(64 * 1024 * 1024);
  });

  it('case 23: a full replication config boots and enables replication', () => {
    const env = loadEnv({
      ...baseEnv,
      OPENBUCKET_REPLICATION_ENABLED: 'true',
      OPENBUCKET_REPLICATION_ENDPOINT: 'https://s3.example.com',
      OPENBUCKET_REPLICATION_BUCKET: 'remote-mirror',
      OPENBUCKET_REPLICATION_ACCESS_KEY_ID: 'AKIAEXAMPLE1234567890',
      OPENBUCKET_REPLICATION_SECRET_ACCESS_KEY: 'k7Jf2pQrwStN9vB3zX1cM4dL0eR6yU2h7gK3nP5s',
    });
    expect(env.OPENBUCKET_REPLICATION_ENABLED).toBe(true);
    expect(env.OPENBUCKET_REPLICATION_BUCKET).toBe('remote-mirror');
  });

  it('case 24: ENABLED=true but missing bucket/creds refuses to boot (fail-closed)', () => {
    expect(() => loadEnv({ ...baseEnv, OPENBUCKET_REPLICATION_ENABLED: 'true' })).toThrow(
      'Refusing to boot: invalid environment.',
    );
    const joined = errSpy.mock.calls[0][0] as string;
    expect(joined).toContain('OPENBUCKET_REPLICATION_BUCKET');
    expect(joined).toContain('OPENBUCKET_REPLICATION_ACCESS_KEY_ID');
    expect(joined).toContain('OPENBUCKET_REPLICATION_SECRET_ACCESS_KEY');
  });

  it('case 25: ENABLED=true with a malformed remote bucket name is rejected', () => {
    expect(() =>
      loadEnv({
        ...baseEnv,
        OPENBUCKET_REPLICATION_ENABLED: 'true',
        OPENBUCKET_REPLICATION_BUCKET: 'Invalid_Bucket_NAME',
        OPENBUCKET_REPLICATION_ACCESS_KEY_ID: 'AKIAEXAMPLE1234567890',
        OPENBUCKET_REPLICATION_SECRET_ACCESS_KEY: 'k7Jf2pQrwStN9vB3zX1cM4dL0eR6yU2h7gK3nP5s',
      }),
    ).toThrow('Refusing to boot: invalid environment.');
    expect(errSpy.mock.calls[0][0]).toContain('OPENBUCKET_REPLICATION_BUCKET must be a valid S3 bucket name');
  });

  it('case 26: ENABLED=true with a malformed endpoint URL is rejected', () => {
    expect(() =>
      loadEnv({
        ...baseEnv,
        OPENBUCKET_REPLICATION_ENABLED: 'true',
        OPENBUCKET_REPLICATION_ENDPOINT: 'not-a-url',
        OPENBUCKET_REPLICATION_BUCKET: 'remote-mirror',
        OPENBUCKET_REPLICATION_ACCESS_KEY_ID: 'AKIAEXAMPLE1234567890',
        OPENBUCKET_REPLICATION_SECRET_ACCESS_KEY: 'k7Jf2pQrwStN9vB3zX1cM4dL0eR6yU2h7gK3nP5s',
      }),
    ).toThrow('Refusing to boot: invalid environment.');
    expect(errSpy.mock.calls[0][0]).toContain('OPENBUCKET_REPLICATION_ENDPOINT');
  });

  it('case 27: cold-object tiering knobs apply their documented defaults (STORY-0901)', () => {
    const env = loadEnv({ ...baseEnv });
    expect(env.OPENBUCKET_TIER_ENABLED).toBe(false);
    expect(env.OPENBUCKET_TIER_INLINE_MAX_BYTES).toBe(256 * 1024 * 1024);
    expect(env.OPENBUCKET_TIER_READTHROUGH_TIMEOUT_MS).toBe(30_000);
    expect(env.OPENBUCKET_TIER_MAX_CONCURRENT_REHYDRATE).toBe(8);
    expect(env.OPENBUCKET_TIER_PRESIGN_TTL_SECONDS).toBe(300);
  });

  it('case 28: OPENBUCKET_TIER_ENABLED=false coerces to boolean false (STORY-0901)', () => {
    // envBoolean, not z.coerce.boolean(), so the string "false" disables it.
    expect(loadEnv({ ...baseEnv, OPENBUCKET_TIER_ENABLED: 'false' }).OPENBUCKET_TIER_ENABLED).toBe(
      false,
    );
    expect(loadEnv({ ...baseEnv, OPENBUCKET_TIER_ENABLED: 'true' }).OPENBUCKET_TIER_ENABLED).toBe(
      true,
    );
  });

  it('case 29: out-of-range tiering knobs are rejected at boot (STORY-0901)', () => {
    // presign TTL is bounded [30, 3600]; a negative concurrency cap is rejected.
    expect(() => loadEnv({ ...baseEnv, OPENBUCKET_TIER_PRESIGN_TTL_SECONDS: '5' })).toThrow(
      'Refusing to boot: invalid environment.',
    );
    expect(() => loadEnv({ ...baseEnv, OPENBUCKET_TIER_PRESIGN_TTL_SECONDS: '99999' })).toThrow();
    expect(() => loadEnv({ ...baseEnv, OPENBUCKET_TIER_MAX_CONCURRENT_REHYDRATE: '-1' })).toThrow();
    expect(() => loadEnv({ ...baseEnv, OPENBUCKET_TIER_READTHROUGH_TIMEOUT_MS: '0' })).toThrow();
  });
});

describe('AppConfigService', () => {
  it('case 10: exposes all getters from a booted ConfigModule', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          // In production AppModule passes `validate: loadEnv`, which
          // @nestjs/config runs against process.env. Here we inject the
          // already-validated object (with defaults applied) via `load`.
          load: [() => loadEnv({ ...baseEnv })],
        }),
      ],
      providers: [AppConfigService],
    }).compile();

    const service = moduleRef.get(AppConfigService);

    expect(service.dataDir).toBe('/data');
    expect(service.port).toBe(9000);
    expect(service.region).toBe('us-east-1');
    expect(service.nodeEnv).toBe('production');
    expect(service.logLevel).toBe('info');
    expect(service.jwtSecret).toHaveLength(32);
    expect(service.jwtAccessTtl).toBe(900);
    expect(service.jwtRefreshTtl).toBe(604_800);
    expect(service.adminUsername).toBe('admin');
    expect(service.adminPasswordHash).toMatch(/^\$argon2id\$/);
    expect(service.rootAccessKeyId).toBe('AKIA1234567890ABCD');
    expect(service.rootSecretAccessKey).toHaveLength(40);
    expect(service.endpoint).toBeUndefined();
    expect(service.maxObjectSizeMb).toBeGreaterThan(0);
    expect(service.maxMultipartParts).toBe(10_000);
    expect(service.multipartTtlHours).toBe(24);
    expect(service.shutdownDrainMs).toBe(30_000);
    // image-transform getters (TASK-2403)
    expect(service.imageTransformEnabled).toBe(true);
    expect(service.maxTransformDimension).toBe(4_096);
    expect(service.maxTransformInputBytes).toBe(50 * 1024 * 1024);
    expect(service.transformLimitInputPixels).toBe(24_000 * 24_000);
    expect(service.imageTransformConcurrency).toBe(4);
    expect(service.derivativeCacheMaxBytes).toBe(5 * 1024 * 1024 * 1024);
    // webhook getters (STORY-0801): off by default.
    expect(service.webhooksEnabled).toBe(false);
    expect(service.webhookUrl).toBeUndefined();
    expect(service.webhookSecret).toBe('');
    expect(service.webhookMaxAttempts).toBe(8);
    expect(service.webhookTimeoutMs).toBe(5_000);
    expect(service.webhookPollMs).toBe(15_000);
    expect(service.webhookEvents).toEqual([
      'object.created',
      'object.deleted',
      'multipart.completed',
    ]);
    // replication getters (STORY-0900): off by default with resolved defaults.
    expect(service.replicationEnabled).toBe(false);
    expect(service.replicationRegion).toBe('us-east-1');
    expect(service.replicationForcePathStyle).toBe(true);
    expect(service.replicationMaxAttempts).toBe(12);
    expect(service.replicationDrainIntervalMs).toBe(5_000);
    expect(service.replicationBatchKeys).toBe(50);
    expect(service.replicationLargeObjectThresholdBytes).toBe(64 * 1024 * 1024);

    await moduleRef.close();
  });

  it('webhook getters reflect a configured webhook + parse the CSV filter', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () =>
              loadEnv({
                ...baseEnv,
                WEBHOOK_URL: 'https://hooks.example.com/ob',
                WEBHOOK_SECRET: 'k7Jf2pQrwStN9vB3zX1cM4dL0eR6yU2h',
                WEBHOOK_EVENTS: 'object.created, object.deleted , bogus.event',
              }),
          ],
        }),
      ],
      providers: [AppConfigService],
    }).compile();

    const service = moduleRef.get(AppConfigService);
    expect(service.webhooksEnabled).toBe(true);
    expect(service.webhookUrl).toBe('https://hooks.example.com/ob');
    expect(service.webhookSecret).toHaveLength(32);
    // CSV parse trims whitespace + drops empties; an unknown name is kept as-is
    // here (the enqueue gate is what ignores it), so just assert trimming.
    expect(service.webhookEvents).toEqual(['object.created', 'object.deleted', 'bogus.event']);

    await moduleRef.close();
  });
});

describe('loadEnv scheduled backups (STORY-1203)', () => {
  let errSpy: jest.SpyInstance;
  beforeEach(() => {
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => errSpy.mockRestore());

  it('defaults: disabled with the documented retention defaults', () => {
    const env = loadEnv({ ...baseEnv });
    expect(env.OPENBUCKET_SCHEDULED_BACKUP_ENABLED).toBe(false);
    expect(env.OPENBUCKET_SCHEDULED_BACKUP_SCOPE).toBe('instance');
    expect(env.OPENBUCKET_SCHEDULED_BACKUP_KEEP_LAST).toBe(7);
    expect(env.OPENBUCKET_SCHEDULED_BACKUP_MAX_AGE_DAYS).toBe(30);
    expect(env.OPENBUCKET_SCHEDULED_BACKUP_CHECK_INTERVAL_MS).toBe(60_000);
    expect(env.OPENBUCKET_SCHEDULED_BACKUP_PUSH_TO_REPLICATION).toBe(false);
  });

  it('enabled with an interval parses', () => {
    const env = loadEnv({
      ...baseEnv,
      OPENBUCKET_SCHEDULED_BACKUP_ENABLED: 'true',
      OPENBUCKET_SCHEDULED_BACKUP_INTERVAL_MINUTES: '60',
    });
    expect(env.OPENBUCKET_SCHEDULED_BACKUP_ENABLED).toBe(true);
    expect(env.OPENBUCKET_SCHEDULED_BACKUP_INTERVAL_MINUTES).toBe(60);
  });

  it('enabled with a valid cron parses', () => {
    const env = loadEnv({
      ...baseEnv,
      OPENBUCKET_SCHEDULED_BACKUP_ENABLED: 'true',
      OPENBUCKET_SCHEDULED_BACKUP_CRON: '0 3 * * *',
    });
    expect(env.OPENBUCKET_SCHEDULED_BACKUP_CRON).toBe('0 3 * * *');
  });

  it('enabled with NEITHER interval nor cron refuses to boot', () => {
    expect(() => loadEnv({ ...baseEnv, OPENBUCKET_SCHEDULED_BACKUP_ENABLED: 'true' })).toThrow(
      'Refusing to boot: invalid environment.',
    );
    expect(errSpy.mock.calls[0][0]).toContain('exactly one of OPENBUCKET_SCHEDULED_BACKUP_INTERVAL_MINUTES');
  });

  it('enabled with BOTH interval and cron refuses to boot', () => {
    expect(() =>
      loadEnv({
        ...baseEnv,
        OPENBUCKET_SCHEDULED_BACKUP_ENABLED: 'true',
        OPENBUCKET_SCHEDULED_BACKUP_INTERVAL_MINUTES: '60',
        OPENBUCKET_SCHEDULED_BACKUP_CRON: '0 3 * * *',
      }),
    ).toThrow('Refusing to boot: invalid environment.');
  });

  it('a malformed cron refuses to boot', () => {
    expect(() =>
      loadEnv({
        ...baseEnv,
        OPENBUCKET_SCHEDULED_BACKUP_ENABLED: 'true',
        OPENBUCKET_SCHEDULED_BACKUP_CRON: 'not a cron',
      }),
    ).toThrow('Refusing to boot: invalid environment.');
    expect(errSpy.mock.calls[0][0]).toContain('OPENBUCKET_SCHEDULED_BACKUP_CRON is not a valid cron');
  });
});

describe('normalizeMount (ReDoS-free trailing-slash trim)', () => {
  it.each([
    ['', ''],
    ['/', ''],
    ['//', ''],
    ['storage', '/storage'],
    ['/storage', '/storage'],
    ['/storage/', '/storage'],
    ['storage///', '/storage'],
    ['  /storage/  ', '/storage'],
    ['/a/b/c/', '/a/b/c'],
  ])('normalizeMount(%j) -> %j', (input, expected) => {
    expect(normalizeMount(input)).toBe(expected);
  });

  it('is linear on a long trailing-slash run (no polynomial backtracking)', () => {
    // A pathological input for the old `/\/+$/`: many slashes NOT terminating the
    // string. Must return promptly and correctly with the linear scan.
    const evil = '/x' + '/'.repeat(200_000) + 'y';
    const start = Date.now();
    // No trailing slash to strip (ends in 'y') → returned unchanged.
    expect(normalizeMount(evil)).toBe(evil);
    expect(Date.now() - start).toBeLessThan(1000);
  });
});
