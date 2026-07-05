import { request as httpRequest } from 'node:http';
import * as argon2 from 'argon2';

import { SpawnedApp, spawnApp } from './support/spawn-app';

/**
 * TASK-1551 — the canonical e2e-test sample (WHITEPAPER §5.20.2, TEST-0503).
 *
 * Demonstrates the project's e2e convention end-to-end: spawn the **built**
 * backend (`dist/.../main.js`) as a child process via `spawnApp`, seed a real
 * argon2id `ADMIN_PASSWORD_HASH` for a known password, and drive the admin auth
 * surface over real HTTP. This is the pattern every `*.e2e-spec.ts` in this
 * suite follows — note the deviation from the white paper's idealized snippet,
 * which booted `AppModule` in-process with supertest; here we exercise the
 * compiled artifact instead, and `spawnApp`'s `validEnv` provides an ephemeral
 * per-process `DATA_DIR` (no fixture cleanup, no hard-coded path).
 *
 * Production-grade coverage of each path lives in the focused specs
 * (`auth-login`, `auth-refresh`, `auth-refresh-rotation`, `auth-me`); this file
 * is the minimal copy-me exemplar that ties login + refresh + reuse + a
 * bearer-protected read into one readable flow.
 */
const PORT = 9260;
const PASSWORD = 'correct horse battery staple';

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

/** Extract the ob_refresh cookie value from a Set-Cookie response. */
const refreshCookie = (res: Res): string =>
  (res.headers['set-cookie'] as string[])[0].match(/ob_refresh=([^;]+)/)![1];

describe('admin auth (e2e, TASK-1551 / TEST-0503)', () => {
  let app: SpawnedApp;

  beforeAll(async () => {
    const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    app = await spawnApp(PORT, { ADMIN_PASSWORD_HASH: hash });
  }, 40_000);

  afterAll(async () => {
    app?.kill('SIGKILL');
    await app?.waitForExit();
  });

  it('logs in, issues a hardened refresh cookie, refreshes, then rejects reuse', async () => {
    // 1) Login → access token + hardened ob_refresh cookie.
    const login = await http('POST', '/api/admin/auth/login', {
      body: { username: 'admin', password: PASSWORD },
      headers: { 'x-forwarded-for': '10.6.0.1' },
    });
    expect(login.status).toBe(200);
    expect(JSON.parse(login.body).accessToken).toBeTruthy();

    const setCookie = (login.headers['set-cookie'] as string[])[0];
    expect(setCookie).toMatch(/ob_refresh=/);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toMatch(/SameSite=Strict/i);
    expect(setCookie).toContain('Path=/api/admin/auth');
    const original = refreshCookie(login);

    // 2) Refresh rotates the token.
    const refresh1 = await http('POST', '/api/admin/auth/refresh', {
      headers: { cookie: `ob_refresh=${original}` },
    });
    expect(refresh1.status).toBe(200);
    const rotated = refreshCookie(refresh1);
    expect(rotated).not.toBe(original);

    // 3) Replaying the original (now-rotated) token is theft → 401, chain revoked.
    const reuse = await http('POST', '/api/admin/auth/refresh', {
      headers: { cookie: `ob_refresh=${original}` },
    });
    expect(reuse.status).toBe(401);

    // 4) The descendant minted at step 2 is revoked by the reuse detection.
    const descendant = await http('POST', '/api/admin/auth/refresh', {
      headers: { cookie: `ob_refresh=${rotated}` },
    });
    expect(descendant.status).toBe(401);
  });

  it('protects /me — 401 without a bearer, 200 echoing the identity with one', async () => {
    const anon = await http('GET', '/api/admin/auth/me');
    expect(anon.status).toBe(401);

    const login = await http('POST', '/api/admin/auth/login', {
      body: { username: 'admin', password: PASSWORD },
      headers: { 'x-forwarded-for': '10.6.0.2' },
    });
    const bearer = JSON.parse(login.body).accessToken as string;

    const me = await http('GET', '/api/admin/auth/me', { headers: { authorization: `Bearer ${bearer}` } });
    expect(me.status).toBe(200);
    expect(JSON.parse(me.body)).toEqual({ id: 'admin', username: 'admin', mustChangePassword: false, role: 'admin' });
  });
});
