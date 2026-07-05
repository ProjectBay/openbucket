import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { AnalyticsService } from '@openbucket/api-client';

import { AnalyticsSignalStore } from './analytics.signal-store';

/**
 * TEST-1102 (case 10) — AnalyticsSignalStore maps the three analytics responses
 * into signals and derives the trend / live-rate computeds.
 */
describe('AnalyticsSignalStore (TEST-1102)', () => {
  let store: AnalyticsSignalStore;
  let api: {
    getStorageAnalytics: jest.Mock;
    getBucketBreakdown: jest.Mock;
    getRequestAnalytics: jest.Mock;
  };

  const storage = {
    bucket: null,
    points: [
      { t: '2026-07-05T00:00:00.000Z', sizeBytes: 100, objectCount: 1 },
      { t: '2026-07-05T00:15:00.000Z', sizeBytes: 250, objectCount: 3 },
    ],
  };
  const breakdown = {
    buckets: [{ name: 'b1', sizeBytes: 250, objectCount: 3, sharePct: 100 }],
    totalSizeBytes: 250,
    totalObjectCount: 3,
  };
  const requests = {
    points: [
      {
        t: '2026-07-05T00:15:00.000Z',
        admin: { requestCount: 4, errorCount: 1 },
        s3: { requestCount: 6, errorCount: 0 },
      },
    ],
  };

  beforeEach(() => {
    api = {
      getStorageAnalytics: jest.fn().mockReturnValue(of(storage)),
      getBucketBreakdown: jest.fn().mockReturnValue(of(breakdown)),
      getRequestAnalytics: jest.fn().mockReturnValue(of(requests)),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: AnalyticsService, useValue: api }],
    });
    store = TestBed.inject(AnalyticsSignalStore);
  });

  it('refresh: fans out and maps the three responses', async () => {
    await store.refresh();
    expect(store.storagePoints()).toHaveLength(2);
    expect(store.breakdownBuckets()[0].name).toBe('b1');
    expect(store.requestPoints()).toHaveLength(1);
    expect(store.loading()).toBe(false);
    expect(store.error()).toBeNull();
  });

  it('derives storageDelta, latestSizeBytes, and latestRequestCount', async () => {
    await store.refresh();
    expect(store.storageDelta()).toBe(150); // 250 - 100
    expect(store.latestSizeBytes()).toBe(250);
    expect(store.latestRequestCount()).toBe(10); // 4 + 6
  });

  it('setRange updates the range and passes it to the API', async () => {
    await store.setRange('30d');
    expect(store.range()).toBe('30d');
    expect(api.getStorageAnalytics).toHaveBeenCalledWith('30d');
    expect(api.getRequestAnalytics).toHaveBeenCalledWith('30d');
  });

  it('refresh: captures the error message and clears loading', async () => {
    api.getStorageAnalytics.mockReturnValue(throwError(() => new Error('boom')));
    await store.refresh();
    expect(store.error()).toBe('boom');
    expect(store.loading()).toBe(false);
  });

  it('empty state: no points yields zero computeds without error', () => {
    expect(store.storagePoints()).toEqual([]);
    expect(store.storageDelta()).toBe(0);
    expect(store.latestRequestCount()).toBe(0);
  });
});
