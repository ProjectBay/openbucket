import { request as httpRequest } from 'node:http';
import * as argon2 from 'argon2';

import { SpawnedApp, spawnApp } from './support/spawn-app';

/**
 * TEST-0403 — Refresh-token rotation and reuse-revocation, end-to-end (§5.2.3/§5.2.4).
 *
 * The security-critical path: every refresh issues a new token; replaying a
 * rotated token is treated as theft and revokes the whole chain; logout revokes;
 * expiry is enforced. Booted in OPENBUCKET_TEST_MODE so the expiry case can
 * fast-forward the injected Clock past the 7-day TTL via /_test/advance-clock —
 * that case runs LAST because the jump is global to the TestClock.
 */
const PORT = 9247;
const PASSWORD = 'correct-horse-battery-staple';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface Res {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function send(
  path: string,
  opts: { body?: unknown; cookie?: string; bearer?: string; ip?: string } = {},
): Promise<Res> {
  const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
  const headers: Record<string, string | number> = {};
  if (data !== undefined) {
    headers['content-type'] = 'application/json';
    headers['content-length'] = Buffer.byteLength(data);
  }
  if (opts.cookie) headers['cookie'] = opts.cookie;
  if (opts.bearer) headers['authorization'] = `Bearer ${opts.bearer}`;
  if (opts.ip) headers['x-forwarded-for'] = opts.ip;
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { hostname: '127.0.0.1', port: PORT, path, method: 'POST', headers },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: buf }));
      },
    );
    req.on('error', reject);
    if (data !== undefined) req.write(data);
    req.end();
  });
}

const cookieValue = (res: Res): string =>
  (res.headers['set-cookie'] as string[])[0].match(/ob_refresh=([^;]+)/)![1];

async function login(ip: string): Promise<{ bearer: string; value: string; res: Res }> {
  const res = await send('/api/admin/auth/login', { body: { username: 'admin', password: PASSWORD }, ip });
  if (res.status !== 200) throw new Error(`login failed (${res.status}): ${res.body}`);
  return { bearer: JSON.parse(res.body).accessToken, value: cookieValue(res), res };
}

const refresh = (value: string): Promise<Res> =>
  send('/api/admin/auth/refresh', { cookie: `ob_refresh=${value}` });

const logout = (value: string, bearer: string): Promise<Res> =>
  send('/api/admin/auth/logout', { cookie: `ob_refresh=${value}`, bearer });

const advanceClock = (ms: number): Promise<Res> =>
  send('/api/admin/_test/advance-clock', { body: { ms } });

function assertHardenedCookie(res: Res): void {
  const setCookie = (res.headers['set-cookie'] as string[])[0];
  expect(setCookie).toContain('HttpOnly');
  expect(setCookie).toContain('Secure');
  expect(setCookie).toMatch(/SameSite=Strict/i);
  expect(setCookie).toContain('Path=/api/admin/auth');
}

describe('Refresh rotation & reuse revocation (e2e, TEST-0403)', () => {
  let app: SpawnedApp;

  beforeAll(async () => {
    const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    app = await spawnApp(PORT, { ADMIN_PASSWORD_HASH: hash, OPENBUCKET_TEST_MODE: '1' });
  }, 40_000);

  afterAll(async () => {
    app?.kill('SIGKILL');
    await app?.waitForExit();
  });

  it('case 1: every refresh rotates the token (A → B → C, all distinct)', async () => {
    const a = await login('10.4.0.1');
    const r1 = await refresh(a.value);
    expect(r1.status).toBe(200);
    const b = cookieValue(r1);
    expect(b).not.toBe(a.value);

    const r2 = await refresh(b);
    expect(r2.status).toBe(200);
    const c = cookieValue(r2);
    expect(c).not.toBe(b);
  });

  it('case 2: replaying a rotated token is detected and revokes the chain', async () => {
    const a = await login('10.4.0.2');
    const b = cookieValue(await refresh(a.value)); // A rotated → B

    const reuse = await refresh(a.value); // replay A
    expect(reuse.status).toBe(401);
    expect(reuse.body).toContain('token reuse detected');

    const afterReuse = await refresh(b); // B was a descendant → revoked
    expect(afterReuse.status).toBe(401);
    expect(afterReuse.body).toContain('revoked');
  });

  it('case 4: logout revokes the refresh token', async () => {
    const a = await login('10.4.0.4');
    expect((await logout(a.value, a.bearer)).status).toBe(204);

    const res = await refresh(a.value);
    expect(res.status).toBe(401);
    expect(res.body).toContain('revoked');
  });

  it('case 5: login and refresh both set a hardened ob_refresh cookie', async () => {
    const a = await login('10.4.0.5');
    assertHardenedCookie(a.res);
    assertHardenedCookie(await refresh(a.value));
  });

  // LAST: advancing the TestClock past the TTL is global, so keep it after the
  // cases above (whose tokens must still be within their 7-day window).
  it('case 3: a token past its TTL is rejected as expired', async () => {
    const a = await login('10.4.0.3');
    const adv = await advanceClock(TTL_MS + 2000); // 7d + 2s
    expect(adv.status).toBe(200);

    const res = await refresh(a.value);
    expect(res.status).toBe(401);
    expect(res.body).toContain('expired');
  });
});
