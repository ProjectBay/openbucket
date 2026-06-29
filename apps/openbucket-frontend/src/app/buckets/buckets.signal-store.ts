import { Injectable, computed, inject, signal } from '@angular/core';
import { BucketSummaryDto, BucketsAdminService, CreateBucketDto } from '@openbucket/api-client';
import { firstValueFrom } from 'rxjs';

/**
 * Tiny "signal store" for buckets (§5.15) — a service holding signals + mutation
 * methods. Components read the readonly signals; mutations call the API and update
 * state on success. NgRx SignalStore can replace this later without changing the
 * read surface (items / loading / error).
 */
@Injectable({ providedIn: 'root' })
export class BucketsSignalStore {
  private readonly api = inject(BucketsAdminService);

  private readonly _items = signal<BucketSummaryDto[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly items = this._items.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly count = computed(() => this._items().length);

  async refresh(): Promise<void> {
    this._loading.set(true);
    this._error.set(null);
    try {
      const res = await firstValueFrom(this.api.listBuckets());
      this._items.set(res?.buckets ?? []);
    } catch (e) {
      this._error.set((e as Error).message);
    } finally {
      this._loading.set(false);
    }
  }

  async create(dto: CreateBucketDto): Promise<void> {
    const created = await firstValueFrom(this.api.createBucket(dto));
    if (created) this._items.update((arr) => [...arr, created]);
  }

  async remove(name: string): Promise<void> {
    await firstValueFrom(this.api.deleteBucket(name));
    this._items.update((arr) => arr.filter((b) => b.name !== name));
  }
}
