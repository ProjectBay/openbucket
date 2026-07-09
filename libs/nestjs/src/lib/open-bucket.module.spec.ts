import { Controller, Get, Injectable, type INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';

import { OpenBucketModule } from './open-bucket.module';
import type { OpenBucketModuleOptions, OpenBucketOptionsFactory } from './open-bucket-options';

/**
 * Host-app embedding harness — boots a NestJS app that imports
 * `OpenBucketModule.forRoot(options)` ALONGSIDE the host's own controller, and
 * drives it over HTTP. This is the end-to-end proof of the public API (phases
 * 0–1) and the acceptance test for phases 2–3 (provider/route isolation).
 *
 * The `it.skip`s below are the phase 2/3 to-do list — un-skip each as the
 * de-globalization (filter/pipe/guard scoping) and mount-prefix routing land.
 */
@Controller('host')
class HostController {
  @Get('ping')
  ping() {
    return { pong: true };
  }

  @Get('boom')
  boom() {
    throw new Error('host-owned error');
  }
}

@Module({ controllers: [HostController] })
class HostFeatureModule {}

const DATA_DIR = join(process.cwd(), 'tmp', `ob-harness-${process.pid}`);

describe('OpenBucketModule.forRoot — host-app embedding', () => {
  let app: INestApplication;

  beforeAll(async () => {
    rmSync(DATA_DIR, { recursive: true, force: true });
    mkdirSync(DATA_DIR, { recursive: true });

    const moduleRef = await Test.createTestingModule({
      imports: [
        HostFeatureModule,
        OpenBucketModule.forRoot({
          dataDir: DATA_DIR,
          rootCredentials: { accessKeyId: 'AKIAEXAMPLE000000000', secretAccessKey: 'k7Jf2pQrwStN9vB3zX1cM4dL0eR6yU2h7gK3nP5s' },
          admin: {
            username: 'admin',
            passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$abc$def',
            jwtSecret: 'k7Jf2pQrwStN9vB3zX1cM4dL0eR6yU2h7gK3nP5s',
          },
        }),
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init(); // migrations run on PersistenceModule's OnModuleInit
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    rmSync(DATA_DIR, { recursive: true, force: true });
  });

  // --- OpenBucket works through the public forRoot API, under /storage (phases 0–1, 3) ---
  it('S3 wire protocol responds under the mount (unsigned → 403)', async () => {
    const res = await request(app.getHttpServer()).get('/storage/');
    expect(res.status).toBe(403);
    expect(res.headers['content-type']).toContain('xml');
  });

  it('admin health responds under the mount (200)', async () => {
    const res = await request(app.getHttpServer()).get('/storage/api/admin/health');
    expect(res.status).toBe(200);
  });

  it('guarded admin route is protected under the mount (no token → 401)', async () => {
    // Regression: a hardcoded `/api/admin/` prefix in the guard would leave the
    // MOUNTED admin API (`/storage/api/admin/*`) unauthenticated.
    const res = await request(app.getHttpServer()).get('/storage/api/admin/buckets');
    expect(res.status).toBe(401);
  });

  // --- Host isolation ---
  it('[phase 3] host route is reachable (not swallowed by the greedy S3 routes)', async () => {
    const res = await request(app.getHttpServer()).get('/host/ping');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pong: true });
  });

  it('[phase 2] host route errors are NOT rendered by OpenBucket filters', async () => {
    const res = await request(app.getHttpServer()).get('/host/boom');
    expect(res.status).toBe(500);
    expect(res.headers['content-type'] ?? '').not.toContain('xml');
  });
});

const DATA_DIR_HEADLESS = join(process.cwd(), 'tmp', `ob-headless-${process.pid}`);

describe('OpenBucketModule.forRoot — admin disabled (headless S3-only)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    rmSync(DATA_DIR_HEADLESS, { recursive: true, force: true });
    mkdirSync(DATA_DIR_HEADLESS, { recursive: true });

    const moduleRef = await Test.createTestingModule({
      imports: [
        OpenBucketModule.forRoot({
          dataDir: DATA_DIR_HEADLESS,
          rootCredentials: { accessKeyId: 'AKIAEXAMPLE000000000', secretAccessKey: 'k7Jf2pQrwStN9vB3zX1cM4dL0eR6yU2h7gK3nP5s' },
          // No `admin` block ⇒ no admin API, no JWT guard, no SPA, no bootstrap.
        }),
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    rmSync(DATA_DIR_HEADLESS, { recursive: true, force: true });
  });

  it('S3 wire protocol still responds under the mount (unsigned → 403)', async () => {
    const res = await request(app.getHttpServer()).get('/storage/');
    expect(res.status).toBe(403);
    expect(res.headers['content-type']).toContain('xml');
  });

  it('admin API is NOT mounted and NOT guarded (404, never a 401 from the JWT guard)', async () => {
    // With admin enabled the global JwtAuthGuard answers this 401 (see the suite
    // above). Disabled, the admin controllers AND the guard are gone, so the route
    // simply does not exist → 404. Crucially it is never 401, which would mean the
    // guard (and an empty-secret JWT setup) was still wired.
    const res = await request(app.getHttpServer()).get('/storage/api/admin/buckets');
    expect(res.status).not.toBe(401);
    expect(res.status).toBe(404);
  });

  it('admin login is NOT reachable when admin is disabled (no auth surface at all)', async () => {
    const res = await request(app.getHttpServer())
      .post('/storage/api/admin/auth/login')
      .send({ username: 'admin', password: 'whatever' });
    expect(res.status).toBe(404);
  });
});

const DATA_DIR_ASYNC = join(process.cwd(), 'tmp', `ob-async-useclass-${process.pid}`);

// SF-2: `forRootAsync` supports `useClass`/`useExisting` via an
// `OpenBucketOptionsFactory` (createOpenBucketOptions), not just `useFactory`.
@Injectable()
class TestOptionsFactory implements OpenBucketOptionsFactory {
  createOpenBucketOptions(): OpenBucketModuleOptions {
    // No `admin` block — the async `admin: false` runs this headless (S3-only).
    return {
      dataDir: DATA_DIR_ASYNC,
      rootCredentials: {
        accessKeyId: 'AKIAEXAMPLE000000000',
        secretAccessKey: 'k7Jf2pQrwStN9vB3zX1cM4dL0eR6yU2h7gK3nP5s',
      },
    };
  }
}

describe('OpenBucketModule.forRootAsync — useClass options factory', () => {
  let app: INestApplication;

  beforeAll(async () => {
    rmSync(DATA_DIR_ASYNC, { recursive: true, force: true });
    mkdirSync(DATA_DIR_ASYNC, { recursive: true });

    const moduleRef = await Test.createTestingModule({
      imports: [
        OpenBucketModule.forRootAsync({ admin: false, useClass: TestOptionsFactory }),
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    rmSync(DATA_DIR_ASYNC, { recursive: true, force: true });
  });

  it('boots and serves S3 from options built by the injected factory (unsigned → 403)', async () => {
    const res = await request(app.getHttpServer()).get('/storage/');
    expect(res.status).toBe(403);
    expect(res.headers['content-type']).toContain('xml');
  });
});
