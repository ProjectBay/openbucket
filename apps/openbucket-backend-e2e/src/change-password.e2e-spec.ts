import { request as httpRequest } from 'node:http';
import * as argon2 from 'argon2';

import { SpawnedApp, spawnApp } from './support/spawn-app';

/**
 * TEST-0417 — Change-password endpoint, end-to-end (§5.8).
 *
 * The seeded admin starts with a known password (real argon2id hash via env).
 * Failure cases run first while the password is unchanged; the happy-path change
 * + re-login + audit run last, since they mutate the single admin credential.
 *
 * Note: case 3 asserts 400 (not the 422 the test-plan text said) — the whitepaper
 * §1.6.2 and the AdminExceptionFilter render Zod validation errors as 400
 * `ValidationFailed`. The plan's 422 was a derivation slip; corrected here.
 */
const PORT = 9253;
const INITIAL = 'initial-admin-password';
const NEW_PASSWORD = 'brand-new-long-password';

interface Res {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function send(
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

async function login(ip: string, password: string): Promise<Res> {
  return send('POST', '/api/admin/auth/login', { body: { username: 'admin', password }, ip });
}

async function bearerFor(ip: string, password: string): Promise<string> {
  const res = await login(ip, password);
  if (res.status !== 200) throw new Error(`login failed (${res.status}): ${res.body}`);
  return JSON.parse(res.body).accessToken;
}

const changePassword = (bearer: string | undefined, currentPassword: string, newPassword: string): Promise<Res> =>
  send('POST', '/api/admin/settings/change-password', { bearer, body: { currentPassword, newPassword } });

async function waitForLogLine(getLog: () => string, needle: string, timeoutMs = 4000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const line = getLog().split('\n').find((l) => l.includes(needle));
    if (line) return line;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`log line containing ${needle} not found:\n${getLog()}`);
}

describe('Change-password endpoint (e2e, TEST-0417)', () => {
  let app: SpawnedApp;

  beforeAll(async () => {
    const hash = await argon2.hash(INITIAL, { type: argon2.argon2id });
    app = await spawnApp(PORT, { ADMIN_PASSWORD_HASH: hash });
  }, 40_000);

  afterAll(async () => {
    app?.kill('SIGKILL');
    await app?.waitForExit();
  });

  // ----- failure cases first (admin password still INITIAL) ------------------

  it('case 4: no bearer → 401 (JwtAuthGuard rejects)', async () => {
    const res = await changePassword(undefined, INITIAL, NEW_PASSWORD);
    expect(res.status).toBe(401);
  });

  it('case 2: wrong current password → 401 current password incorrect', async () => {
    const bearer = await bearerFor('10.6.0.2', INITIAL);
    const res = await changePassword(bearer, 'not-the-current-password', NEW_PASSWORD);
    expect(res.status).toBe(401);
    expect(res.body).toContain('current password incorrect');
  });

  it('case 3: newPassword shorter than 12 → 400 ValidationFailed', async () => {
    const bearer = await bearerFor('10.6.0.3', INITIAL);
    const res = await changePassword(bearer, INITIAL, 'short');
    expect(res.status).toBe(400);
    expect(res.body).toContain('ValidationFailed');
  });

  // ----- happy path last (mutates the admin credential) ----------------------

  it('case 1: valid change → 204, and /me still reports mustChangePassword:false', async () => {
    const bearer = await bearerFor('10.6.0.1', INITIAL);
    const res = await changePassword(bearer, INITIAL, NEW_PASSWORD);
    expect(res.status).toBe(204);

    const me = await send('GET', '/api/admin/auth/me', { bearer });
    expect(JSON.parse(me.body).mustChangePassword).toBe(false);
  });

  it('case 6: the change emitted an admin.password.changed audit line', async () => {
    const line = await waitForLogLine(() => app.log(), '"event":"admin.password.changed"');
    expect(line).toContain('"subject":"admin"');
    expect(line).toContain('"audit":true');
  });

  it('case 5: after the change, the old password fails and the new one works', async () => {
    expect((await login('10.6.0.5', INITIAL)).status).toBe(401);
    expect((await login('10.6.0.5', NEW_PASSWORD)).status).toBe(200);
  });
});
