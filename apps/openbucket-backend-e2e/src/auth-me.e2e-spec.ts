import { request as httpRequest } from 'node:http';
import { createHmac } from 'node:crypto';
import * as argon2 from 'argon2';

import { SpawnedApp, spawnApp } from './support/spawn-app';

/**
 * TEST-0407 — /me endpoint, end-to-end against the built app (§5.2.4).
 *
 * Verifies GET /api/admin/auth/me echoes the verified JWT claims and requires a
 * valid bearer. The mustChangePassword case mints a token carrying the flag —
 * proving /me reads the JWT, not the DB (the env-seeded admin is false).
 */
const PORT = 9251;
const PASSWORD = 'correct-horse-battery-staple';
const JWT_SECRET = 'e2eJwtSigningSecret4b8d2f6a0c9e1573A6Ykp'; // matches spawn-app's validEnv default

interface Res {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function http(
  method: string,
  path: string,
  opts: { headers?: Record<string, string>; body?: unknown } = {},
): Promise<Res> {
  const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
  const headers: Record<string, string | number> = { ...opts.headers };
  if (data !== undefined) {
    headers['content-type'] = 'application/json';
    headers['content-length'] = Buffer.byteLength(data);
  }
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

const getMe = (bearer?: string): Promise<Res> =>
  http('GET', '/api/admin/auth/me', bearer ? { headers: { authorization: `Bearer ${bearer}` } } : {});

function signJwt(payload: Record<string, unknown>, secret = JWT_SECRET): string {
  const enc = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');
  const data = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(payload)}`;
  const sig = createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function adminPayload(over: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: 'admin',
    username: 'admin',
    mustChangePassword: false,
    iss: 'openbucket',
    aud: 'openbucket-admin',
    iat: now,
    exp: now + 3600,
    ...over,
  };
}

async function login(ip: string): Promise<string> {
  const res = await http('POST', '/api/admin/auth/login', {
    body: { username: 'admin', password: PASSWORD },
    headers: { 'x-forwarded-for': ip },
  });
  if (res.status !== 200) throw new Error(`login failed (${res.status}): ${res.body}`);
  return JSON.parse(res.body).accessToken;
}

describe('Me endpoint (e2e, TEST-0407)', () => {
  let app: SpawnedApp;

  beforeAll(async () => {
    const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    app = await spawnApp(PORT, { ADMIN_PASSWORD_HASH: hash });
  }, 40_000);

  afterAll(async () => {
    app?.kill('SIGKILL');
    await app?.waitForExit();
  });

  it('case 1: valid bearer → 200 echoing the JWT identity', async () => {
    const bearer = await login('10.5.0.1');
    const res = await getMe(bearer);

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      id: 'admin',
      username: 'admin',
      mustChangePassword: false,
    });
  });

  it('case 2: no bearer → 401 missing bearer', async () => {
    const res = await getMe();
    expect(res.status).toBe(401);
    expect(res.body).toContain('missing bearer');
  });

  it('case 3: non-Bearer Authorization header → 401', async () => {
    const res = await http('GET', '/api/admin/auth/me', { headers: { authorization: 'Token abc' } });
    expect(res.status).toBe(401);
  });

  it('case 4: bearer with an invalid signature → 401 invalid token', async () => {
    const forged = signJwt(adminPayload(), 'not-the-real-secret-' + 'x'.repeat(20));
    const res = await getMe(forged);
    expect(res.status).toBe(401);
    expect(res.body).toContain('invalid token');
  });

  it('case 5: mustChangePassword is sourced from the JWT (not the DB)', async () => {
    const token = signJwt(adminPayload({ mustChangePassword: true }));
    const res = await getMe(token);

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).mustChangePassword).toBe(true);
  });
});
