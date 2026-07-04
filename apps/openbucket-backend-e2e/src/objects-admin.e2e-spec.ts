import { request as httpRequest } from 'node:http';
import * as argon2 from 'argon2';
import * as aws4 from 'aws4';

import { SpawnedApp, spawnApp } from './support/spawn-app';

/**
 * TEST-0413 — Admin object browser endpoints, end-to-end (§5.6).
 *
 * Objects are seeded through the SigV4-signed S3 API (literal-slash keys); the
 * admin browser then lists / heads / deletes them. The meta + delete cases use
 * %2F-encoded keys to exercise the single-decode of slash-bearing keys.
 */
const PORT = 9257;
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

function s3Put(path: string, body: string): Promise<Res> {
  const opts: aws4.Request = {
    host: `127.0.0.1:${PORT}`,
    method: 'PUT',
    path,
    service: 's3',
    region: 'us-east-1',
    headers: { 'content-type': 'text/plain' },
    body,
  };
  aws4.sign(opts, S3_CREDS);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { hostname: '127.0.0.1', port: PORT, method: 'PUT', path, headers: opts.headers },
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

async function waitForLine(getLog: () => string, ...needles: string[]): Promise<boolean> {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    if (getLog().split('\n').some((l) => needles.every((n) => l.includes(n)))) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

describe('Admin object browser (e2e, TEST-0413)', () => {
  let app: SpawnedApp;
  let bearer: string;

  beforeAll(async () => {
    const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    app = await spawnApp(PORT, { ADMIN_PASSWORD_HASH: hash });
    const login = await http('POST', '/api/admin/auth/login', {
      body: { username: 'admin', password: PASSWORD },
    });
    bearer = JSON.parse(login.body).accessToken;

    expect((await http('POST', '/api/admin/buckets', { body: { name: 'objbkt' }, bearer })).status).toBe(201);
    expect((await s3Put('/objbkt/a.txt', 'aaa')).status).toBe(200);
    expect((await s3Put('/objbkt/folder/b.txt', 'bbbb')).status).toBe(200);
    expect((await s3Put('/objbkt/folder/sub/c.txt', 'ccccc')).status).toBe(200);
  }, 60_000);

  afterAll(async () => {
    app?.kill('SIGKILL');
    await app?.waitForExit();
  });

  it('case 1: list all → 3 objects, no commonPrefixes', async () => {
    const res = await http('GET', '/api/admin/buckets/objbkt/objects', { bearer });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.contents.map((o: { key: string }) => o.key).sort()).toEqual([
      'a.txt',
      'folder/b.txt',
      'folder/sub/c.txt',
    ]);
    expect(body.commonPrefixes).toEqual([]);
  });

  it('case 2: delimiter=/ → commonPrefixes [folder/], contents [a.txt]', async () => {
    const res = await http('GET', '/api/admin/buckets/objbkt/objects?delimiter=%2F', { bearer });
    const body = JSON.parse(res.body);
    expect(body.commonPrefixes).toEqual(['folder/']);
    expect(body.contents.map((o: { key: string }) => o.key)).toEqual(['a.txt']);
  });

  it('case 3: prefix=folder/&delimiter=/ → commonPrefixes [folder/sub/], contents [folder/b.txt]', async () => {
    const res = await http('GET', '/api/admin/buckets/objbkt/objects?prefix=folder%2F&delimiter=%2F', { bearer });
    const body = JSON.parse(res.body);
    expect(body.commonPrefixes).toEqual(['folder/sub/']);
    expect(body.contents.map((o: { key: string }) => o.key)).toEqual(['folder/b.txt']);
  });

  it('case 4: limit=1 → isTruncated true with a nextMarker', async () => {
    const res = await http('GET', '/api/admin/buckets/objbkt/objects?limit=1', { bearer });
    const body = JSON.parse(res.body);
    expect(body.isTruncated).toBe(true);
    expect(typeof body.nextMarker).toBe('string');
    expect(body.nextMarker.length).toBeGreaterThan(0);
  });

  it('case 5: meta with a %2F-encoded key → 200 with the decoded key', async () => {
    const res = await http('GET', '/api/admin/buckets/objbkt/objects/folder%2Fb.txt/meta', { bearer });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.key).toBe('folder/b.txt');
    expect(body.size).toBe(4);
  });

  it('case 6: delete a %2F-encoded key → 204, then meta → 404', async () => {
    expect((await http('DELETE', '/api/admin/buckets/objbkt/objects/folder%2Fb.txt', { bearer })).status).toBe(204);
    expect((await http('GET', '/api/admin/buckets/objbkt/objects/folder%2Fb.txt/meta', { bearer })).status).toBe(404);
  });

  it('case 7: audit line for object.deleted with the decoded key', async () => {
    expect(
      await waitForLine(() => app.log(), '"event":"object.deleted"', '"key":"folder/b.txt"', '"subject":"admin"'),
    ).toBe(true);
  });

  it('case 8: without a bearer, the routes return 401', async () => {
    expect((await http('GET', '/api/admin/buckets/objbkt/objects')).status).toBe(401);
    expect((await http('GET', '/api/admin/buckets/objbkt/objects/a.txt/meta')).status).toBe(401);
    expect((await http('DELETE', '/api/admin/buckets/objbkt/objects/a.txt')).status).toBe(401);
  });
});
