import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/core';

/**
 * A point-in-time storage sample for one bucket, written by the usage-rollup
 * runner (STORY-1102, TASK-3320). Backs the storage-over-time series and the
 * per-bucket breakdown on the analytics dashboard.
 *
 * `bucketName` is a PLAIN column, deliberately NOT a `@ManyToOne` FK to `buckets`
 * (unlike {@link LifecycleState}): deleting a bucket must NOT cascade-erase its
 * historical samples, or the instance storage-over-time line would retroactively
 * drop. The breakdown endpoint filters to still-existing buckets at read time
 * (TASK-3323); the storage series sums across every row.
 */
@Entity({ tableName: 'usage_samples' })
@Index({ name: 'ix_usage_samples_sampled_at', properties: ['sampledAt'] })
@Index({ name: 'ix_usage_samples_bucket_sampled', properties: ['bucketName', 'sampledAt'] })
export class UsageSample {
  @PrimaryKey({ type: 'string' })
  id!: string; // uuid v7 — generated in the runner

  @Property({ type: 'string', length: 63 })
  bucketName!: string;

  @Property({ type: 'datetime' })
  sampledAt!: Date;

  @Property({ type: 'bigint' })
  sizeBytes = 0n;

  @Property({ type: 'integer' })
  objectCount = 0;
}
