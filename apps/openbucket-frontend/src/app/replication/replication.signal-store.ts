import { Injectable, computed, inject, signal } from '@angular/core';
import {
  ReconcileJobDto,
  ReplicationAdminService,
  ReplicationStatusDto,
} from '@openbucket/api-client';
import { firstValueFrom } from 'rxjs';

import { notify } from '../shared/ui/notify';

/** Interval (ms) at which a running reconcile job is polled to completion. */
const POLL_INTERVAL_MS = 2000;

/**
 * Signal store for the replication console (STORY-0902) — readonly signals over
 * the generated `ReplicationAdminService`. `refresh()` loads the read model;
 * `reconcile()` starts a backfill job and polls it to a terminal state, driving
 * a `notify.promise` and refreshing the status at the end. Overlapping polls are
 * guarded and the timer is always cleared.
 */
@Injectable({ providedIn: 'root' })
export class ReplicationSignalStore {
  private readonly api = inject(ReplicationAdminService);

  private readonly _status = signal<ReplicationStatusDto | null>(null);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _job = signal<ReconcileJobDto | null>(null);

  readonly status = this._status.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly job = this._job.asReadonly();

  /** True while a reconcile job is queued/running (buttons disable on this). */
  readonly reconciling = computed(() => {
    const s = this._job()?.state;
    return s === 'queued' || s === 'running';
  });

  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  /** Load the replication read model (`getReplicationStatus`). */
  async refresh(): Promise<void> {
    this._loading.set(true);
    this._error.set(null);
    try {
      const res = await firstValueFrom(this.api.getReplicationStatus());
      this._status.set(res ?? null);
    } catch (e) {
      this._error.set((e as Error).message);
    } finally {
      this._loading.set(false);
    }
  }

  /**
   * Start a reconcile job (whole-instance when `bucket` is omitted) and poll it
   * to completion, then refresh the status. Rejects the caller only on the
   * start call; polling failures resolve so the toast reflects the outcome.
   */
  async reconcile(bucket?: string): Promise<void> {
    const start = firstValueFrom(this.api.startReconcile({ bucket }));
    // A single tracking promise drives both the toast and the awaited control
    // flow, so the job is started once and polled by exactly one loop.
    const tracking = this.trackToCompletion(start);
    notify.promise(tracking, {
      loading: bucket ? `Reconciling bucket "${bucket}"…` : 'Reconciling all buckets…',
      success: 'Reconcile complete',
      error: 'Reconcile failed',
    });
    await tracking.catch(() => undefined);
  }

  /** Await start, then poll the job until it reaches a terminal state. */
  private async trackToCompletion(start: Promise<ReconcileJobDto>): Promise<ReconcileJobDto> {
    const job = await start;
    this._job.set(job);
    if (job.state === 'completed' || job.state === 'failed') {
      await this.refresh();
      return job;
    }
    const final = await this.pollJob(job.jobId);
    await this.refresh();
    if (final.state === 'failed') throw new Error(final.error ?? 'reconcile failed');
    return final;
  }

  /** Poll a single job on an interval until it is completed/failed. */
  private pollJob(jobId: string): Promise<ReconcileJobDto> {
    this.clearTimer();
    return new Promise<ReconcileJobDto>((resolve, reject) => {
      let inFlight = false;
      const tick = async (): Promise<void> => {
        if (inFlight) return; // guard against overlapping polls
        inFlight = true;
        try {
          const job = await firstValueFrom(this.api.getReconcileJob(jobId));
          this._job.set(job);
          if (job.state === 'completed' || job.state === 'failed') {
            this.clearTimer();
            resolve(job);
            return;
          }
        } catch (e) {
          this.clearTimer();
          reject(e as Error);
          return;
        } finally {
          inFlight = false;
        }
      };
      this.pollTimer = setInterval(() => void tick(), POLL_INTERVAL_MS);
      void tick();
    });
  }

  private clearTimer(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /** Release the poll timer (call from the component's ngOnDestroy). */
  destroy(): void {
    this.clearTimer();
  }
}
