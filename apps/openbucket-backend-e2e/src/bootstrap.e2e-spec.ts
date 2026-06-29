import { spawnApp } from './support/spawn-app';

/**
 * TEST-0002 — bootstrap boot/exit semantics.
 */
describe('bootstrap (e2e)', () => {
  it('boots with a valid env and serves health', async () => {
    const app = await spawnApp(9213);
    try {
      const res = await fetch(`${app.baseUrl}/api/admin/health`);
      expect(res.status).toBe(200);
      expect(app.log()).toContain('OpenBucket listening');
    } finally {
      app.kill('SIGKILL');
      await app.waitForExit();
    }
  });

  it('refuses to boot with an invalid env and exits non-zero', async () => {
    // Empty DATA_DIR fails the schema (min length 1) → loadEnv throws.
    const app = await spawnApp(9214, { DATA_DIR: '' }, { waitForReady: false });
    const code = await app.waitForExit();
    expect(code).toBe(1);
    expect(app.log()).toContain('Invalid environment configuration');
    expect(app.log()).toContain('DATA_DIR');
  });
});
