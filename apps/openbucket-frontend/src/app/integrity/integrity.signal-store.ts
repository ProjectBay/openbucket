import { Injectable, computed, inject, signal } from '@angular/core';
import {
  CorruptObjectDto,
  IntegrityAdminService,
  IntegrityStatusDto,
} from '@openbucket/api-client';
import { firstValueFrom } from 'rxjs';

import { notify } from '../shared/ui/notify';

/** Max corrupt rows fetched for the console table (server caps at 200). */
const CORRUPT_PAGE_LIMIT = 50;

/**
 * Signal store for the integrity console (STORY-1204) — readonly signals over the
 * generated `IntegrityAdminService`. `refresh()` loads the status summary + the
 * corrupt list; `scrubNow()` kicks a manual scrub and re-refreshes. A singleton
 * (`providedIn: 'root'`) so the sidebar corrupt-count badge and the Integrity tab
 * share one source of truth. Mirrors `ReplicationSignalStore`.
 */
@Injectable({ providedIn: 'root' })
export class IntegritySignalStore {
  private readonly api = inject(IntegrityAdminService);

  private readonly _status = signal<IntegrityStatusDto | null>(null);
  private readonly _corruptRows = signal<CorruptObjectDto[]>([]);
  private readonly _loading = signal(false);
  private readonly _scrubbing = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly status = this._status.asReadonly();
  readonly corruptRows = this._corruptRows.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly scrubbing = this._scrubbing.asReadonly();
  readonly error = this._error.asReadonly();

  /** Live corrupt count (from the status summary); 0 when unknown. */
  readonly corrupt = computed(() => this._status()?.corrupt ?? 0);
  /** Whether there is any corruption to surface (drives the console indicator). */
  readonly hasCorruption = computed(() => this.corrupt() > 0);

  /** Load the status summary + the corrupt-object list. */
  async refresh(): Promise<void> {
    this._loading.set(true);
    this._error.set(null);
    try {
      const [status, corrupt] = await Promise.all([
        firstValueFrom(this.api.getIntegrityStatus()),
        firstValueFrom(this.api.listCorruptObjects(CORRUPT_PAGE_LIMIT, 0)),
      ]);
      this._status.set(status ?? null);
      this._corruptRows.set(corrupt?.rows ?? []);
    } catch (e) {
      this._error.set((e as Error).message);
    } finally {
      this._loading.set(false);
    }
  }

  /**
   * Kick a manual scrub (runs on the next background tick, honoring the byte/object
   * budget) and refresh the status. A toast reflects the outcome; the actual
   * re-hash is asynchronous, so `refresh` shows the state at trigger time.
   */
  async scrubNow(): Promise<void> {
    this._scrubbing.set(true);
    const run = firstValueFrom(this.api.startIntegrityScrub()).then(() => this.refresh());
    notify.promise(run, {
      loading: 'Requesting integrity scrub…',
      success: 'Scrub requested — runs on the next tick',
      error: 'Failed to request scrub',
    });
    try {
      await run;
    } catch {
      /* surfaced by the toast */
    } finally {
      this._scrubbing.set(false);
    }
  }
}
