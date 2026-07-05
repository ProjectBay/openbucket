import { Injectable } from '@nestjs/common';

/** The two request surfaces we tally separately (admin JSON API vs S3 data plane). */
export type Surface = 'admin' | 's3';

/** A per-surface request/error accumulator. */
export interface Accum {
  requestCount: number;
  errorCount: number;
}

/** Number of one-minute slots retained for the live requests-per-minute rate. */
const RING_SLOTS = 60;

/**
 * In-memory request/error counters per surface (STORY-1102, TASK-3321). Two
 * integers per surface plus a 60-slot per-minute ring for the live dashboard
 * rate — O(1) memory regardless of traffic (no per-path/per-IP maps, so no
 * unbounded-cardinality blow-up). Counters are process-local and reset on
 * restart; persisted history lives in `request_metric_samples`, drained by the
 * usage-rollup runner (TASK-3322).
 *
 * Only COUNTS are retained — never URLs, keys, or signatures — so this does not
 * widen the log/secret surface hardened in EPIC-08 (STORY-0705).
 */
@Injectable()
export class RequestMetricsService {
  /** Accumulators drained per rollup tick. */
  private readonly accum: Record<Surface, Accum> = {
    admin: { requestCount: 0, errorCount: 0 },
    s3: { requestCount: 0, errorCount: 0 },
  };

  /** Per-minute request ring, one bucket per wall-clock minute, per surface. */
  private readonly ring: Record<Surface, { minute: number; count: number }[]> = {
    admin: [],
    s3: [],
  };

  /** Record one completed request. `errorCount` is bumped for status `>= 400`. */
  record(surface: Surface, statusCode: number): void {
    const a = this.accum[surface];
    a.requestCount += 1;
    if (statusCode >= 400) a.errorCount += 1;
    this.tickRing(surface);
  }

  /**
   * Atomically read-and-reset the accumulators; the rollup runner calls this
   * once per tick. Single-threaded Node needs no lock: a concurrent `record()`
   * landing between the snapshot and the reset is at worst attributed to the
   * next window.
   */
  drain(): Record<Surface, Accum> {
    const snapshot: Record<Surface, Accum> = {
      admin: { ...this.accum.admin },
      s3: { ...this.accum.s3 },
    };
    this.accum.admin = { requestCount: 0, errorCount: 0 };
    this.accum.s3 = { requestCount: 0, errorCount: 0 };
    return snapshot;
  }

  /**
   * Live requests-per-minute for the last FULL minute on a surface (the
   * dashboard stat card). Reads the ring slot for the previous minute so it
   * reflects a completed window rather than a partial current one.
   */
  ratePerMinute(surface: Surface): number {
    const prevMinute = Math.floor(Date.now() / 60_000) - 1;
    const slot = this.ring[surface].find((s) => s.minute === prevMinute);
    return slot?.count ?? 0;
  }

  /** Increment the current-minute ring slot, pruning slots older than the window. */
  private tickRing(surface: Surface): void {
    const minute = Math.floor(Date.now() / 60_000);
    const ring = this.ring[surface];
    let slot = ring.find((s) => s.minute === minute);
    if (!slot) {
      slot = { minute, count: 0 };
      ring.push(slot);
    }
    slot.count += 1;
    // Bound the ring: drop anything older than RING_SLOTS minutes.
    const cutoff = minute - RING_SLOTS;
    for (let i = ring.length - 1; i >= 0; i--) {
      if (ring[i].minute < cutoff) ring.splice(i, 1);
    }
  }
}
