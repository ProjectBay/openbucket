import { SpawnedApp, spawnApp } from './support/spawn-app';

/**
 * TEST-0013 — health + readiness over HTTP against the live process.
 */
describe('health & readiness (e2e)', () => {
  let app: SpawnedApp;

  beforeAll(async () => {
    app = await spawnApp(9210);
  });

  afterAll(async () => {
    app?.kill('SIGKILL');
    await app?.waitForExit();
  });

  it('GET /api/admin/health → 200 { status: ok, uptime }', async () => {
    const res = await fetch(`${app.baseUrl}/api/admin/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(typeof body.uptime).toBe('number');
  });

  it('GET /api/admin/ready → 200 { status: ready }', async () => {
    const res = await fetch(`${app.baseUrl}/api/admin/ready`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ready');
  });
});
