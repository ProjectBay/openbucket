import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/libsql';
import { InjectEntityManager } from '@mikro-orm/nestjs';

import { Bucket, BucketRepository, LifecycleState } from '../../persistence/index';
import { OPEN_BUCKET_ORM_CONTEXT } from '../../persistence/orm-context';

import type { ExpirationRule } from '../../common/background/lifecycle-sweep.runner';

/**
 * Lifecycle domain seam (EPIC-03) consumed by the LifecycleSweepRunner (§4.10).
 * Flattens every bucket's *enabled* expiration rules into `ExpirationRule[]` and
 * persists each rule's resume cursor in the `lifecycle_state` table.
 *
 * Rule ids are unique only *within* a bucket and the `lifecycle_state` PK is
 * composite `(bucket, ruleId)`, but the runner's cursor API keys by a single
 * string. We therefore expose a composite `${bucket}/${ruleId}` as the rule id
 * (bucket names never contain `/`, so the first `/` splits it cleanly) and
 * resolve it back to the row here.
 */
@Injectable()
export class LifecycleService {
  constructor(
    private readonly buckets: BucketRepository,
    @InjectEntityManager(OPEN_BUCKET_ORM_CONTEXT) private readonly em: EntityManager,
  ) {}

  /** Every Enabled, day-based expiration rule across all buckets. */
  async activeExpirationRules(): Promise<ExpirationRule[]> {
    const buckets = await this.buckets.listAll();
    const out: ExpirationRule[] = [];
    for (const b of buckets) {
      (b.lifecycle ?? []).forEach((r, i) => {
        if (r.status !== 'Enabled') return;
        // v1 models only Days-based expiration (no absolute Date in LifecycleRule).
        if (r.expirationDays == null) return;
        const rawId = r.id && r.id.length > 0 ? r.id : `rule-${i}`;
        out.push({
          ruleId: `${b.name}/${rawId}`,
          bucket: b.name,
          prefix: r.prefix ?? '',
          days: r.expirationDays,
        });
      });
    }
    return out;
  }

  /** Resume cursor for a rule, or `null` when none is stored / sweep is complete. */
  async loadCursor(ruleId: string): Promise<string | null> {
    const { bucket, rule } = splitRuleId(ruleId);
    const row = await this.em
      .fork()
      .findOne(LifecycleState, { bucket: { name: bucket }, ruleId: rule });
    return row?.lastKeyProcessed ?? null;
  }

  /** Persist (or clear, when `cursor` is `null`) a rule's resume cursor. */
  async saveCursor(ruleId: string, cursor: string | null): Promise<void> {
    const { bucket, rule } = splitRuleId(ruleId);
    const em = this.em.fork();
    let row = await em.findOne(LifecycleState, { bucket: { name: bucket }, ruleId: rule });
    if (!row) {
      const bucketRow = await em.findOne(Bucket, { name: bucket });
      if (!bucketRow) return; // bucket removed between scan and save — nothing to track
      row = em.create(LifecycleState, { bucket: bucketRow, ruleId: rule });
    }
    row.lastKeyProcessed = cursor ?? undefined;
    row.lastSweepAt = new Date();
    await em.persistAndFlush(row);
  }
}

/** Split the composite `${bucket}/${ruleId}` key; bucket names never contain `/`. */
function splitRuleId(composite: string): { bucket: string; rule: string } {
  const i = composite.indexOf('/');
  if (i === -1) return { bucket: composite, rule: '' };
  return { bucket: composite.slice(0, i), rule: composite.slice(i + 1) };
}
