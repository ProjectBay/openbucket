import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import request from 'supertest';
import sharp from 'sharp';

import { OpenBucketModule } from './open-bucket.module';
import { OpenBucketService } from './open-bucket.service';
import { UploadValidationError } from './open-bucket-upload';

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
          rootCredentials: { accessKeyId: 'AKIAEXAMPLE000000000', secretAccessKey: 'k7Jf2pQrwStN9vB3zX1cM4dL0eR6yU2h7gK3nP5s' },
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

  it('mints a presigned POST with url, six fields, and the expected conditions', () => {
    const { url, fields } = svc.createPresignedPost('b', {
      key: 'u/${filename}',
      baseUrl: 'https://files.example.com',
      contentLengthRange: { min: 1, max: 10485760 },
    });
    expect(url).toBe('https://files.example.com/storage/b');
    for (const f of [
      'key',
      'x-amz-algorithm',
      'x-amz-credential',
      'x-amz-date',
      'policy',
      'x-amz-signature',
    ]) {
      expect(fields[f]).toBeTruthy();
    }
    const policy = JSON.parse(Buffer.from(fields.policy, 'base64').toString('utf8'));
    expect(policy.conditions).toContainEqual({ bucket: 'b' });
    expect(policy.conditions).toContainEqual(['starts-with', '$key', 'u/']);
    expect(policy.conditions).toContainEqual(['content-length-range', 1, 10485760]);
  });

  it('defaults a content-length-range to the server cap when omitted', () => {
    const { fields } = svc.createPresignedPost('b', {
      key: 'k',
      baseUrl: 'https://files.example.com',
    });
    const policy = JSON.parse(Buffer.from(fields.policy, 'base64').toString('utf8'));
    const range = policy.conditions.find(
      (c: unknown) => Array.isArray(c) && c[0] === 'content-length-range',
    );
    expect(range).toBeDefined();
    expect(range[1]).toBe(0);
    expect(range[2]).toBeGreaterThan(0);
  });

  it('rejects an invalid contentLengthRange (min > max)', () => {
    expect(() =>
      svc.createPresignedPost('b', {
        key: 'k',
        baseUrl: 'https://files.example.com',
        contentLengthRange: { min: 100, max: 1 },
      }),
    ).toThrow(/contentLengthRange/);
  });

  // ---- uploadFrom (STORY-0803) --------------------------------------

  /** A memory-storage multer-like file. */
  function multer(buffer: Buffer, mimetype: string, originalname: string) {
    return { buffer, mimetype, originalname, size: buffer.length };
  }

  let pngBuf: Buffer;
  beforeAll(async () => {
    pngBuf = await sharp({
      create: { width: 9, height: 4, channels: 3, background: { r: 5, g: 6, b: 7 } },
    })
      .png()
      .toBuffer();
  });

  it('uploadFrom stores a multer file, sniffing the real content type', async () => {
    // Declared as octet-stream; the sniffer must correct it to image/png.
    const res = await svc.uploadFrom(multer(pngBuf, 'application/octet-stream', 'pic.png'), {
      bucket: BUCKET,
      keyStrategy: 'uuid',
    });
    expect(res.contentType).toBe('image/png');
    expect(res.key).toMatch(new RegExp(`^${new Date().getUTCFullYear()}/[0-9a-f-]{36}\\.png$`));
    expect(res.etag).toMatch(/^[0-9a-f]{32}$/);
    expect(res.size).toBe(pngBuf.length);
    expect(res.image).toEqual({ width: 9, height: 4, type: 'png' });

    const meta = await svc.headObject(BUCKET, res.key);
    expect(meta!.contentType).toBe('image/png');
    expect(meta!.size).toBe(pngBuf.length);
  });

  it('uploadFrom rejects a Buffer over maxBytes before any write', async () => {
    const key = 'guard/too-big-buffer.png';
    await expect(
      svc.uploadFrom(pngBuf, {
        bucket: BUCKET,
        key,
        validate: { maxBytes: 10 },
      }),
    ).rejects.toBeInstanceOf(UploadValidationError);
    expect(await svc.headObject(BUCKET, key)).toBeNull(); // nothing committed
  });

  it('uploadFrom aborts a streamed oversize body mid-write (no object committed)', async () => {
    const key = 'guard/too-big-stream.bin';
    const chunk = Buffer.alloc(64 * 1024, 0x41);
    const big = Readable.from(
      (async function* () {
        for (let i = 0; i < 8; i++) yield chunk; // 512 KiB total
      })(),
    );
    await expect(
      svc.uploadFrom(big, {
        bucket: BUCKET,
        key,
        contentType: 'application/octet-stream',
        validate: { maxBytes: 100 * 1024 },
      }),
    ).rejects.toBeDefined();
    expect(await svc.headObject(BUCKET, key)).toBeNull(); // staged blob unlinked
  });

  it('uploadFrom rejects a body that sniffs as active content (text/html)', async () => {
    const html = Buffer.from('<!DOCTYPE html><html><body>xss</body></html>');
    await expect(
      svc.uploadFrom(html, {
        bucket: BUCKET,
        key: 'guard/evil.png', // caller lies with a .png key + declared type
        contentType: 'image/png',
      }),
    ).rejects.toBeInstanceOf(UploadValidationError);
    expect(await svc.headObject(BUCKET, 'guard/evil.png')).toBeNull();
  });

  it('uploadFrom rejects a disallowed content type', async () => {
    await expect(
      svc.uploadFrom(Buffer.from('%PDF-1.7\n'), {
        bucket: BUCKET,
        key: 'guard/doc.pdf',
        validate: { allowedContentTypes: ['image/*'] },
      }),
    ).rejects.toMatchObject({ code: 'type_not_allowed' });
  });

  it('uploadFrom mints a url only when an origin is resolvable', async () => {
    const withUrl = await svc.uploadFrom(pngBuf, {
      bucket: BUCKET,
      keyStrategy: 'uuid-flat',
      presign: { baseUrl: 'https://files.example.com', expiresIn: 600 },
    });
    expect(withUrl.url).toContain('https://files.example.com/storage/');

    // No baseUrl and the module has no `endpoint` configured → url omitted.
    const noUrl = await svc.uploadFrom(pngBuf, { bucket: BUCKET, keyStrategy: 'uuid-flat' });
    expect(noUrl.url).toBeUndefined();

    // Explicit presign:false suppresses the url even if an origin were resolvable.
    const off = await svc.uploadFrom(pngBuf, {
      bucket: BUCKET,
      keyStrategy: 'uuid-flat',
      presign: false,
    });
    expect(off.url).toBeUndefined();
  });

  it('uploadFrom sha256 strategy is content-addressed and idempotent', async () => {
    const first = await svc.uploadFrom(pngBuf, {
      bucket: BUCKET,
      keyStrategy: 'sha256',
      filename: 'pic.png',
    });
    expect(first.key).toMatch(/^[0-9a-f]{2}\/[0-9a-f]{64}\.png$/);
    const second = await svc.uploadFrom(pngBuf, {
      bucket: BUCKET,
      keyStrategy: 'sha256',
      filename: 'pic.png',
    });
    expect(second.key).toBe(first.key); // same bytes → same key
    expect(second.etag).toBe(first.etag);
  });

  it('uploadFrom accepts a Readable and stores it', async () => {
    const body = Readable.from(pngBuf);
    const res = await svc.uploadFrom(body, {
      bucket: BUCKET,
      keyStrategy: 'uuid-flat',
      filename: 'stream.png',
    });
    expect(res.contentType).toBe('image/png');
    expect(res.size).toBe(pngBuf.length);
    const buf = await svc.getObjectBuffer(BUCKET, res.key);
    expect(buf.equals(pngBuf)).toBe(true);
  });
});
