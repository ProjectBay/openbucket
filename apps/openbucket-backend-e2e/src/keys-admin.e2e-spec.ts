import { request as httpRequest } from 'node:http';
import { join } from 'node:path';
import * as argon2 from 'argon2';

import { SpawnedApp, spawnApp } from './support/spawn-app';

// better-sqlite3 is a transitive dep (via @mikro-orm/better-sqlite); used here to
// inspect the backing DB for the no-plaintext-secret invariant (case 8).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Database = require('better-sqlite3');

/**
 * TEST-0415 — Access-key management endpoints, end-to-end (§5.7).
 *
 * Centres on the security-critical "secret returned exactly once" invariant:
 * create surfaces secretAccessKey; no list/read ever does; and the backing
 * access_keys row stores only an argon2id hash.
 *
 * Note: case 4 asserts 400 (the plan said 422) — validation errors are 400
 * ValidationFailed per §1.6.2 / AdminExceptionFilter.
 */
const PORT = 9259;
const PASSWORD = 'correct-horse-battery-staple';

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

async function waitForLine(getLog: () => string, ...needles: string[]): Promise<boolean> {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    if (getLog().split('\n').some((l) => needles.every((n) => l.includes(n)))) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

describe('Access-key endpoints (e2e, TEST-0415)', () => {
  let app: SpawnedApp;
  let bearer: string;
  let keyId: string;
  let secret: string;

  beforeAll(async () => {
    const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    app = await spawnApp(PORT, { ADMIN_PASSWORD_HASH: hash });
    const login = await http('POST', '/api/admin/auth/login', {
      body: { username: 'admin', password: PASSWORD },
    });
    bearer = JSON.parse(login.body).accessToken;
  }, 40_000);

  afterAll(async () => {
    app?.kill('SIGKILL');
    await app?.waitForExit();
  });

  it('case 1: create → 201 with a non-empty secretAccessKey and role root', async () => {
    const res = await http('POST', '/api/admin/keys', { body: { label: 'app-1' }, bearer });
    expect(res.status).toBe(201);
    const body = JSON.parse(res.body);
    expect(typeof body.secretAccessKey).toBe('string');
    expect(body.secretAccessKey.length).toBeGreaterThan(0);
    expect(body.role).toBe('root');
    keyId = body.id;
    secret = body.secretAccessKey;
  });

  it('case 2: list returns the key WITHOUT the secret', async () => {
    const res = await http('GET', '/api/admin/keys', { bearer });
    expect(res.status).toBe(200);
    const list = JSON.parse(res.body) as Array<Record<string, unknown>>;
    const found = list.find((k) => k.id === keyId);
    expect(found).toBeDefined();
    expect(found).not.toHaveProperty('secretAccessKey');
    expect(res.body).not.toContain(secret);
  });

  it('case 3: PATCH disabled:true → 200 disabled, audit key.disabled', async () => {
    const res = await http('PATCH', `/api/admin/keys/${keyId}`, { body: { disabled: true }, bearer });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).disabled).toBe(true);
    expect(await waitForLine(() => app.log(), '"event":"key.disabled"', `"keyId":"${keyId}"`)).toBe(true);
  });

  it('case 4: PATCH with an empty body → 400 (at least one field required)', async () => {
    const res = await http('PATCH', `/api/admin/keys/${keyId}`, { body: {}, bearer });
    expect(res.status).toBe(400);
    expect(res.body).toContain('at least one field required');
  });

  it('case 5: PATCH label → 200, audit key.updated', async () => {
    const res = await http('PATCH', `/api/admin/keys/${keyId}`, { body: { label: 'renamed' }, bearer });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).label).toBe('renamed');
    expect(await waitForLine(() => app.log(), '"event":"key.updated"', `"keyId":"${keyId}"`)).toBe(true);
  });

  it('case 6: DELETE → 204, then the list no longer contains it', async () => {
    expect((await http('DELETE', `/api/admin/keys/${keyId}`, { bearer })).status).toBe(204);
    const list = JSON.parse((await http('GET', '/api/admin/keys', { bearer })).body) as Array<{ id: string }>;
    expect(list.find((k) => k.id === keyId)).toBeUndefined();
  });

  it('case 7: without a bearer, the routes return 401', async () => {
    expect((await http('GET', '/api/admin/keys')).status).toBe(401);
    expect((await http('POST', '/api/admin/keys', { body: { label: 'x' } })).status).toBe(401);
    expect((await http('DELETE', '/api/admin/keys/whatever')).status).toBe(401);
  });

  it('case 8: the backing row stores only an argon2id hash, never the plaintext', async () => {
    const created = JSON.parse(
      (await http('POST', '/api/admin/keys', { body: { label: 'inspect' }, bearer })).body,
    );
    const dbPath = join(app.dataDir, 'openbucket.db');
    const db = new Database(dbPath, { readonly: true });
    try {
      const row = db.prepare('select * from access_keys where id = ?').get(created.id) as Record<string, unknown>;
      expect(row).toBeDefined();
      expect(String(row.secret_hash)).toMatch(/^\$argon2/);
      expect(JSON.stringify(row)).not.toContain(created.secretAccessKey);
    } finally {
      db.close();
    }
  });
});
