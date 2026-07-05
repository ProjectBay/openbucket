import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuditAdminService, AuditEvent } from '@openbucket/api-client';

import { notify } from '../shared/ui/notify';

const PAGE_SIZE = 50;

/** The viewer's filter state; every field is optional (exact-match on the server). */
export interface AuditFilters {
  event?: string;
  subject?: string;
  bucket?: string;
  from?: string; // ISO 8601 (derived from the datetime-local input)
  to?: string;
}

/**
 * Audit-log read store (STORY-1103), mirroring `KeysSignalStore` over the
 * generated `AuditAdminService`. Holds the current page's items, the keyset
 * `nextCursor`, the filter state, and the catalogue for the event dropdown.
 * `refresh` re-queries from page 1 (resetting the cursor); `loadMore` appends
 * the next page. Filter state lives here so re-entering the route preserves it.
 */
@Injectable({ providedIn: 'root' })
export class AuditSignalStore {
  private readonly api = inject(AuditAdminService);

  private readonly _items = signal<AuditEvent[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _nextCursor = signal<string | null>(null);
  private readonly _catalog = signal<string[]>([]);

  readonly items = this._items.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly catalog = this._catalog.asReadonly();
  readonly filters = signal<AuditFilters>({});
  readonly hasMore = computed(() => this._nextCursor() !== null);
  readonly count = computed(() => this._items().length);

  /** Reset the cursor and replace items with a fresh first page. */
  async refresh(): Promise<void> {
    this._loading.set(true);
    this._error.set(null);
    this._nextCursor.set(null);
    try {
      const page = await firstValueFrom(this.callList(undefined));
      this._items.set(page?.items ?? []);
      this._nextCursor.set(page?.nextCursor ?? null);
    } catch (e) {
      this.fail(e);
    } finally {
      this._loading.set(false);
    }
  }

  /** Append the next keyset page (no-op when there is none or a load is running). */
  async loadMore(): Promise<void> {
    const cursor = this._nextCursor();
    if (cursor === null || this._loading()) return;
    this._loading.set(true);
    this._error.set(null);
    try {
      const page = await firstValueFrom(this.callList(cursor));
      this._items.update((arr) => [...arr, ...(page?.items ?? [])]);
      this._nextCursor.set(page?.nextCursor ?? null);
    } catch (e) {
      this.fail(e);
    } finally {
      this._loading.set(false);
    }
  }

  /** Populate the event-name dropdown from the static catalogue. */
  async loadCatalog(): Promise<void> {
    try {
      const res = await firstValueFrom(this.api.getAuditCatalog());
      this._catalog.set(res?.events ?? []);
    } catch {
      /* the dropdown gracefully degrades to a free-text-less empty list */
    }
  }

  private callList(cursor: string | undefined) {
    const f = this.filters();
    return this.api.listAuditEvents(
      f.event || undefined,
      f.subject || undefined,
      f.bucket || undefined,
      f.from || undefined,
      f.to || undefined,
      cursor,
      PAGE_SIZE,
    );
  }

  private fail(e: unknown): void {
    const msg = (e as Error).message ?? 'Failed to load audit events';
    this._error.set(msg);
    notify.error('Failed to load audit events');
  }
}
