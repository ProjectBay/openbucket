import { Entity, PrimaryKey, Property, Unique } from '@mikro-orm/core';

/** Scope of a reconcile/backfill job: one bucket or the whole instance. */
export type ReconcileScope = 'instance' | 'bucket';

/** Lifecycle of a reconcile job. `queued`/`running` are the active states (at
 *  most one at a time — enforced by the `active_flag` unique index); `completed`
 *  and `failed` are terminal. */
export type ReconcileState = 'queued' | 'running' | 'completed' | 'failed';

/** Sentinel value stamped on `activeFlag` while a job is queued/running. NULL on
 *  terminal rows so the unique index (which treats NULLs as distinct) admits any
 *  number of finished jobs but at most one active one. */
export const RECONCILE_ACTIVE_FLAG = 'active';

/**
 * A durable reconcile/backfill job (STORY-0902). Started via
 * `ReconcileService.start` and executed by the `ReconcileRunner` background task:
 * it pages local objects, diffs them against `ListObjectsV2` on the remote S3
 * target, and re-enqueues any missing/divergent object into the
 * `replication_outbox`. Persisted so a job survives a restart (resuming from
 * `cursorBucket`/`cursorKey`) and the admin console can poll its progress.
 *
 * `bucket` is a plain string (NOT a FK): a bucket deleted mid-scan must not drop
 * the job row — the runner finishes it gracefully. No remote endpoint or
 * credential is ever stored here; `error` carries only a redacted message.
 */
@Entity({ tableName: 'reconcile_job' })
export class ReconcileJob {
  /** uuidv7 — service-generated, time-sortable. */
  @PrimaryKey({ type: 'string', length: 64 })
  id!: string;

  @Property({ type: 'string', length: 16 })
  scope!: ReconcileScope;

  /** Target bucket for a `bucket`-scoped job; null for `instance` scope. Plain
   *  string so a mid-scan bucket delete does not cascade-delete the job. */
  @Property({ type: 'string', length: 63, nullable: true })
  bucket?: string;

  @Property({ type: 'string', length: 16, default: 'queued' })
  state: ReconcileState = 'queued';

  /** Local object rows scanned so far. */
  @Property({ type: 'integer', default: 0 })
  localScanned = 0;

  /** Remote objects observed in the scanned windows. */
  @Property({ type: 'integer', default: 0 })
  remoteScanned = 0;

  /** Objects found missing/divergent on the remote and re-enqueued. */
  @Property({ type: 'integer', default: 0 })
  missingRequeued = 0;

  /** Resume point — the bucket the last processed batch belonged to. */
  @Property({ type: 'string', length: 63, nullable: true })
  cursorBucket?: string;

  /** Resume point — the last local key fully processed. */
  @Property({ type: 'text', nullable: true })
  cursorKey?: string;

  /** The admin subject that started the job (for the completion audit event). */
  @Property({ type: 'string', length: 255, nullable: true })
  subject?: string;

  @Property({ type: 'datetime', nullable: true })
  startedAt?: Date;

  @Property({ type: 'datetime', nullable: true })
  finishedAt?: Date;

  /** Redacted failure message (never any remote endpoint/credential). */
  @Property({ type: 'text', nullable: true })
  error?: string;

  /**
   * Single-flight guard. `'active'` while queued/running, NULL when terminal.
   * The unique index treats NULLs as distinct, so any number of finished jobs
   * coexist but a second concurrent active job fails the constraint — the DoS
   * guard that bounds remote-listing scans to one at a time.
   */
  @Unique({ name: 'uq_reconcile_active' })
  @Property({ type: 'string', length: 8, nullable: true })
  activeFlag?: string | null;

  @Property({ type: 'datetime' })
  createdAt: Date = new Date();
}
