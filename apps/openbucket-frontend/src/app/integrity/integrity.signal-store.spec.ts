import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { IntegrityAdminService } from '@openbucket/api-client';

// Keep toasts inert in the headless store test.
jest.mock('../shared/ui/notify', () => ({
  notify: { promise: jest.fn(), success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

import { IntegritySignalStore } from './integrity.signal-store';

/**
 * TEST-1204 — IntegritySignalStore: status + corrupt-list refresh (success/error),
 * the derived corrupt/hasCorruption signals, and the scrubNow trigger, against a
 * mocked IntegrityAdminService.
 */
describe('IntegritySignalStore (TEST-1204)', () => {
  let store: IntegritySignalStore;
  let api: {
    getIntegrityStatus: jest.Mock;
    listCorruptObjects: jest.Mock;
    startIntegrityScrub: jest.Mock;
  };

  const status = (over: Record<string, unknown> = {}) => ({
    enabled: true,
    scanned: 0,
    ok: 0,
    corrupt: 0,
    unchecked: 0,
    repaired: 0,
    lastRunAt: null,
    cursor: null,
    ...over,
  });

  beforeEach(() => {
    api = {
      getIntegrityStatus: jest.fn().mockReturnValue(of(status())),
      listCorruptObjects: jest.fn().mockReturnValue(of({ rows: [], total: 0 })),
      startIntegrityScrub: jest.fn().mockReturnValue(of({})),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: IntegrityAdminService, useValue: api }],
    });
    store = TestBed.inject(IntegritySignalStore);
  });

  it('refresh: populates status + corrupt rows and derives corrupt count', async () => {
    api.getIntegrityStatus.mockReturnValue(of(status({ corrupt: 2, ok: 10, scanned: 12 })));
    api.listCorruptObjects.mockReturnValue(
      of({
        rows: [
          { bucket: 'b', key: 'k1', checkedAt: null, detail: 'sha x != y' },
          { bucket: 'b', key: 'k2', checkedAt: null, detail: null },
        ],
        total: 2,
      }),
    );

    await store.refresh();

    expect(store.status()?.corrupt).toBe(2);
    expect(store.corruptRows()).toHaveLength(2);
    expect(store.corrupt()).toBe(2);
    expect(store.hasCorruption()).toBe(true);
    expect(store.loading()).toBe(false);
    expect(store.error()).toBeNull();
  });

  it('hasCorruption: is false when corrupt is zero', async () => {
    await store.refresh();
    expect(store.corrupt()).toBe(0);
    expect(store.hasCorruption()).toBe(false);
  });

  it('refresh: captures the error message and clears loading', async () => {
    api.getIntegrityStatus.mockReturnValue(throwError(() => new Error('boom')));
    await store.refresh();
    expect(store.error()).toBe('boom');
    expect(store.loading()).toBe(false);
  });

  it('scrubNow: posts the trigger then refreshes the status', async () => {
    api.getIntegrityStatus.mockReturnValue(of(status({ corrupt: 1 })));
    await store.scrubNow();
    expect(api.startIntegrityScrub).toHaveBeenCalledTimes(1);
    // Refresh ran after the trigger.
    expect(api.getIntegrityStatus).toHaveBeenCalled();
    expect(store.scrubbing()).toBe(false);
  });
});
