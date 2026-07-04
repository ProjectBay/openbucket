import { request } from 'node:http';
import * as aws4 from 'aws4';

import { SpawnedApp, spawnApp } from './support/spawn-app';

/** TEST-0108 — presigned URL verification end-to-end (STORY-0104). */
const PORT = 9241;
const HOST = `127.0.0.1:${PORT}`;
const CREDS = { accessKeyId: 'AKIA1234567890ABCD', secretAccessKey: 'e2eRootSecretAccessKey9f3a7c1e5b2d08X6Yk' };
const BUCKET = 'presign-bucket';
const KEY = 'doc.txt';
const DATA = 'presigned payload data';

interface Res {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/** A normal header-signed request (for setup). */
function signed(method: string, path: string, body?: string): Promise<Res> {
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
  return send(method, path, opts.headers as Record<string, string>, body);
}

/** Build a presigned path (auth in the query string), no Authorization header. */
function presign(method: string, pathWithQuery: string): string {
  const opts: aws4.Request = {
    host: HOST,
    method,
    path: pathWithQuery,
    service: 's3',
    region: 'us-east-1',
    signQuery: true,
    headers: {},
  };
  aws4.sign(opts, CREDS);
  return opts.path as string;
}

function send(
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: string,
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: PORT, method, path, headers, agent: false }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: buf }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Presigned URLs (e2e, TEST-0108)', () => {
  let app: SpawnedApp;

  beforeAll(async () => {
    app = await spawnApp(PORT);
    await signed('PUT', `/${BUCKET}`);
    await signed('PUT', `/${BUCKET}/${KEY}`, DATA);
  }, 40_000);

  afterAll(async () => {
    app?.kill('SIGKILL');
    await app?.waitForExit();
  });

  it('a valid presigned GET (no Authorization header) returns the object', async () => {
    const path = presign('GET', `/${BUCKET}/${KEY}?X-Amz-Expires=3600`);
    const res = await send('GET', path); // no auth header — auth is in the query
    expect(res.status).toBe(200);
    expect(res.body).toBe(DATA);
  });

  it('a presigned PUT with no x-amz-content-sha256 header stores the object (UNSIGNED-PAYLOAD)', async () => {
    // Presigned uploads sign the payload as UNSIGNED-PAYLOAD and omit the
    // header entirely — the PutObjectInterceptor must default it rather than
    // reject (STORY-0104 follow-up).
    const body = 'presigned put body';
    const putPath = presign('PUT', `/${BUCKET}/presigned-put.txt?X-Amz-Expires=3600`);
    const put = await send('PUT', putPath, {}, body); // no auth + no x-amz-content-sha256
    expect(put.status).toBe(200);

    const get = await signed('GET', `/${BUCKET}/presigned-put.txt`);
    expect(get.status).toBe(200);
    expect(get.body).toBe(body);
  });

  it('a tampered presigned signature → 403 SignatureDoesNotMatch', async () => {
    const path = presign('GET', `/${BUCKET}/${KEY}?X-Amz-Expires=3600`).replace(
      /X-Amz-Signature=[0-9a-f]+/,
      `X-Amz-Signature=${'d'.repeat(64)}`,
    );
    const res = await send('GET', path);
    expect(res.status).toBe(403);
    expect(res.body).toContain('<Code>SignatureDoesNotMatch</Code>');
  });

  it('an expired presigned URL → 403 (Request has expired)', async () => {
    const path = presign('GET', `/${BUCKET}/${KEY}?X-Amz-Expires=1`);
    await sleep(1300); // outlive the 1-second window
    const res = await send('GET', path);
    expect(res.status).toBe(403);
    expect(res.body).toContain('<Code>AccessDenied</Code>');
    expect(res.body).toContain('Request has expired');
  });
});
