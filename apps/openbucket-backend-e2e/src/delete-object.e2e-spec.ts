import { request } from 'node:http';
import * as aws4 from 'aws4';

import { SpawnedApp, spawnApp } from './support/spawn-app';

/**
 * TEST-0115 (Delete/Head slice) — DeleteObject + HeadObject end-to-end, plus
 * bulk DeleteObjects now that the deleteOne seam is live (STORY-0109/0108).
 */
const PORT = 9225;
const HOST = `127.0.0.1:${PORT}`;
const CREDS = { accessKeyId: 'AKIA1234567890ABCD', secretAccessKey: 'x'.repeat(40) };
const BUCKET = 'del-bucket';

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

describe('DeleteObject + HeadObject (e2e, TEST-0115)', () => {
  let app: SpawnedApp;

  beforeAll(async () => {
    app = await spawnApp(PORT);
    await signed('PUT', `/${BUCKET}`);
    await signed('PUT', `/${BUCKET}/keep.txt`, 'keep me');
    await signed('PUT', `/${BUCKET}/gone.txt`, 'delete me');
    await signed('PUT', `/${BUCKET}/bulk-a.txt`, 'a');
    await signed('PUT', `/${BUCKET}/bulk-b.txt`, 'b');
  }, 40_000);

  afterAll(async () => {
    app?.kill('SIGKILL');
    await app?.waitForExit();
  });

  it('HEAD an existing object → 200 with metadata headers and no body', async () => {
    const res = await signed('HEAD', `/${BUCKET}/keep.txt`);
    expect(res.status).toBe(200);
    expect(res.headers['content-length']).toBe('7');
    expect(res.headers['etag']).toBeTruthy();
    expect(res.body).toBe('');
  });

  it('DELETE → 204, then GET and HEAD return 404', async () => {
    const del = await signed('DELETE', `/${BUCKET}/gone.txt`);
    expect(del.status).toBe(204);

    const get = await signed('GET', `/${BUCKET}/gone.txt`);
    expect(get.status).toBe(404);
    expect(get.body).toContain('<Code>NoSuchKey</Code>');

    const head = await signed('HEAD', `/${BUCKET}/gone.txt`);
    expect(head.status).toBe(404);
    expect(head.body).toBe('');
  });

  it('DELETE a missing key → 204 (idempotent)', async () => {
    const res = await signed('DELETE', `/${BUCKET}/never-existed.txt`);
    expect(res.status).toBe(204);
  });

  it('bulk DeleteObjects removes the listed keys', async () => {
    const body =
      '<Delete>' +
      '<Object><Key>bulk-a.txt</Key></Object>' +
      '<Object><Key>bulk-b.txt</Key></Object>' +
      '</Delete>';
    const res = await signed('POST', `/${BUCKET}?delete`, body);
    expect(res.status).toBe(200);
    expect(res.body).toContain('<DeleteResult');
    expect(res.body).toContain('<Deleted><Key>bulk-a.txt</Key></Deleted>');
    expect(res.body).toContain('<Deleted><Key>bulk-b.txt</Key></Deleted>');

    const get = await signed('GET', `/${BUCKET}/bulk-a.txt`);
    expect(get.status).toBe(404);
  });
});
