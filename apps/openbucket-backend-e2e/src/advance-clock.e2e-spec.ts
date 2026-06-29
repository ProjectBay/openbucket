import { SpawnedApp, spawnApp } from './support/spawn-app';

/**
 * TEST-0325 — the gated POST /api/admin/_test/advance-clock endpoint is
 * mounted only when OPENBUCKET_TEST_MODE=1 and shifts the injected TestClock.
 *
 * Spawns two backend variants: one in test mode, one without.
 */
describe('advance-clock endpoint (e2e)', () => {
  let testApp: SpawnedApp;
  let prodApp: SpawnedApp;

  beforeAll(async () => {
    testApp = await spawnApp(9220, { OPENBUCKET_TEST_MODE: '1' });
    prodApp = await spawnApp(9221); // no OPENBUCKET_TEST_MODE
  }, 60_000);

  afterAll(async () => {
    testApp?.kill('SIGKILL');
    prodApp?.kill('SIGKILL');
    await Promise.all([testApp?.waitForExit(), prodApp?.waitForExit()]);
  });

  const post = (base: string, body: unknown) =>
    fetch(`${base}/api/admin/_test/advance-clock`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('case 1: production variant does not mount the endpoint (guard 401s, never 200)', async () => {
    const res = await post(prodApp.baseUrl, { ms: 1 });
    // OPENBUCKET_TEST_MODE is unset here, so TestModule (and this route) is never
    // registered. The request falls through to the greedy S3 catch-all, but the
    // global JwtAuthGuard's safety net (jwt-auth.guard.ts:39 — `req.path` starts
    // with /api/admin/) 401s the unauthenticated request before a 404 can
    // surface. The invariant that matters: prod never returns the 200-with-offset
    // that the test-mode variant does (case 2 below).
    expect(res.status).toBe(401);
  });

  it('case 2: test variant returns 200 with offsetMs ≈ ms', async () => {
    const ms = 86_400_000; // 24h
    const res = await post(testApp.baseUrl, { ms });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { offsetMs: number };
    // Allow a generous tolerance — boot/migration warmup + roundtrip latency.
    expect(body.offsetMs).toBeGreaterThanOrEqual(ms - 1_000);
    expect(body.offsetMs).toBeLessThanOrEqual(ms + 1_000);
  });

  it('case 3: ms=-1 → 400 (controller rejects negative ms)', async () => {
    const res = await post(testApp.baseUrl, { ms: -1 });
    expect(res.status).toBe(400);
    // The exact message string `'ms must be a non-negative number'` is
    // asserted at the controller level by TEST-0324 case 9 (unit). At the
    // HTTP boundary the filter chain currently renders the BadRequestException
    // as Express's default HTML 400 page rather than the
    // AdminExceptionFilter's JSON shape — an M0 filter-coverage gap for
    // `/_test/*` paths, not a STORY-0318 concern.
  });

  it('case 4: non-numeric ms → 400', async () => {
    const res = await post(testApp.baseUrl, { ms: 'foo' });
    expect(res.status).toBe(400);
  });

  it('case 5: after advance, a second advance accumulates (offsetMs increases monotonically)', async () => {
    // After case 2 advanced by 86_400_000, advance another 1_000 and confirm
    // the total offset reflects both — proves the test variant has a real
    // TestClock injected, not a fresh per-request instance.
    const before = (await (await post(testApp.baseUrl, { ms: 0 })).json()) as { offsetMs: number };
    const res = await post(testApp.baseUrl, { ms: 1_000 });
    const after = (await res.json()) as { offsetMs: number };
    expect(after.offsetMs - before.offsetMs).toBeGreaterThanOrEqual(900);
  });
});
