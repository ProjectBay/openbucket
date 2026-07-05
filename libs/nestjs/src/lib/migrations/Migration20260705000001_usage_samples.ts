import { Migration } from '@mikro-orm/migrations';

/**
 * Adds the two usage-telemetry sample tables (STORY-1102, TASK-3320):
 *   - `usage_samples`          — per-bucket storage snapshots over time.
 *   - `request_metric_samples` — per-surface request/error counts per window.
 *
 * Neither table carries an FK to `buckets` (a bucket delete must not cascade-
 * erase its historical samples). Growth is bounded by the retention prune in the
 * usage-rollup runner (TASK-3322). Forward-only in production (§3.3.2); `down()`
 * is for test-suite convenience only.
 */
export class Migration20260705000001_usage_samples extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create table "usage_samples" (` +
        `"id" varchar not null, ` +
        `"bucket_name" varchar(63) not null, ` +
        `"sampled_at" datetime not null, ` +
        `"size_bytes" bigint not null default 0, ` +
        `"object_count" integer not null default 0, ` +
        `constraint "usage_samples_pkey" primary key ("id"));`,
    );
    this.addSql(
      `create index "ix_usage_samples_sampled_at" on "usage_samples" ("sampled_at");`,
    );
    this.addSql(
      `create index "ix_usage_samples_bucket_sampled" on "usage_samples" ("bucket_name", "sampled_at");`,
    );

    this.addSql(
      `create table "request_metric_samples" (` +
        `"id" varchar not null, ` +
        `"sampled_at" datetime not null, ` +
        `"surface" varchar(8) not null, ` +
        `"window_ms" integer not null, ` +
        `"request_count" integer not null default 0, ` +
        `"error_count" integer not null default 0, ` +
        `constraint "request_metric_samples_pkey" primary key ("id"));`,
    );
    this.addSql(
      `create index "ix_request_metric_samples_sampled_at" on "request_metric_samples" ("sampled_at");`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "usage_samples";`);
    this.addSql(`drop table if exists "request_metric_samples";`);
  }
}
