import { Injectable, Logger } from '@nestjs/common';

import {
  DerivativeCacheService,
  type DerivativeEntry,
} from '../../storage/derivative-cache.service';
import { AppConfigService } from '../config/app-config.service';
import { Clock } from '../clock/clock';
import { ScheduledTask } from './background.service';

const TEN_MIN = 10 * 60_000;
const GC_BATCH = 500;
/** Evict down to this fraction of the cap so GC doesn't run every tick at the edge. */
const LOW_WATER = 0.9;

/**
 * Keeps the content-addressed derivative store (STORY-0800) under
 * `DERIVATIVE_CACHE_MAX_BYTES` by evicting least-recently-used entries, and
 * reclaims entries orphaned by source overwrites — an overwritten source gets a
 * new ETag → a new cache key → the old derivative is never requested again and
 * ages out via LRU, so no DB join is needed (a pure filesystem sweep like
 * `TrashPurgeRunner`).
 *
 * This is the backstop that turns "attacker inflates the cache with distinct
 * `?w=` values" from a disk-fill DoS into a bounded, self-evicting store. Runs
 * every 10 min, reads the Clock so tests can fast-forward, yields between
 * batches, and tolerates a per-entry failure without aborting the sweep.
 */
@Injectable()
export class DerivativeCacheGcRunner implements ScheduledTask {
  readonly name = 'derivative-cache-gc';
  readonly intervalMs = TEN_MIN;
  private readonly log = new Logger(DerivativeCacheGcRunner.name);

  constructor(
    private readonly cache: DerivativeCacheService,
    private readonly config: AppConfigService,
    // Clock is injected to match the runner pattern (fast-forwardable in tests);
    // eviction ordering reads each entry's own mtime, not wall-clock.
    private readonly clock: Clock,
  ) {}

  async run(): Promise<void> {
    const max = this.config.derivativeCacheMaxBytes;
    if (max === 0) return; // unbounded — operator opt-in (discouraged)

    // Walk the whole store, summing size. listEntries tolerates an absent dir.
    const entries: DerivativeEntry[] = [];
    let total = 0;
    for await (const entry of this.cache.listEntries()) {
      entries.push(entry);
      total += entry.size;
    }
    if (total <= max) return; // under the cap — nothing to do

    // LRU: oldest access (mtime) first. A cache hit bumps mtime via
    // DerivativeCacheService.touch, so this is genuine LRU, not just write-time.
    entries.sort((a, b) => a.mtimeMs - b.mtimeMs);

    const target = max * LOW_WATER;
    let evicted = 0;
    for (let i = 0; i < entries.length; i += GC_BATCH) {
      for (const entry of entries.slice(i, i + GC_BATCH)) {
        if (total <= target) break;
        try {
          await this.cache.evict(entry.path);
          total -= entry.size;
          evicted++;
        } catch (err) {
          this.log.error(`derivative-cache-gc: failed to evict ${entry.path}`, err as Error);
        }
      }
      if (total <= target) break;
      // Yield between batches so request handlers aren't starved.
      await new Promise((r) => setImmediate(r));
    }

    if (evicted > 0) {
      this.log.log(
        `derivative-cache-gc: evicted ${evicted} entr${evicted === 1 ? 'y' : 'ies'} ` +
          `(store now ~${total} bytes, cap ${max})`,
      );
    }
  }
}
