import type { Gauge } from 'prom-client';

/**
 * Reconcile a per-`bucket` {@link Gauge} against the CURRENT set of live buckets
 * (STORY-1202, TASK-3622). Called from the usage-rollup tick so the gauge tracks
 * exactly the buckets that exist right now:
 *
 *  - sets `value = valueFor(bucket)` for every live bucket, and
 *  - REMOVES any previously-set series whose bucket is no longer live.
 *
 * The eviction is the cardinality control (CWE-770): a deleted bucket's series
 * disappears on the next tick instead of lingering forever, so the gauge's
 * label cardinality tracks the live bucket count rather than every bucket that
 * has ever existed. Only the bucket NAME is a label (already public in the admin
 * API) — never any credential/endpoint.
 */
export async function reconcileGauge(
  gauge: Gauge<'bucket'>,
  live: Set<string>,
  valueFor: (bucket: string) => number,
): Promise<void> {
  // Set/refresh every live bucket first.
  for (const bucket of live) gauge.set({ bucket }, valueFor(bucket));

  // Then evict stale series: read the gauge's current label set and remove any
  // bucket that is no longer live.
  const current = await gauge.get();
  for (const series of current.values) {
    const bucket = series.labels.bucket;
    if (typeof bucket === 'string' && !live.has(bucket)) gauge.remove(bucket);
  }
}
