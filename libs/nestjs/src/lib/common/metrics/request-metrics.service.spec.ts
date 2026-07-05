import { RequestMetricsService } from './request-metrics.service';

/** TEST-1102 (case 3) — the in-memory request/error counters. */
describe('RequestMetricsService (TEST-1102)', () => {
  let svc: RequestMetricsService;

  beforeEach(() => {
    svc = new RequestMetricsService();
  });

  it('a 2xx increments requestCount only; a 4xx/5xx also increments errorCount', () => {
    svc.record('s3', 200);
    svc.record('s3', 404);
    svc.record('s3', 500);
    const drained = svc.drain();
    expect(drained.s3).toEqual({ requestCount: 3, errorCount: 2 });
    // The other surface stays untouched.
    expect(drained.admin).toEqual({ requestCount: 0, errorCount: 0 });
  });

  it('drain() resets the accumulators; a subsequent drain with no traffic is zeros', () => {
    svc.record('admin', 200);
    svc.record('admin', 403);
    expect(svc.drain().admin).toEqual({ requestCount: 2, errorCount: 1 });
    // Second drain — nothing recorded since — is all zeros.
    expect(svc.drain()).toEqual({
      admin: { requestCount: 0, errorCount: 0 },
      s3: { requestCount: 0, errorCount: 0 },
    });
  });

  it('ratePerMinute reports the previous full minute count', () => {
    const nowMinute = Math.floor(Date.now() / 60_000);
    const prevMinute = nowMinute - 1;
    const spy = jest.spyOn(Date, 'now').mockReturnValue(prevMinute * 60_000 + 1_000);
    svc.record('s3', 200);
    svc.record('s3', 200);
    spy.mockReturnValue(nowMinute * 60_000 + 1_000);
    // Now querying the "previous full minute" returns the two we recorded.
    expect(svc.ratePerMinute('s3')).toBe(2);
    expect(svc.ratePerMinute('admin')).toBe(0);
    spy.mockRestore();
  });
});
