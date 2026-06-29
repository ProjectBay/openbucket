import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { BucketsAdminService } from '@openbucket/api-client';

import { BucketsSignalStore } from './buckets.signal-store';

/**
 * TEST-0425 — BucketsSignalStore (§5.15).
 *
 * NOTE: parked until the frontend jest harness is wired; the store is
 * build-verified. Covers refresh success/error, create-append, remove-filter.
 */
describe('BucketsSignalStore (TEST-0425)', () => {
  let store: BucketsSignalStore;
  let api: { listBuckets: jest.Mock; createBucket: jest.Mock; deleteBucket: jest.Mock };

  const summary = (name: string) => ({
    name,
    createdAt: '2026-01-01T00:00:00.000Z',
    versioning: 'disabled' as const,
    objectLock: false,
    objectCount: 0,
    sizeBytes: 0,
  });

  beforeEach(() => {
    api = { listBuckets: jest.fn(), createBucket: jest.fn(), deleteBucket: jest.fn() };
    TestBed.configureTestingModule({ providers: [{ provide: BucketsAdminService, useValue: api }] });
    store = TestBed.inject(BucketsSignalStore);
  });

  it('refresh: populates items and clears loading', async () => {
    api.listBuckets.mockReturnValue(of({ buckets: [summary('a'), summary('b')], total: 2 }));
    await store.refresh();
    expect(store.items().map((b) => b.name)).toEqual(['a', 'b']);
    expect(store.count()).toBe(2);
    expect(store.loading()).toBe(false);
    expect(store.error()).toBeNull();
  });

  it('refresh: captures the error message and clears loading', async () => {
    api.listBuckets.mockReturnValue(throwError(() => new Error('boom')));
    await store.refresh();
    expect(store.error()).toBe('boom');
    expect(store.loading()).toBe(false);
  });

  it('create: appends the created bucket', async () => {
    api.createBucket.mockReturnValue(of(summary('new')));
    await store.create({ name: 'new' });
    expect(store.items().map((b) => b.name)).toContain('new');
  });

  it('remove: filters the named bucket out', async () => {
    api.listBuckets.mockReturnValue(of({ buckets: [summary('a'), summary('b')], total: 2 }));
    await store.refresh();
    api.deleteBucket.mockReturnValue(of(undefined));
    await store.remove('a');
    expect(store.items().map((b) => b.name)).toEqual(['b']);
  });
});
