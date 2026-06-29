import { createHash } from 'node:crypto';
import { request } from 'node:http';
import * as aws4 from 'aws4';

import { SpawnedApp, spawnApp } from './support/spawn-app';

/**
 * TEST-0304 — PutObject end-to-end against the built app.
 *
 * Drives the full streaming PUT path: SigV4 guard → PutObjectInterceptor
 * (hash/size/digest verify) → ObjectService.putObject → two-phase ObjectWriter
 * → BlobStore atomic rename. Verifies the object landed via the ETag and via
 * ListObjectsV1 (STORY-0108), plus the BadDigest and NoSuchBucket failure paths.
 */
const PORT = 9221;
const HOST = `127.0.0.1:${PORT}`;
const CREDS = { accessKeyId: 'AKIA1234567890ABCD', secretAccessKey: 'x'.repeat(40) };

interface Res {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function signed(
  method: string,
  path: string,
  body?: string,
  extraHeaders: Record<string, string> = {},
): Promise<Res> {
  const opts: aws4.Request = {
    host: HOST,
    method,
    path,
    service: 's3',
    region: 'us-east-1',
    headers: {},
    body,
  };
  aws4.sign(opts, CREDS);
  const headers = { ...(opts.headers as Record<string, string>), ...extraHeaders };
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: PORT, method, path, headers }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: buf }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

describe('PutObject (e2e, TEST-0304)', () => {
  let app: SpawnedApp;
  const bucket = 'obj-bucket';

  beforeAll(async () => {
    app = await spawnApp(PORT);
    await signed('PUT', `/${bucket}`);
  }, 40_000);

  afterAll(async () => {
    app?.kill('SIGKILL');
    await app?.waitForExit();
  });

  it('PUT object → 200 with the MD5 ETag', async () => {
    const body = 'hello world';
    const md5 = createHash('md5').update(body).digest('hex');
    const res = await signed('PUT', `/${bucket}/hello.txt`, body);
    expect(res.status).toBe(200);
    expect(res.headers['etag']).toBe(`"${md5}"`);
  });

  it('the object is visible via ListObjectsV1 with key, size, and ETag', async () => {
    const md5 = createHash('md5').update('hello world').digest('hex');
    const res = await signed('GET', `/${bucket}`);
    expect(res.status).toBe(200);
    expect(res.body).toContain('<Key>hello.txt</Key>');
    expect(res.body).toContain('<Size>11</Size>');
    // The serializer XML-escapes the ETag's quotes (&quot;) — valid XML that
    // clients decode back to the literal-quoted ETag.
    expect(res.body).toContain(`<ETag>&quot;${md5}&quot;</ETag>`);
  });

  it('PUT with a multi-segment key works', async () => {
    const res = await signed('PUT', `/${bucket}/a/b/c/deep.bin`, 'deep payload');
    expect(res.status).toBe(200);
    const list = await signed('GET', `/${bucket}`);
    expect(list.body).toContain('<Key>a/b/c/deep.bin</Key>');
  });

  it('PUT with a mismatched Content-MD5 → 400 BadDigest', async () => {
    const res = await signed('PUT', `/${bucket}/bad.txt`, 'some body', {
      'content-md5': Buffer.alloc(16).toString('base64'),
    });
    expect(res.status).toBe(400);
    expect(res.body).toContain('<Code>BadDigest</Code>');
  });

  it('PUT to a non-existent bucket → 404 NoSuchBucket', async () => {
    const res = await signed('PUT', '/no-such-bucket/k.txt', 'x');
    expect(res.status).toBe(404);
    expect(res.body).toContain('<Code>NoSuchBucket</Code>');
  });
});
