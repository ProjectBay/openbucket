import { request as httpRequest } from 'node:http';
import * as argon2 from 'argon2';
import * as aws4 from 'aws4';

import { SpawnedApp, spawnApp } from './support/spawn-app';

/**
 * TEST-0411 — Admin bucket endpoints, end-to-end (§5.5).
 *
 * Drives /api/admin/buckets with a real bearer. The non-empty delete case PUTs a
 * real object through the SigV4-signed S3 API (root creds from validEnv) so the
 * BucketNotEmpty (409) mapping in the AdminExceptionFilter is exercised.
 *
 * Note: cases 2 & 4 assert 400 (the test plan said 422) — validation errors are
 * 400 `ValidationFailed` per WHITEPAPER §1.6.2 / AdminExceptionFilter.
 */
const PORT = 9255;
const PASSWORD = 'correct-horse-battery-staple';
const S3_CREDS = { accessKeyId: 'AKIA1234567890ABCD', secretAccessKey: 'x'.repeat(40) };

interface Res {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function http(
  method: string,
  path: string,
  opts: { body?: unknown; bearer?: string; ip?: string } = {},
): Promise<Res> {
  const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
  const headers: Record<string, string | number> = {};
  if (data !== undefined) {
    headers['content-type'] = 'application/json';
    headers['content-length'] = Buffer.byteLength(data);
  }
  if (opts.bearer) headers['authorization'] = `Bearer ${opts.bearer}`;
  if (opts.ip) headers['x-forwarded-for'] = opts.ip;
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

/** SigV4-signed S3 request over raw http (used to seed an object). */
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
    const req = httpRequest(
      { hostname: '127.0.0.1', port: PORT, method, path, headers: opts.headers },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: buf }));
      },
    );
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

async function login(ip: string): Promise<string> {
  const res = await http('POST', '/api/admin/auth/login', {
    body: { username: 'admin', password: PASSWORD },
    ip,
  });
  if (res.status !== 200) throw new Error(`login failed (${res.status}): ${res.body}`);
  return JSON.parse(res.body).accessToken;
}

const hasLine = (log: string, ...needles: string[]): boolean =>
  log.split('\n').some((l) => needles.every((n) => l.includes(n)));

async function waitForLine(getLog: () => string, ...needles: string[]): Promise<boolean> {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    if (hasLine(getLog(), ...needles)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

describe('Admin bucket endpoints (e2e, TEST-0411)', () => {
  let app: SpawnedApp;
  let bearer: string;

  beforeAll(async () => {
    const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    app = await spawnApp(PORT, { ADMIN_PASSWORD_HASH: hash });
    bearer = await login('10.7.0.1');
  }, 40_000);

  afterAll(async () => {
    app?.kill('SIGKILL');
    await app?.waitForExit();
  });

  it('case 3: POST without bearer → 401', async () => {
    const res = await http('POST', '/api/admin/buckets', { body: { name: 'foo' } });
    expect(res.status).toBe(401);
  });

  it('case 2: POST an uppercase name → 400 (regex)', async () => {
    const res = await http('POST', '/api/admin/buckets', { body: { name: 'BAD' }, bearer });
    expect(res.status).toBe(400);
    expect(res.body).toContain('ValidationFailed');
  });

  it('case 4: POST with an unknown field → 400 (.strict())', async () => {
    const res = await http('POST', '/api/admin/buckets', {
      body: { name: 'foo', unknownField: true },
      bearer,
    });
    expect(res.status).toBe(400);
  });

  it('case 6: GET a missing bucket → 404', async () => {
    const res = await http('GET', '/api/admin/buckets/missing', { bearer });
    expect(res.status).toBe(404);
    expect(res.body).toContain('bucket missing not found');
  });

  it('case 1: POST { name: foo } → 201 with a zeroed summary', async () => {
    const res = await http('POST', '/api/admin/buckets', { body: { name: 'foo' }, bearer });
    expect(res.status).toBe(201);
    expect(JSON.parse(res.body)).toMatchObject({
      name: 'foo',
      versioning: 'disabled',
      objectLock: false,
      objectCount: 0,
      sizeBytes: 0,
    });
  });

  it('case 5: GET / → 200 with total 1 and foo', async () => {
    const res = await http('GET', '/api/admin/buckets', { bearer });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.total).toBe(1);
    expect(body.buckets[0].name).toBe('foo');
  });

  it('case 8: DELETE a non-empty bucket → 409 BucketNotEmpty', async () => {
    expect((await http('POST', '/api/admin/buckets', { body: { name: 'nonempty' }, bearer })).status).toBe(201);
    expect((await s3('PUT', '/nonempty/file.txt', 'hello')).status).toBe(200);

    const res = await http('DELETE', '/api/admin/buckets/nonempty', { bearer });
    expect(res.status).toBe(409);
    expect(res.body).toContain('BucketNotEmpty');
  });

  it('case 7: DELETE an empty bucket → 204, then GET → 404', async () => {
    expect((await http('DELETE', '/api/admin/buckets/foo', { bearer })).status).toBe(204);
    expect((await http('GET', '/api/admin/buckets/foo', { bearer })).status).toBe(404);
  });

  it('case 10: audit lines emitted for bucket.created and bucket.deleted', async () => {
    expect(await waitForLine(() => app.log(), '"event":"bucket.created"', '"bucket":"foo"', '"subject":"admin"')).toBe(true);
    expect(await waitForLine(() => app.log(), '"event":"bucket.deleted"', '"bucket":"foo"', '"subject":"admin"')).toBe(true);
    // requestId is carried on the audit record.
    expect(hasLine(app.log(), '"event":"bucket.created"', '"requestId":"')).toBe(true);
  });

  it.todo('case 9: OpenAPI operationIds — deferred until Swagger (@nestjs/swagger) is wired');
});
