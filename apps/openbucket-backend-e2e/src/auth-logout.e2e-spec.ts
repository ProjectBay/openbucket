import { request as httpRequest } from 'node:http';
import * as argon2 from 'argon2';

import { SpawnedApp, spawnApp } from './support/spawn-app';

/**
 * TEST-0406 — Logout endpoint, end-to-end against the built app (§5.2.4).
 *
 * Verifies POST /api/admin/auth/logout revokes the refresh token, clears the
 * cookie, requires a bearer (it is NOT @Public), emits admin.logout, and is
 * idempotent.
 */
const PORT = 9249;
const PASSWORD = 'correct-horse-battery-staple';

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

function refreshCookieValue(res: Res): string {
  const setCookie = (res.headers['set-cookie'] as string[])[0];
  return setCookie.match(/ob_refresh=([^;]+)/)![1];
}

async function login(ip: string): Promise<{ bearer: string; cookie: string }> {
  const res = await send('/api/admin/auth/login', { body: { username: 'admin', password: PASSWORD }, ip });
  if (res.status !== 200) throw new Error(`login failed (${res.status}): ${res.body}`);
  return { bearer: JSON.parse(res.body).accessToken, cookie: `ob_refresh=${refreshCookieValue(res)}` };
}

async function waitForLogLine(getLog: () => string, needle: string, timeoutMs = 4000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const line = getLog().split('\n').find((l) => l.includes(needle));
    if (line) return line;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`log line containing ${needle} not found:\n${getLog()}`);
}

describe('Logout endpoint (e2e, TEST-0406)', () => {
  let app: SpawnedApp;

  beforeAll(async () => {
    const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    app = await spawnApp(PORT, { ADMIN_PASSWORD_HASH: hash });
  }, 40_000);

  afterAll(async () => {
    app?.kill('SIGKILL');
    await app?.waitForExit();
  });

  it('case 1: bearer + cookie → 204 and the ob_refresh cookie is cleared', async () => {
    const { bearer, cookie } = await login('10.3.0.1');
    const res = await send('/api/admin/auth/logout', { bearer, cookie });

    expect(res.status).toBe(204);
    expect(res.body).toBe('');
    const setCookie = (res.headers['set-cookie'] as string[])[0];
    expect(setCookie).toMatch(/^ob_refresh=;/); // empty value
    expect(setCookie).toContain('Path=/api/admin/auth');
  });

  it('case 2: refreshing the logged-out cookie → 401 revoked', async () => {
    const { bearer, cookie } = await login('10.3.0.2');
    await send('/api/admin/auth/logout', { bearer, cookie });

    const res = await send('/api/admin/auth/refresh', { cookie });
    expect(res.status).toBe(401);
    expect(res.body).toContain('revoked');
  });

  it('case 3: logout without a bearer → 401 (JwtAuthGuard rejects)', async () => {
    const { cookie } = await login('10.3.0.3');
    const res = await send('/api/admin/auth/logout', { cookie }); // no bearer
    expect(res.status).toBe(401);
  });

  it('case 4: logout twice with the same cookie → both 204 (idempotent)', async () => {
    const { bearer, cookie } = await login('10.3.0.4');
    const first = await send('/api/admin/auth/logout', { bearer, cookie });
    const second = await send('/api/admin/auth/logout', { bearer, cookie });
    expect(first.status).toBe(204);
    expect(second.status).toBe(204);
  });

  it('case 5: logout emits a structured admin.logout audit line', async () => {
    const { bearer, cookie } = await login('10.3.0.5');
    await send('/api/admin/auth/logout', { bearer, cookie });

    const line = await waitForLogLine(() => app.log(), '"event":"admin.logout"');
    expect(line).toContain('"subject":"admin"');
    expect(line).toContain('"audit":true');
  });
});
