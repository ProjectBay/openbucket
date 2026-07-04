import { request as httpRequest } from 'node:http';
import { PassThrough } from 'node:stream';
import * as argon2 from 'argon2';
import * as aws4 from 'aws4';
import * as archiver from 'archiver';

import { SpawnedApp, spawnApp } from './support/spawn-app';

/**
 * Admin backup & restore, end-to-end (§5.x).
 *
 * Seeds objects through the SigV4 S3 API, then exercises the admin backup/restore
 * endpoints for BOTH scopes:
 *   - single bucket: download a .zip, restore it into a fresh bucket (byte-exact),
 *   - whole instance: snapshot, mutate state, restore → the instance is reset to
 *     the snapshot (the extra bucket is gone; the originals are intact).
 */
const PORT = 9268;
const PASSWORD = 'correct-horse-battery-staple';
const S3_CREDS = { accessKeyId: 'AKIA1234567890ABCD', secretAccessKey: 'e2eRootSecretAccessKey9f3a7c1e5b2d08X6Yk' };

interface Res {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function http(method: string, path: string, opts: { body?: unknown; bearer?: string } = {}): Promise<Res> {
  const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
  const headers: Record<string, string | number> = {};
  if (data !== undefined) {
    headers['content-type'] = 'application/json';
    headers['content-length'] = Buffer.byteLength(data);
  }
  if (opts.bearer) headers['authorization'] = `Bearer ${opts.bearer}`;
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port: PORT, path, method, headers }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: buf }));
    });
    req.on('error', reject);
    if (data !== undefined) req.write(data);
    req.end();
  });
}

/** GET returning the raw response bytes (for the .zip download). */
function getBinary(path: string, bearer: string): Promise<{ status: number; ct?: string; buf: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { hostname: '127.0.0.1', port: PORT, path, method: 'GET', headers: { authorization: `Bearer ${bearer}` } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c as Buffer));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, ct: res.headers['content-type'] as string, buf: Buffer.concat(chunks) }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/** Send a binary body (the .zip) on a restore POST. */
function sendBinary(method: string, path: string, body: Buffer, bearer: string): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port: PORT,
        path,
        method,
        headers: { 'content-type': 'application/zip', 'content-length': body.length, authorization: `Bearer ${bearer}` },
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: buf }));
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function s3(method: string, path: string, body?: string): Promise<Res> {
  const opts: aws4.Request = {
    host: `127.0.0.1:${PORT}`,
    method,
    path,
    service: 's3',
    region: 'us-east-1',
    headers: body !== undefined ? { 'content-type': 'text/plain' } : {},
    body,
  };
  aws4.sign(opts, S3_CREDS);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port: PORT, method, path, headers: opts.headers }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: buf }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

/** Build an in-memory .zip from [name, content] entries (for hostile archives). */
function buildZip(entries: Array<[string, string]>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const a = archiver('zip');
    const chunks: Buffer[] = [];
    const pt = new PassThrough();
    pt.on('data', (c) => chunks.push(c as Buffer));
    pt.on('end', () => resolve(Buffer.concat(chunks)));
    a.on('error', reject);
    a.pipe(pt);
    for (const [name, content] of entries) a.append(content, { name });
    void a.finalize();
  });
}

const keys = (b: string) =>
  http('GET', `/api/admin/buckets/${b}/objects`, { bearer }).then((r) =>
    (JSON.parse(r.body).contents as { key: string }[]).map((o) => o.key).sort(),
  );

let app: SpawnedApp;
let bearer: string;

