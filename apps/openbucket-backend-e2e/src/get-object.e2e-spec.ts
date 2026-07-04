import { request } from 'node:http';
import * as aws4 from 'aws4';

import { SpawnedApp, spawnApp } from './support/spawn-app';

/**
 * TEST-0306 — GetObject end-to-end against the built app.
 *
 * Drives the streaming GET path: metadata lookup → BlobStore.getBlob →
 * header ordering → 200 (full) / 206 (range) / 416 (invalid range), plus
 * NoSuchKey. The object is created via the live PutObject path in beforeAll.
 */
const PORT = 9223;
const HOST = `127.0.0.1:${PORT}`;
const CREDS = { accessKeyId: 'AKIA1234567890ABCD', secretAccessKey: 'e2eRootSecretAccessKey9f3a7c1e5b2d08X6Yk' };
const BUCKET = 'get-bucket';
const KEY = 'doc.txt';
const BODY = 'OpenBucket streaming GET payload!'; // 33 bytes

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
  // extraHeaders (e.g. Range) are sent unsigned — the server reads them but
  // they need not participate in the signature.
  const headers = { ...(opts.headers as Record<string, string>), ...extraHeaders };
  return new Promise((resolve, reject) => {
    // agent:false → a fresh socket per request; streamed GET responses otherwise
    // leave the keep-alive socket in a state the next request stalls on.
    const req = request(
      { hostname: '127.0.0.1', port: PORT, method, path, headers, agent: false },
      (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: buf }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

describe('GetObject (e2e, TEST-0306)', () => {
  let app: SpawnedApp;

  beforeAll(async () => {
    app = await spawnApp(PORT);
    await signed('PUT', `/${BUCKET}`);
    await signed('PUT', `/${BUCKET}/${KEY}`, BODY);
  }, 40_000);

  afterAll(async () => {
    app?.kill('SIGKILL');
    await app?.waitForExit();
  });

  it('GET → 200 with the full body and streaming headers', async () => {
    const res = await signed('GET', `/${BUCKET}/${KEY}`);
    expect(res.status).toBe(200);
    expect(res.body).toBe(BODY);
    expect(res.headers['content-length']).toBe(String(BODY.length));
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['etag']).toBe(`"${require('node:crypto').createHash('md5').update(BODY).digest('hex')}"`);
  });

  it('GET with Range: bytes=0-4 → 206 partial content', async () => {
    const res = await signed('GET', `/${BUCKET}/${KEY}`, undefined, { range: 'bytes=0-4' });
    expect(res.status).toBe(206);
    expect(res.body).toBe('OpenB');
    expect(res.headers['content-range']).toBe(`bytes 0-4/${BODY.length}`);
    expect(res.headers['content-length']).toBe('5');
  });

  it('GET with a suffix Range: bytes=-7 → 206 last bytes', async () => {
    const res = await signed('GET', `/${BUCKET}/${KEY}`, undefined, { range: 'bytes=-7' });
    expect(res.status).toBe(206);
    expect(res.body).toBe(BODY.slice(-7));
    expect(res.headers['content-range']).toBe(`bytes ${BODY.length - 7}-${BODY.length - 1}/${BODY.length}`);
  });

  it('GET with an unsatisfiable Range → 416', async () => {
    const res = await signed('GET', `/${BUCKET}/${KEY}`, undefined, { range: 'bytes=9999-10000' });
    expect(res.status).toBe(416);
    expect(res.headers['content-range']).toBe(`bytes */${BODY.length}`);
  });

  it('GET a missing key → 404 NoSuchKey', async () => {
    const res = await signed('GET', `/${BUCKET}/nope.txt`);
    expect(res.status).toBe(404);
    expect(res.body).toContain('<Code>NoSuchKey</Code>');
  });
});
