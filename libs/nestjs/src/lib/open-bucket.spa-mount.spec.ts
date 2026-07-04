import { Controller, Get, type INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

import { OpenBucketModule } from './open-bucket.module';
import { SPA_ROOT } from './spa/spa-utils';

/**
 * Embedded admin-SPA serving under a mountPath (phase 4 + the phase-2/3 mount
 * fixes). With `admin.serveUi: true`, `OpenBucketModule.forRoot` mounts the SPA
 * at `<mountPath>/admin`. The bundled asset dir isn't present in a unit run, so
 * SPA_ROOT is overridden with a fixture; this exercises the routing + classifier
 * + base-href rewrite, not the real bundle (that's the build/e2e's job).
 *
 * Asserts the shell is served under the mount with `<base href>` rewritten to
 * `<mountPath>/admin/`, hashed assets get an immutable cache, unknown client
 * routes fall back to the shell, and the host's own routes are untouched.
 */
@Controller('host')
class HostController {
  @Get('ping')
  ping() {
    return { pong: true };
  }
}

@Module({ controllers: [HostController] })
class HostFeatureModule {}

const DATA_DIR = join(process.cwd(), 'tmp', `ob-spa-mount-${process.pid}`);

describe('OpenBucketModule.forRoot — admin SPA under a mountPath', () => {
  let app: INestApplication;
  let spaRoot: string;

  beforeAll(async () => {
    rmSync(DATA_DIR, { recursive: true, force: true });
    mkdirSync(DATA_DIR, { recursive: true });

    // Fixture SPA: an index shell + one hashed asset.
    spaRoot = mkdtempSync(join(tmpdir(), 'ob-spa-fixture-'));
    writeFileSync(
      join(spaRoot, 'index.html'),
      '<html><head><base href="/admin/"></head><body>OPENBUCKET_SHELL</body></html>',
    );
    writeFileSync(join(spaRoot, 'main-UZ7C7DZ3.js'), 'console.log("ob-admin")');

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
            serveUi: true,
          },
        }),
      ],
    })
      .overrideProvider(SPA_ROOT)
      .useValue(spaRoot)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    rmSync(DATA_DIR, { recursive: true, force: true });
    rmSync(spaRoot, { recursive: true, force: true });
  });

  it('serves the shell at <mountPath>/admin with <base href> rewritten to the mount', async () => {
    const res = await request(app.getHttpServer()).get('/storage/admin');
    expect(res.status).toBe(200);
    expect(res.text).toContain('OPENBUCKET_SHELL');
    expect(res.text).toContain('<base href="/storage/admin/">');
    expect(res.headers['cache-control']).toContain('no-cache');
  });

  it('serves a hashed asset under the mount with an immutable cache', async () => {
    const res = await request(app.getHttpServer()).get('/storage/admin/main-UZ7C7DZ3.js');
    expect(res.status).toBe(200);
    expect(res.text).toContain('ob-admin');
    expect(res.headers['cache-control']).toContain('immutable');
  });

  it('falls back to the shell for client-side routes under the mount', async () => {
    const res = await request(app.getHttpServer()).get('/storage/admin/buckets/my-bucket');
    expect(res.status).toBe(200);
    expect(res.text).toContain('OPENBUCKET_SHELL');
  });

  it("does not swallow the host's own routes", async () => {
    const res = await request(app.getHttpServer()).get('/host/ping');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pong: true });
  });
});