describe('Admin backup & restore (e2e)', () => {
  beforeAll(async () => {
    const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    app = await spawnApp(PORT, { ADMIN_PASSWORD_HASH: hash });
    bearer = JSON.parse(
      (await http('POST', '/api/admin/auth/login', { body: { username: 'admin', password: PASSWORD } })).body,
    ).accessToken;

    expect((await http('POST', '/api/admin/buckets', { body: { name: 'src' }, bearer })).status).toBe(201);
    expect((await s3('PUT', '/src/a.txt', 'aaa')).status).toBe(200);
    expect((await s3('PUT', '/src/folder/b.txt', 'bbbb')).status).toBe(200);
    expect((await s3('PUT', '/src/folder/sub/c.txt', 'ccccc')).status).toBe(200);
  }, 60_000);

  afterAll(async () => {
    app?.kill('SIGKILL');
    await app?.waitForExit();
  });

  it('single-bucket: backup downloads a .zip and restores byte-exact into a fresh bucket', async () => {
    const backup = await getBinary('/api/admin/buckets/src/backup', bearer);
    expect(backup.status).toBe(200);
    expect(backup.ct).toContain('application/zip');
    expect(backup.buf.length).toBeGreaterThan(0);
    expect(backup.buf.subarray(0, 2).toString('latin1')).toBe('PK'); // zip local-file header

    // Restore that backup into a NEW bucket (the service remaps src → dst).
    const restore = await sendBinary('POST', '/api/admin/buckets/dst/restore', backup.buf, bearer);
    expect([200, 201]).toContain(restore.status);
    expect(JSON.parse(restore.body).objectsRestored).toBe(3);

    expect(await keys('dst')).toEqual(['a.txt', 'folder/b.txt', 'folder/sub/c.txt']);
    // Byte-exact: read a restored object back through the S3 API.
    const got = await s3('GET', '/dst/folder/sub/c.txt');
    expect(got.status).toBe(200);
    expect(got.body).toBe('ccccc');
  }, 60_000);

  it('single-bucket restore RESETS the target (pre-existing objects are erased)', async () => {
    // Put a stray object into dst, then restore src's backup → stray must vanish.
    expect((await s3('PUT', '/dst/stray.txt', 'zzz')).status).toBe(200);
    expect(await keys('dst')).toContain('stray.txt');

    const backup = await getBinary('/api/admin/buckets/src/backup', bearer);
    const restore = await sendBinary('POST', '/api/admin/buckets/dst/restore', backup.buf, bearer);
    expect([200, 201]).toContain(restore.status);

    expect(await keys('dst')).toEqual(['a.txt', 'folder/b.txt', 'folder/sub/c.txt']); // stray gone
  }, 60_000);

  it('whole-instance: snapshot → mutate → restore resets the instance to the snapshot', async () => {
    const snapshot = await getBinary('/api/admin/backup', bearer);
    expect(snapshot.status).toBe(200);
    expect(snapshot.buf.subarray(0, 2).toString('latin1')).toBe('PK');

    // Mutate: a whole new bucket that the snapshot does not know about.
    expect((await http('POST', '/api/admin/buckets', { body: { name: 'scratch' }, bearer })).status).toBe(201);
    expect((await s3('PUT', '/scratch/junk.txt', 'junk')).status).toBe(200);
    expect(
      (JSON.parse((await http('GET', '/api/admin/buckets', { bearer })).body).buckets as { name: string }[]).map(
        (b) => b.name,
      ),
    ).toContain('scratch');

    // Restore the snapshot → the instance is reset to it.
    const restore = await sendBinary('POST', '/api/admin/restore', snapshot.buf, bearer);
    expect([200, 201]).toContain(restore.status);
    const summary = JSON.parse(restore.body);
    expect(summary.objectsRestored).toBeGreaterThanOrEqual(3);

    const names = (JSON.parse((await http('GET', '/api/admin/buckets', { bearer })).body).buckets as { name: string }[])
      .map((b) => b.name)
      .sort();
    expect(names).not.toContain('scratch'); // the mutation was rolled back
    expect(names).toContain('src');
    expect(await keys('src')).toEqual(['a.txt', 'folder/b.txt', 'folder/sub/c.txt']); // originals intact
  }, 60_000);

  it('rejects a hostile / unreadable archive with 400 (Zip Slip guard + parse errors)', async () => {
    // Not a zip at all → 400, never 500.
    const garbage = await sendBinary('POST', '/api/admin/buckets/dst/restore', Buffer.from('this is not a zip'), bearer);
    expect(garbage.status).toBe(400);

    // Hostile entry names (invalid bucket, path traversal) → 400; nothing escapes.
    const manifest = JSON.stringify({
      version: 1,
      kind: 'bucket',
      createdAt: 'x',
      buckets: [{ name: 'src', versioning: 'disabled', objectLock: false, region: 'us-east-1' }],
      objects: [],
    });
    for (const bad of ['data/Evil/x.txt', 'data/../evil.txt', 'data/src/../../../evil.txt']) {
      const zip = await buildZip([['manifest.json', manifest], [bad, 'pwned']]);
      const res = await sendBinary('POST', '/api/admin/buckets/dst/restore', zip, bearer);
      expect(res.status).toBe(400);
    }
  }, 60_000);
});
