import { SpawnedApp, spawnApp } from './support/spawn-app';

/**
 * TEST-0014 — SPA serving guard.
 *
 * In M0/dev there is no dist/spa build, so SpaModule registers nothing and a
 * /admin/* request is NOT served as a static file — it must not crash the
 * process. (When EPIC-06 populates dist/spa in the container, this serves the
 * Angular shell; that path is covered by the conformance image build.)
 */
describe('SPA serving guard (e2e)', () => {
  let app: SpawnedApp;

  beforeAll(async () => {
    app = await spawnApp(9212);
  });

  afterAll(async () => {
    app?.kill('SIGKILL');
    await app?.waitForExit();
  });

  it('boots cleanly without a dist/spa build', async () => {
    // Liveness still works — proves the missing SPA dir did not crash boot.
    const res = await fetch(`${app.baseUrl}/api/admin/health`);
    expect(res.status).toBe(200);
  });

  it('GET /admin/ without a build does not 500 the process', async () => {
    const res = await fetch(`${app.baseUrl}/admin/`);
    // No static module registered → not served; must be a clean client status,
    // never a 5xx crash.
    expect(res.status).toBeLessThan(500);
  });
});
