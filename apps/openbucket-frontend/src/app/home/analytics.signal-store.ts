import { Injectable, computed, inject, signal } from '@angular/core';
import {
  AnalyticsService,
  BucketBreakdownDto,
  RequestSeriesDto,
  StorageSeriesDto,
} from '@openbucket/api-client';
import { firstValueFrom } from 'rxjs';

/** The range options the dashboard exposes (a subset of the API's allow-list). */
export type AnalyticsRange = '24h' | '7d' | '30d';

/**
 * Signal store for the dashboard usage analytics (§STORY-1102). Mirrors
 * {@link BucketsSignalStore}: private writable signals + readonly views, and a
 * `refresh()` that fans the three read-only endpoints out in parallel. Read-only
 * data — safe to poll on a bounded interval from the home component.
 */
@Injectable({ providedIn: 'root' })
export class AnalyticsSignalStore {
  private readonly api = inject(AnalyticsService);

  private readonly _storage = signal<StorageSeriesDto | null>(null);
  private readonly _breakdown = signal<BucketBreakdownDto | null>(null);
  private readonly _requests = signal<RequestSeriesDto | null>(null);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _range = signal<AnalyticsRange>('7d');

  readonly storage = this._storage.asReadonly();
  readonly breakdown = this._breakdown.asReadonly();
  readonly requests = this._requests.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly range = this._range.asReadonly();

  /** The storage-over-time points (empty array when no samples yet). */
  readonly storagePoints = computed(() => this._storage()?.points ?? []);
  /** The per-bucket breakdown rows (empty array when no samples yet). */
  readonly breakdownBuckets = computed(() => this._breakdown()?.buckets ?? []);
  /** The request/error series points (empty array when no samples yet). */
  readonly requestPoints = computed(() => this._requests()?.points ?? []);

  /** Delta in stored bytes between the first and last storage point (trend label). */
  readonly storageDelta = computed(() => {
    const pts = this.storagePoints();
    if (pts.length < 2) return 0;
    return pts[pts.length - 1].sizeBytes - pts[0].sizeBytes;
  });

  /** Latest total stored bytes across the instance (last storage point). */
  readonly latestSizeBytes = computed(() => {
    const pts = this.storagePoints();
    return pts.length > 0 ? pts[pts.length - 1].sizeBytes : 0;
  });

  /** Combined admin+s3 request count in the most recent sampled window (live KPI). */
  readonly latestRequestCount = computed(() => {
    const pts = this.requestPoints();
    if (pts.length === 0) return 0;
    const last = pts[pts.length - 1];
    return last.admin.requestCount + last.s3.requestCount;
  });

  /** Change the active range and reload. */
  async setRange(range: AnalyticsRange): Promise<void> {
    this._range.set(range);
    await this.refresh();
  }

  /** Fan the three endpoints out in parallel and set the signals. */
  async refresh(): Promise<void> {
    this._loading.set(true);
    this._error.set(null);
    const range = this._range();
    try {
      const [storage, breakdown, requests] = await Promise.all([
        firstValueFrom(this.api.getStorageAnalytics(range)),
        firstValueFrom(this.api.getBucketBreakdown()),
        firstValueFrom(this.api.getRequestAnalytics(range)),
      ]);
      this._storage.set(storage ?? null);
      this._breakdown.set(breakdown ?? null);
      this._requests.set(requests ?? null);
    } catch (e) {
      this._error.set((e as Error).message);
    } finally {
      this._loading.set(false);
    }
  }
}
