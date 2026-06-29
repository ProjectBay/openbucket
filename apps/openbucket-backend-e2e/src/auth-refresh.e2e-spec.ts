import { request as httpRequest } from 'node:http';
import { randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';

import { SpawnedApp, spawnApp } from './support/spawn-app';

/**
 * TEST-0405 — Refresh endpoint, end-to-end against the built app (§5.2.4).
 *
 * Verifies that POST /api/admin/auth/refresh reads the ob_refresh cookie, issues
 * a new access token, rotates the cookie value, and rejects missing / unknown
 * tokens. Rotation/reuse correctness is covered separately by TEST-0403.
 */
const PORT = 9245;
const PASSWORD = 'correct-horse-battery-staple';

interface Res {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function post(path: string, opts: { body?: unknown; cookie?: string; ip?: string } = {}): Promise<Res> {
  const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
  const headers: Record<string, string | number> = {};
  if (data !== undefined) {
    headers['content-type'] = 'application/json';
    headers['content-length'] = Buffer.byteLength(data);
  }
  if (opts.cookie) headers['cookie'] = opts.cookie;
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
  const setCookie = (res.headers['set-cookie'] as string[] | undefined)?.[0] ?? '';
  const m = setCookie.match(/ob_refresh=([^;]+)/);
  if (!m) throw new Error(`no ob_refresh in Set-Cookie: ${setCookie}`);
  return m[1];
}

async function login(ip: string): Promise<{ cookieValue: string; setCookie: string }> {
  const res = await post('/api/admin/auth/login', { body: { username: 'admin', password: PASSWORD }, ip });
  if (res.status !== 200) throw new Error(`login failed (${res.status}): ${res.body}`);
  return { cookieValue: refreshCookieValue(res), setCookie: (res.headers['set-cookie'] as string[])[0] };
}

const auditCount = (log: string): number => (log.match(/"audit":true/g) ?? []).length;

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('Refresh endpoint (e2e, TEST-0405)', () => {
  let app: SpawnedApp;

  beforeAll(async () => {
    const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    app = await spawnApp(PORT, { ADMIN_PASSWORD_HASH: hash });
  }, 40_000);

  afterAll(async () => {
    app?.kill('SIGKILL');
    await app?.waitForExit();
  });

  it('case 1: valid cookie → 200 with a new access token and a rotated cookie', async () => {
    const { cookieValue: a } = await login('10.2.0.1');
    const res = await post('/api/admin/auth/refresh', { cookie: `ob_refresh=${a}` });

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(typeof body.accessToken).toBe('string');
    expect(body.expiresIn).toBe(900);
    expect(refreshCookieValue(res)).not.toBe(a); // rotated
  });

  it('case 2: no cookie → 401 missing refresh', async () => {
    const res = await post('/api/admin/auth/refresh');
    expect(res.status).toBe(401);
    expect(res.body).toContain('missing refresh');
  });

  it('case 3: a syntactically valid but never-issued token → 401 invalid refresh', async () => {
    const bogus = randomBytes(32).toString('base64url');
    const res = await post('/api/admin/auth/refresh', { cookie: `ob_refresh=${bogus}` });
    expect(res.status).toBe(401);
    expect(res.body).toContain('invalid refresh');
  });

  it('case 4: rotated cookie carries the same hardened attributes as login', async () => {
    const { cookieValue: a } = await login('10.2.0.2');
    const res = await post('/api/admin/auth/refresh', { cookie: `ob_refresh=${a}` });
    const setCookie = (res.headers['set-cookie'] as string[])[0];

    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toMatch(/SameSite=Strict/i);
    expect(setCookie).toContain('Path=/api/admin/auth');
  });

  it('case 5: refresh emits no audit event (the §5.9 catalogue omits refresh)', async () => {
    const { cookieValue: a } = await login('10.2.0.3');
    // Wait for the login's own audit line to settle, then snapshot the count.
    await waitFor(() => app.log().includes('"ip":"10.2.0.3"'));
    const before = auditCount(app.log());

    await post('/api/admin/auth/refresh', { cookie: `ob_refresh=${a}` });
    await new Promise((r) => setTimeout(r, 300)); // give any stray log a chance to flush

    expect(auditCount(app.log())).toBe(before);
  });
});
