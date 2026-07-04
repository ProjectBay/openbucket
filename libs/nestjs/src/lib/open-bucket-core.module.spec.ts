import { Test } from '@nestjs/testing';

/**
 * TEST-0004 (unit slice) — OpenBucketCoreModule compiles with a valid environment.
 *
 * The detailed §1.3 assertions in the test plan (exact import order, Pino
 * redact paths, request-id-before-classifier middleware order, reqId in log
 * lines) are request-level and are covered by the live smoke boot and the
 * boundary e2e suite [TEST-0008/0013/0014]. As of M1/STORY-0205 the graph
 * includes PersistenceModule, so compiling it opens the SQLite DB under
 * DATA_DIR; this slice verifies the full graph wires and resolves cleanly.
 */
describe('OpenBucketCoreModule', () => {
  const ORIGINAL = process.env;

  beforeAll(() => {
    process.env = {
      ...ORIGINAL,
      NODE_ENV: 'test',
      DATA_DIR: '/tmp/openbucket-appmodule-test',
      JWT_SECRET: 'k7Jf2pQrwStN9vB3zX1cM4dL0eR6yU2h7gK3nP5s',
      ROOT_ACCESS_KEY_ID: 'AKIA1234567890ABCD',
      ROOT_SECRET_ACCESS_KEY: 'k7Jf2pQrwStN9vB3zX1cM4dL0eR6yU2h7gK3nP5s',
      ADMIN_PASSWORD_HASH: '$argon2id$v=19$m=65536,t=3,p=4$abc$def',
    };
  });

  afterAll(() => {
    process.env = ORIGINAL;
  });

  it('compiles the M0 module graph and resolves AppConfigService', async () => {
    // 60s timeout: MikroORM TsMorph entity discovery takes ~6s; default 5s is too tight.
    // Imported lazily so the env above is in place before ConfigModule.forRoot
    // runs its validate() against process.env.
    const { OpenBucketCoreModule } = await import('./open-bucket-core.module');
    const { AppConfigService } = await import('./common/config/app-config.service');

    const moduleRef = await Test.createTestingModule({ imports: [OpenBucketCoreModule] }).compile();
    const config = moduleRef.get(AppConfigService);

    expect(config.dataDir).toBe('/tmp/openbucket-appmodule-test');
    expect(config.port).toBe(9000);

    await moduleRef.close();
  }, 60_000);
});
