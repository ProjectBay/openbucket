import { SpawnedApp, spawnApp } from './support/spawn-app';

/**
 * TEST-0017 — SIGTERM drain end-to-end.
 *
 * POSIX-only: on Windows `child.kill('SIGTERM')` maps to TerminateProcess,
 * which hard-kills without running the signal handler, so a graceful-drain
 * test is meaningless there. The coordinator logic is covered on every
 * platform by the TEST-0016 unit suite; this e2e runs for real in Linux CI.
 */
const posixOnly = process.platform === 'win32' ? describe.skip : describe;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

posixOnly('SIGTERM drain (e2e, POSIX)', () => {
  let app: SpawnedApp | undefined;

  afterEach(async () => {
    if (app) {
      app.kill('SIGKILL');
      await app.waitForExit();
      app = undefined;
    }
  });

  it('case 1: drains an in-flight request then exits 0', async () => {
    app = await spawnApp(9215, { OPENBUCKET_TEST_MODE: '1', SHUTDOWN_DRAIN_MS: '30000' });

    // Start a 3s slow request; do not await yet.
    const slow = fetch(`${app.baseUrl}/api/admin/_test/slow?ms=3000`);
    await sleep(500);

    // /ready flips to 503 draining immediately after SIGTERM.
    app.kill('SIGTERM');
    await sleep(300);
    const ready = await fetch(`${app.baseUrl}/api/admin/ready`).catch(() => null);
    if (ready) expect(ready.status).toBe(503);

    // The in-flight request still completes.
    const res = await slow;
    expect(res.status).toBe(200);

    const code = await app.waitForExit();
    expect(code).toBe(0);
    expect(app.log()).toContain('All in-flight requests completed.');
  });

  it('case 2: exceeds the drain deadline and exits 1', async () => {
    app = await spawnApp(9216, { OPENBUCKET_TEST_MODE: '1', SHUTDOWN_DRAIN_MS: '2000' });

    fetch(`${app.baseUrl}/api/admin/_test/slow?ms=10000`).catch(() => undefined);
    await sleep(500);
    app.kill('SIGTERM');

    const code = await app.waitForExit();
    expect(code).toBe(1);
    expect(app.log()).toContain('Drain deadline (2000ms) elapsed');
  });

  it('case 3: SIGINT with no traffic exits 0', async () => {
    app = await spawnApp(9217);
    app.kill('SIGINT');
    const code = await app.waitForExit();
    expect(code).toBe(0);
  });

  it('case 4: a second SIGTERM forces exit 1', async () => {
    app = await spawnApp(9218, { OPENBUCKET_TEST_MODE: '1', SHUTDOWN_DRAIN_MS: '30000' });

    fetch(`${app.baseUrl}/api/admin/_test/slow?ms=10000`).catch(() => undefined);
    await sleep(500);
    app.kill('SIGTERM'); // begins drain (request still in flight)
    await sleep(100);
    app.kill('SIGTERM'); // forces exit

    const code = await app.waitForExit();
    expect(code).toBe(1);
    expect(app.log()).toContain('Received SIGTERM again; forcing exit.');
  });
});
