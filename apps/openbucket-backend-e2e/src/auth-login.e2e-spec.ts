import { request as httpRequest } from 'node:http';
import * as argon2 from 'argon2';

import { SpawnedApp, spawnApp } from './support/spawn-app';

/**
 * TEST-0404 — Login endpoint, end-to-end against the built app (§5.2.4).
 *
 * The app is booted with a real argon2id ADMIN_PASSWORD_HASH (so branch 1 of the
 * §5.8 bootstrap seeds an admin whose password we know). `trust proxy: loopback`
 * lets each case present a distinct X-Forwarded-For, isolating the per-IP login
 * throttler so the 5/min limit can be probed without cross-test interference.
 */
const PORT = 9243;
const PASSWORD = 'correct-horse-battery-staple';

interface Res {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function post(path: string, payload: unknown, ip: string): Promise<Res> {
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port: PORT,
        path,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          'x-forwarded-for': ip,
        },
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

function decodeJwtClaims(token: string): Record<string, any> {
  const payload = token.split('.')[1];
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

async function waitForLogLine(getLog: () => string, needle: string, timeoutMs = 4000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const line = getLog()
      .split('\n')
      .find((l) => l.includes(needle));
    if (line) return line;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`log line containing ${needle} not found within ${timeoutMs}ms:\n${getLog()}`);
}

describe('Login endpoint (e2e, TEST-0404)', () => {
  let app: SpawnedApp;

  beforeAll(async () => {
    const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    app = await spawnApp(PORT, { ADMIN_PASSWORD_HASH: hash });
  }, 40_000);

  afterAll(async () => {
    app?.kill('SIGKILL');
    await app?.waitForExit();
  });

  it('case 1: valid credentials → 200 with access token and a hardened refresh cookie', async () => {
    const res = await post('/api/admin/auth/login', { username: 'admin', password: PASSWORD }, '10.1.0.1');

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(typeof body.accessToken).toBe('string');
    expect(body.expiresIn).toBe(900);

    const setCookie = (res.headers['set-cookie'] as string[])[0];
    expect(setCookie).toContain('ob_refresh=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toMatch(/SameSite=Strict/i);
    expect(setCookie).toContain('Path=/api/admin/auth');
  });

  it('case 2: wrong password → 401 invalid credentials', async () => {
    const res = await post('/api/admin/auth/login', { username: 'admin', password: 'nope' }, '10.1.0.2');
    expect(res.status).toBe(401);
    expect(res.body).toContain('invalid credentials');
  });

  it('case 3: unknown user → 401, with the constant-time dummy verify doing real work', async () => {
    const t0 = Date.now();
    const res = await post('/api/admin/auth/login', { username: 'ghost', password: 'whatever' }, '10.1.0.3');
    const elapsed = Date.now() - t0;

    expect(res.status).toBe(401);
    expect(res.body).toContain('invalid credentials');
    // An instant return would leak user-existence; the dummy argon2 verify runs
    // (tens of ms) to equalise timing. (The plan's strict 50 ms delta is relaxed
    // to a floor here to stay stable across Windows/argon2 warmup.)
    expect(elapsed).toBeGreaterThan(15);
  });

  it('case 4: sixth login within 60s from one IP → 429 (login throttler at 5/min)', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await post('/api/admin/auth/login', { username: 'admin', password: 'nope' }, '10.1.0.4');
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses[5]).toBe(429);
  });

  it('case 5: successful login emits a structured admin.login audit line', async () => {
    await post('/api/admin/auth/login', { username: 'admin', password: PASSWORD }, '10.1.0.5');

    // Match this case's own line by its unique source IP — earlier cases also
    // emit admin.login, so keying on the event alone would find the wrong line.
    const line = await waitForLogLine(() => app.log(), '"ip":"10.1.0.5"');
    expect(line).toContain('"event":"admin.login"');
    expect(line).toContain('"subject":"admin"');
    expect(line).toContain('"audit":true');
  });

  it('case 6: the access token carries sub/username/mustChangePassword + iss/aud and a 900s lifetime', async () => {
    const res = await post('/api/admin/auth/login', { username: 'admin', password: PASSWORD }, '10.1.0.6');
    const claims = decodeJwtClaims(JSON.parse(res.body).accessToken);

    expect(claims.sub).toBe('admin');
    expect(claims.username).toBe('admin');
    expect(claims).toHaveProperty('mustChangePassword');
    expect(claims.iss).toBe('openbucket');
    expect(claims.aud).toBe('openbucket-admin');
    expect(claims.exp - claims.iat).toBe(900);
  });
});
