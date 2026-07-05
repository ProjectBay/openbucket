import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ReplicationAdminService } from '@openbucket/api-client';

// Keep toasts inert in the headless store test.
jest.mock('../shared/ui/notify', () => ({
  notify: { promise: jest.fn(), success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

import { ReplicationSignalStore } from './replication.signal-store';

/**
 * TEST-0902 — ReplicationSignalStore: status refresh (success/error) and the
 * reconcile start→poll→complete flow against a mocked ReplicationAdminService.
 */
describe('ReplicationSignalStore (TEST-0902)', () => {
  let store: ReplicationSignalStore;
  let api: {
    getReplicationStatus: jest.Mock;
    startReconcile: jest.Mock;
    getReconcileJob: jest.Mock;
  };

  const status = (over: Record<string, unknown> = {}) => ({
    enabled: true,
    pendingCount: 0,
    inflightCount: 0,
    failedCount: 0,
    oldestPendingAgeMs: null,
    lastError: null,
    perBucket: [],
    ...over,
  });

  beforeEach(() => {
    api = { getReplicationStatus: jest.fn(), startReconcile: jest.fn(), getReconcileJob: jest.fn() };
    TestBed.configureTestingModule({
      providers: [{ provide: ReplicationAdminService, useValue: api }],
    });
    store = TestBed.inject(ReplicationSignalStore);
  });

  afterEach(() => store.destroy());

  it('refresh: populates the status and clears loading', async () => {
    api.getReplicationStatus.mockReturnValue(of(status({ pendingCount: 4, enabled: true })));
    await store.refresh();
    expect(store.status()?.pendingCount).toBe(4);
    expect(store.loading()).toBe(false);
    expect(store.error()).toBeNull();
  });

  it('refresh: captures the error message and clears loading', async () => {
    api.getReplicationStatus.mockReturnValue(throwError(() => new Error('boom')));
    await store.refresh();
    expect(store.error()).toBe('boom');
    expect(store.loading()).toBe(false);
  });

  it('reconcile: an immediately-completed job refreshes status without polling', async () => {
    api.startReconcile.mockReturnValue(
      of({ jobId: 'j1', scope: 'instance', state: 'completed', localScanned: 5, remoteScanned: 5, missingRequeued: 0, startedAt: null }),
    );
    api.getReplicationStatus.mockReturnValue(of(status({ pendingCount: 0 })));

    await store.reconcile();

    expect(api.startReconcile).toHaveBeenCalledWith({ bucket: undefined });
    expect(api.getReconcileJob).not.toHaveBeenCalled();
    expect(store.job()?.state).toBe('completed');
    expect(store.reconciling()).toBe(false);
    expect(api.getReplicationStatus).toHaveBeenCalled();
  });

  it('reconcile: polls a running job until it completes, then refreshes', async () => {
    api.startReconcile.mockReturnValue(
      of({ jobId: 'j2', scope: 'bucket', bucket: 'b', state: 'running', localScanned: 0, remoteScanned: 0, missingRequeued: 0, startedAt: '2026-07-05T12:00:00.000Z' }),
    );
    api.getReconcileJob.mockReturnValue(
      of({ jobId: 'j2', scope: 'bucket', bucket: 'b', state: 'completed', localScanned: 10, remoteScanned: 8, missingRequeued: 2, startedAt: '2026-07-05T12:00:00.000Z' }),
    );
    api.getReplicationStatus.mockReturnValue(of(status()));

    await store.reconcile('b');

    expect(api.startReconcile).toHaveBeenCalledWith({ bucket: 'b' });
    expect(api.getReconcileJob).toHaveBeenCalledWith('j2');
    expect(store.job()?.state).toBe('completed');
    expect(store.job()?.missingRequeued).toBe(2);
    expect(store.reconciling()).toBe(false);
  });

  it('reconciling: is true while a job is queued/running', async () => {
    api.startReconcile.mockReturnValue(
      of({ jobId: 'j3', scope: 'instance', state: 'running', localScanned: 0, remoteScanned: 0, missingRequeued: 0, startedAt: null }),
    );
    // Never terminal — the poll keeps returning running; assert the signal then stop.
    api.getReconcileJob.mockReturnValue(
      of({ jobId: 'j3', scope: 'instance', state: 'running', localScanned: 1, remoteScanned: 0, missingRequeued: 0, startedAt: null }),
    );
    api.getReplicationStatus.mockReturnValue(of(status()));

    void store.reconcile();
    // Allow the immediate first poll tick to run.
    await Promise.resolve();
    await Promise.resolve();
    expect(store.reconciling()).toBe(true);
    store.destroy();
  });
});
