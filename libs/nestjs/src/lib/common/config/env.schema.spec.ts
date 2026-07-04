import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { AppConfigService } from './app-config.service';
import { loadEnv } from './env.schema';

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

    await moduleRef.close();
  });
});
