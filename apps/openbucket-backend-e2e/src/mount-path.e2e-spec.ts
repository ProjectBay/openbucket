import { createHash } from 'node:crypto';
import { request } from 'node:http';
import * as aws4 from 'aws4';

import { SpawnedApp, spawnApp } from './support/spawn-app';

/**
 * MOUNT_PATH — the standalone server running under a subpath (behind a reverse
 * proxy at e.g. `https://example.com/storage/…`). Proves that with
 * `MOUNT_PATH=/storage` every surface moves under the prefix and stays correct:
 *
 * - the admin API is guarded at `<mountPath>/api/admin/*` (unauth → 401),
 * - the public health probe answers at `<mountPath>/api/admin/health`,
 * - path-style S3 (bucket + object PUT/GET) verifies SigV4 and resolves under
 *   the prefix (the client signs the full `/storage/...` path; the server
 *   verifies over the same path and the classifier strips `/storage` to route),
 * - nothing is left mounted at the bare root.
 *
 * A companion block asserts the UNSET default is byte-for-byte the old root
 * behaviour (no regression).
 */
const CREDS = {
  accessKeyId: 'AKIA1234567890ABCD',
  secretAccessKey: 'e2eRootSecretAccessKey9f3a7c1e5b2d08X6Yk',
};

interface Res {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/** Signed S3 request against `host` at the given (already mount-prefixed) `path`. */
function signed(
  host: string,
  port: number,
  method: string,
  path: string,
  body?: string,
): Promise<Res> {
  const opts: aws4.Request = {
    host,
    method,
    path,
    service: 's3',
    region: 'us-east-1',
    headers: {},
    body,
  };
  aws4.sign(opts, CREDS);
  const headers = opts.headers as Record<string, string>;
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, method, path, headers }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: buf }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

describe('MOUNT_PATH=/storage (e2e)', () => {
  const PORT = 9242;
  const HOST = `127.0.0.1:${PORT}`;
  let app: SpawnedApp;
  const bucket = 'mount-bucket';

  beforeAll(async () => {
    app = await spawnApp(PORT, { MOUNT_PATH: '/storage' });
  }, 40_000);

  afterAll(async () => {
    app?.kill('SIGKILL');
    await app?.waitForExit();
  });

  it('health probe answers under the mount', async () => {
    const res = await fetch(`${app.baseUrl}/storage/api/admin/health`);
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('ok');
  });

  it('guards the admin API under the mount — unauthenticated → 401', async () => {
    const res = await fetch(`${app.baseUrl}/storage/api/admin/buckets`);
    expect(res.status).toBe(401);
  });

  it('leaves nothing mounted at the bare root — /api/admin/health → 404', async () => {
    const res = await fetch(`${app.baseUrl}/api/admin/health`);
    expect(res.status).toBe(404);
  });

  it('serves path-style S3 under the mount: PUT bucket + object, GET object', async () => {
    const created = await signed(HOST, PORT, 'PUT', `/storage/${bucket}`);
    expect(created.status).toBe(200);

    const payload = 'hello under a mount';
    const md5 = createHash('md5').update(payload).digest('hex');
    const put = await signed(HOST, PORT, 'PUT', `/storage/${bucket}/greeting.txt`, payload);
    expect(put.status).toBe(200);
    // MD5 ETag proves the object landed through the full signed write path.
    expect(String(put.headers['etag'])).toContain(md5);

    const got = await signed(HOST, PORT, 'GET', `/storage/${bucket}/greeting.txt`);
    expect(got.status).toBe(200);
    expect(got.body).toBe(payload);
  });

  it('does not serve S3 at the bare root under a mount (root PUT → not the store)', async () => {
    // The S3 tree is only mapped under `/storage`; a signed request to the root
    // bucket path matches no controller there → 404 (never a 2xx that would mean
    // the store answered off-prefix).
    const res = await signed(HOST, PORT, 'PUT', `/root-bucket`);
    expect(res.status).toBe(404);
  });

  it('does not 5xx the (unbundled) SPA path under the mount', async () => {
    // No dist/spa in the e2e build, so the shell isn't served — but the path must
    // resolve to a clean client status, never a crash. (Base-href rewrite under a
    // mount is covered by the library unit test.)
    const res = await fetch(`${app.baseUrl}/storage/admin/`);
    expect(res.status).toBeLessThan(500);
  });
});

describe('MOUNT_PATH unset — root behaviour unchanged (e2e)', () => {
  const PORT = 9243;
  let app: SpawnedApp;

  beforeAll(async () => {
    app = await spawnApp(PORT);
  }, 40_000);

  afterAll(async () => {
    app?.kill('SIGKILL');
    await app?.waitForExit();
  });

  it('health answers at the root', async () => {
    const res = await fetch(`${app.baseUrl}/api/admin/health`);
    expect(res.status).toBe(200);
  });

  it('admin API guarded at the root — unauthenticated → 401', async () => {
    const res = await fetch(`${app.baseUrl}/api/admin/buckets`);
    expect(res.status).toBe(401);
  });

  it('a `/storage/...` path is just an ordinary S3 bucket named "storage" (no prefix magic)', async () => {
    const res = await fetch(`${app.baseUrl}/storage/some/key`);
    // Unsigned → SigV4 rejects as S3 XML; the bucket is literally "storage".
    expect(res.headers.get('content-type')).toContain('application/xml');
    const xml = await res.text();
    expect(xml).toContain('<Resource>/storage/some/key</Resource>');
  });
});
