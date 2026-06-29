import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';

import { OpenBucketModule } from './open-bucket.module';
import { OpenBucketService } from './open-bucket.service';

/**
 * The in-process `OpenBucketService` facade, driven the way a host app would —
 * injected from an embedded `OpenBucketModule.forRoot`. Runs in HEADLESS mode (no
 * `admin`) to prove the facade works without the admin surface. Each data method
 * opens its own MikroORM RequestContext, so these calls succeed with no HTTP
 * request in flight. The presign test then proves a minted URL actually verifies
 * against the mounted S3 routes (including the `mountPath` prefix).
 */
const DATA_DIR = join(process.cwd(), 'tmp', `ob-facade-${process.pid}`);
const BUCKET = 'facade-bucket';

describe('OpenBucketService — in-process facade', () => {
  let app: INestApplication;
  let svc: OpenBucketService;

  beforeAll(async () => {
    rmSync(DATA_DIR, { recursive: true, force: true });
    mkdirSync(DATA_DIR, { recursive: true });

    const moduleRef = await Test.createTestingModule({
      imports: [
        OpenBucketModule.forRoot({
          dataDir: DATA_DIR,
          mountPath: '/storage',
          rootCredentials: { accessKeyId: 'AKIAEXAMPLE000000000', secretAccessKey: 'x'.repeat(40) },
          // headless — the facade must work with no admin surface
        }),
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    svc = app.get(OpenBucketService);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    rmSync(DATA_DIR, { recursive: true, force: true });
  });

  it('creates a bucket and reports existence', async () => {
    await svc.createBucket(BUCKET);
    expect(await svc.bucketExists(BUCKET)).toBe(true);
    expect(await svc.bucketExists('no-such-bucket')).toBe(false);
    expect((await svc.listBuckets()).map((b) => b.name)).toContain(BUCKET);
  });

  it('uploads, heads, and reads an object back', async () => {
    const put = await svc.putObject(BUCKET, 'docs/hello.txt', 'hello world', {
      contentType: 'text/plain',
    });
    expect(put.etag).toMatch(/^[0-9a-f]{32}$/);

    const meta = await svc.headObject(BUCKET, 'docs/hello.txt');
    expect(meta).not.toBeNull();
    expect(meta!.size).toBe(11);
    expect(meta!.contentType).toBe('text/plain');

    const buf = await svc.getObjectBuffer(BUCKET, 'docs/hello.txt');
    expect(buf.toString('utf8')).toBe('hello world');
  });

  it('lists objects with a prefix and rolls up under a delimiter', async () => {
    await svc.putObject(BUCKET, 'docs/a.txt', 'a');
    await svc.putObject(BUCKET, 'images/b.png', 'b');

    const flat = await svc.listObjects(BUCKET, { prefix: 'docs/' });
    expect(flat.contents.map((o) => o.key).sort()).toEqual(['docs/a.txt', 'docs/hello.txt']);

    const folders = await svc.listObjects(BUCKET, { delimiter: '/' });
    expect(folders.commonPrefixes.sort()).toEqual(['docs/', 'images/']);
  });

  it('deletes an object (idempotently)', async () => {
    await svc.putObject(BUCKET, 'tmp/x', 'x');
    await svc.deleteObject(BUCKET, 'tmp/x');
    expect(await svc.headObject(BUCKET, 'tmp/x')).toBeNull();
    await expect(svc.deleteObject(BUCKET, 'tmp/x')).resolves.toBeUndefined(); // idempotent
  });

  it('mints a presigned GET URL that actually verifies against the mounted S3 routes', async () => {
    await svc.putObject(BUCKET, 'share/me.txt', 'shared bytes', { contentType: 'text/plain' });

    // Sign for a fixed host; SigV4 covers the `host` header, so we replay the
    // request with the same Host and it must verify (proving the signature + the
    // `/storage` mount prefix are correct).
    const url = svc.presignGetUrl(BUCKET, 'share/me.txt', {
      baseUrl: 'http://signed-host',
      expiresIn: 300,
    });
    const u = new URL(url);
    expect(u.pathname).toBe(`/storage/${BUCKET}/share/me.txt`);
    expect(u.searchParams.get('X-Amz-Credential')).toContain('AKIAEXAMPLE000000000');

    const res = await request(app.getHttpServer())
      .get(u.pathname + u.search)
      .set('Host', 'signed-host');
    expect(res.status).toBe(200);
    expect(res.text).toBe('shared bytes');
  });

  it('rejects presign when neither baseUrl nor the endpoint option is set', () => {
    expect(() => svc.presignGetUrl(BUCKET, 'k')).toThrow(/baseUrl/);
  });
});
