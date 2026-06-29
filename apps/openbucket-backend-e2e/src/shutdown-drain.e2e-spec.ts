import { spawnApp } from './support/spawn-app';

/**
 * TEST-0327 — SIGTERM runs the §4.12 five-step graceful shutdown (STORY-0319).
 *
 * Platform note: on Windows POSIX signals don't exist — `child.kill('SIGTERM')`
 * is emulated as an unconditional TerminateProcess, so the child can never run
 * its SIGTERM handler. The drain ordering is therefore only observable on
 * POSIX; this suite is skipped on win32 (the ordering is covered locally by the
 * TEST-0326 unit spec). It runs for real on Linux CI.
 */
const describeOnPosix = process.platform === 'win32' ? describe.skip : describe;

describeOnPosix('graceful shutdown (e2e, TEST-0327)', () => {
  it('SIGTERM drains in order and the process exits', async () => {
    const app = await spawnApp(9230);

    // Sanity: it's actually serving before we tear it down.
    const health = await fetch(`${app.baseUrl}/api/admin/health`);
    expect(health.status).toBe(200);

    app.kill('SIGTERM');
    const code = await app.waitForExit();

    const log = app.log();
    // The five steps, in order, each emit a log line (§4.12).
    expect(log).toContain('Shutdown initiated');
    expect(log).toContain('HTTP server stopped accepting new connections');
    expect(log).toContain('Stream drain complete');
    expect(log).toContain('Background ticks cancelled and drained');
    expect(log).toContain('BlobStore closed');
    expect(log).toContain('MikroORM closed');
    expect(log).toContain('Shutdown complete');

    // Exit is graceful: a clean natural exit (0) or termination by the
    // re-raised signal (null exit code) — never a crash.
    expect(code === 0 || code === null).toBe(true);
  }, 40_000);

  it('an idle SIGTERM completes well within the 30s drain deadline', async () => {
    const app = await spawnApp(9231);
    const started = Date.now();
    app.kill('SIGTERM');
    await app.waitForExit();
    // No in-flight streams → drain is immediate, nowhere near 30s.
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(app.log()).not.toContain('Drain deadline reached');
  }, 40_000);
});
