import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';

import { OpenBucketModule } from '../../open-bucket.module';
import { OpenBucketService } from '../../open-bucket.service';

/**
 * TEST-1100 (TASK-3304) — the admin `?content` preview path. Pins the EPIC-08
 * posture the preview frontend relies on and the new `Cache-Control` header:
 *  - unauthenticated `?content` → 401 (global JwtAuthGuard),
 *  - `Range` → 206 with a correct `Content-Range` and only the requested bytes,
 *  - a stored `text/html` object served with `?content` comes back neutralized
 *    (`application/octet-stream` + `attachment`) under CSP `default-src 'none'; sandbox`,
 *  - `?content` responses carry `Cache-Control: private, no-store`,
 *  - a slash-bearing key previews (single-decode, §5.13).
 */
const DATA_DIR = join(process.cwd(), 'tmp', `ob-preview-${process.pid}`);
const MOUNT = '/s3';
const JWT_SECRET = 'k7Jf2pQrwStN9vB3zX1cM4dL0eR6yU2h7gK3nP5s';
// A real argon2id hash (its value is irrelevant here — we mint JWTs directly).
const ADMIN_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHR2YWx1ZQ$Zm9vYmFyYmF6cXV4Y29ycmVjdGhvcml6b24';
const ROOT = {
  accessKeyId: 'AKIAEXAMPLE000000000',
  secretAccessKey: 'k7Jf2pQrwStN9vB3zX1cM4dL0eR6yU2h7gK3nP5s',
};
const TEXT_BODY = 'hello world'; // 11 bytes

describe('Admin content endpoint preview (TEST-1100)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    rmSync(DATA_DIR, { recursive: true, force: true });
    mkdirSync(DATA_DIR, { recursive: true });
    const moduleRef = await Test.createTestingModule({
      imports: [
        OpenBucketModule.forRoot({
          dataDir: DATA_DIR,
          mountPath: MOUNT,
          rootCredentials: ROOT,
          admin: { username: 'admin', passwordHash: ADMIN_HASH, jwtSecret: JWT_SECRET, serveUi: false },
        }),
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const svc = app.get(OpenBucketService);
    await svc.createBucket('previews');
    await svc.putObject('previews', 'notes.txt', TEXT_BODY, { contentType: 'text/plain' });
    await svc.putObject('previews', 'page.html', '<h1>hi</h1>', { contentType: 'text/html' });
    await svc.putObject('previews', 'a/b/deep.txt', TEXT_BODY, { contentType: 'text/plain' });

    // Mint an access token with the exact secret/issuer/audience the guard verifies.
    const jwt = app.get(JwtService, { strict: false });
    token = await jwt.signAsync({ sub: 'admin', username: 'admin', mustChangePassword: false, role: 'admin' });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    rmSync(DATA_DIR, { recursive: true, force: true });
  });

  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);

  it('401s an unauthenticated ?content request', async () => {
    await request(app.getHttpServer())
      .get(`${MOUNT}/api/admin/buckets/previews/objects/notes.txt?content`)
      .expect(401);
  });

  it('honours Range → 206 + Content-Range + only the requested bytes', async () => {
    const res = await auth(
      request(app.getHttpServer())
        .get(`${MOUNT}/api/admin/buckets/previews/objects/notes.txt?content`)
        .set('Range', 'bytes=0-4'),
    ).expect(206);
    expect(res.headers['content-range']).toBe(`bytes 0-4/${TEXT_BODY.length}`);
    expect(res.headers['content-length']).toBe('5');
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.text).toBe('hello');
  });

  it('returns 416 for an unsatisfiable range', async () => {
    const res = await auth(
      request(app.getHttpServer())
        .get(`${MOUNT}/api/admin/buckets/previews/objects/notes.txt?content`)
        .set('Range', 'bytes=999-1000'),
    ).expect(416);
    expect(res.headers['content-range']).toBe(`bytes */${TEXT_BODY.length}`);
  });

  it('neutralizes a stored text/html object served with ?content', async () => {
    const res = await auth(
      request(app.getHttpServer()).get(`${MOUNT}/api/admin/buckets/previews/objects/page.html?content`),
    ).expect(200);
    expect(res.headers['content-type']).toMatch(/application\/octet-stream/);
    expect(res.headers['content-disposition']).toMatch(/^attachment/);
    expect(res.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('sets Cache-Control: private, no-store on ?content', async () => {
    const res = await auth(
      request(app.getHttpServer()).get(`${MOUNT}/api/admin/buckets/previews/objects/notes.txt?content`),
    ).expect(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
  });

  it('previews a slash-bearing key (single-decode)', async () => {
    const res = await auth(
      request(app.getHttpServer()).get(`${MOUNT}/api/admin/buckets/previews/objects/a%2Fb%2Fdeep.txt?content`),
    ).expect(200);
    expect(res.text).toBe(TEXT_BODY);
    expect(res.headers['cache-control']).toBe('private, no-store');
  });
});
