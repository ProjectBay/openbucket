import { request } from 'node:http';
import * as aws4 from 'aws4';

import { SpawnedApp, spawnApp } from './support/spawn-app';

/**
 * TEST-0113 — Bucket CRUD lifecycle, end-to-end against the built app.
 *
 * Exercises the dependency-free bucket-scope surface from STORY-0108:
 * CreateBucket, HeadBucket, GetBucketLocation, ListObjectsV1, an accelerate
 * stub, the BucketAlreadyOwnedByYou conflict, and DeleteBucket. (The
 * object-dependent ops — bulk delete, populated listings — are exercised once
 * object writes land in STORY-0109/0302.)
 */
const PORT = 9219;
const HOST = `127.0.0.1:${PORT}`;
const CREDS = { accessKeyId: 'AKIA1234567890ABCD', secretAccessKey: 'e2eRootSecretAccessKey9f3a7c1e5b2d08X6Yk' };

interface Res {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/** Sign a request with aws4 and send it over raw http (custom Host allowed). */
function signed(method: string, path: string, body?: string): Promise<Res> {
  const opts: aws4.Request = {
    host: HOST,
    method,
    path,
    service: 's3',
    region: 'us-east-1',
    headers: body !== undefined ? { 'content-type': 'application/xml' } : {},
    body,
  };
  aws4.sign(opts, CREDS);
  return new Promise((resolve, reject) => {
    const req = request(
      { hostname: '127.0.0.1', port: PORT, method, path, headers: opts.headers },
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

describe('Bucket CRUD (e2e, TEST-0113)', () => {
  let app: SpawnedApp;
  const bucket = 'crud-test-bucket';

  beforeAll(async () => {
    app = await spawnApp(PORT);
  }, 40_000);

  afterAll(async () => {
    app?.kill('SIGKILL');
    await app?.waitForExit();
  });

  it('CreateBucket → 200 with Location header', async () => {
    const res = await signed('PUT', `/${bucket}`);
    expect(res.status).toBe(200);
    expect(res.headers['location']).toBe(`/${bucket}`);
  });

  it('CreateBucket again → 409 BucketAlreadyOwnedByYou', async () => {
    const res = await signed('PUT', `/${bucket}`);
    expect(res.status).toBe(409);
    expect(res.body).toContain('<Code>BucketAlreadyOwnedByYou</Code>');
  });

  it('HeadBucket → 200 (no body)', async () => {
    const res = await signed('HEAD', `/${bucket}`);
    expect(res.status).toBe(200);
    expect(res.body).toBe('');
  });

  it('ListBuckets includes the new bucket', async () => {
    const res = await signed('GET', '/');
    expect(res.status).toBe(200);
    expect(res.body).toContain(`<Name>${bucket}</Name>`);
  });

  it('GetBucketLocation → us-east-1', async () => {
    const res = await signed('GET', `/${bucket}?location`);
    expect(res.status).toBe(200);
    expect(res.body).toContain(
      '<LocationConstraint xmlns="http://s3.amazonaws.com/doc/2006-03-01/">us-east-1</LocationConstraint>',
    );
  });

  it('ListObjectsV1 on an empty bucket → ListBucketResult, not truncated', async () => {
    const res = await signed('GET', `/${bucket}`);
    expect(res.status).toBe(200);
    expect(res.body).toContain('<ListBucketResult');
    expect(res.body).toContain(`<Name>${bucket}</Name>`);
    expect(res.body).toContain('<IsTruncated>false</IsTruncated>');
  });

  it('GetBucketAccelerateConfiguration stub → Suspended', async () => {
    const res = await signed('GET', `/${bucket}?accelerate`);
    expect(res.status).toBe(200);
    expect(res.body).toContain('<Status>Suspended</Status>');
  });

  it('HeadBucket on a missing bucket → 404', async () => {
    const res = await signed('HEAD', '/no-such-bucket-here');
    expect(res.status).toBe(404);
  });

  it('DeleteBucket on the empty bucket → 204, then HeadBucket → 404', async () => {
    const del = await signed('DELETE', `/${bucket}`);
    expect(del.status).toBe(204);
    const head = await signed('HEAD', `/${bucket}`);
    expect(head.status).toBe(404);
  });
});
