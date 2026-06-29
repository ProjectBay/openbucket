import { request } from 'node:http';
import * as aws4 from 'aws4';

import { SpawnedApp, spawnApp } from './support/spawn-app';

/**
 * TEST-0123 (Versioning configuration slice) — GET/PUT /:bucket?versioning
 * round-trip a `<VersioningConfiguration>` (STORY-0113).
 */
const PORT = 9265;
const HOST = `127.0.0.1:${PORT}`;
const CREDS = { accessKeyId: 'AKIA1234567890ABCD', secretAccessKey: 'x'.repeat(40) };
const BUCKET = 'ver-bucket';

interface Res {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

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
  return new Promise((resolve, reject) => {
    const req = request(
      { hostname: '127.0.0.1', port: PORT, method, path, headers: opts.headers, agent: false },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: buf }),
        );
      },
    );
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const config = (status: string) =>
  `<VersioningConfiguration><Status>${status}</Status></VersioningConfiguration>`;

describe('Bucket versioning configuration (e2e, TEST-0123)', () => {
  let app: SpawnedApp;

  beforeAll(async () => {
    app = await spawnApp(PORT);
    await signed('PUT', `/${BUCKET}`);
  }, 40_000);

  afterAll(async () => {
    app?.kill('SIGKILL');
    await app?.waitForExit();
  });

  it('GET ?versioning on a fresh bucket → empty config (no Status)', async () => {
    const res = await signed('GET', `/${BUCKET}?versioning`);
    expect(res.status).toBe(200);
    expect(res.body).toContain('<VersioningConfiguration');
    expect(res.body).not.toContain('<Status>');
  });

  it('PUT Enabled → GET reports Enabled', async () => {
    const put = await signed('PUT', `/${BUCKET}?versioning`, config('Enabled'));
    expect(put.status).toBeLessThan(300);

    const get = await signed('GET', `/${BUCKET}?versioning`);
    expect(get.status).toBe(200);
    expect(get.body).toContain('<Status>Enabled</Status>');
  });

  it('PUT Suspended → GET reports Suspended', async () => {
    const put = await signed('PUT', `/${BUCKET}?versioning`, config('Suspended'));
    expect(put.status).toBeLessThan(300);

    const get = await signed('GET', `/${BUCKET}?versioning`);
    expect(get.status).toBe(200);
    expect(get.body).toContain('<Status>Suspended</Status>');
  });

  it('PUT with missing Status → 400 MalformedXML', async () => {
    const res = await signed(
      'PUT',
      `/${BUCKET}?versioning`,
      '<VersioningConfiguration></VersioningConfiguration>',
    );
    expect(res.status).toBe(400);
    expect(res.body).toContain('<Code>MalformedXML</Code>');
  });

  it('GET ?versioning on a missing bucket → 404 NoSuchBucket', async () => {
    const res = await signed('GET', `/no-such-ver-bucket?versioning`);
    expect(res.status).toBe(404);
    expect(res.body).toContain('<Code>NoSuchBucket</Code>');
  });
});
