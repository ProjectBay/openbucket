import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/core';

import { AuditLogRepository } from '../repositories/audit-log.repository';

/**
 * A persisted admin audit event (§5.9, STORY-1103). The durable counterpart to
 * the Pino `audit: true` line: {@link AuditSink} normalizes each
 * `AuditService.emit` into one of these rows and the flush tick batch-inserts
 * them, so the admin console can query history the log stream can't.
 *
 * The primary key is a uuid **v7** (time-ordered) so `(ts, id)` is a stable,
 * monotone keyset-paging cursor even when many events share a millisecond `ts`.
 * Only `event`/`subject`/`bucket` (plus the `ts` range) are filterable and every
 * one is indexed alongside `ts` — no query degrades to a table scan (EPIC-08
 * DoS posture). `detail` holds the remaining whitelisted, secret-stripped fields
 * as JSON.
 */
@Entity({ tableName: 'audit_logs', repository: () => AuditLogRepository })
@Index({ name: 'ix_audit_ts', properties: ['ts'] })
@Index({ name: 'ix_audit_event_ts', properties: ['event', 'ts'] })
@Index({ name: 'ix_audit_subject_ts', properties: ['subject', 'ts'] })
@Index({ name: 'ix_audit_bucket_ts', properties: ['bucket', 'ts'] })
export class AuditLog {
  @PrimaryKey({ type: 'string', length: 64 })
  id!: string; // uuid v7 — time-ordered, pairs with `ts` for keyset paging

  /** Event time (UTC; forceUtcTimezone). Stamped at emit time, not flush time. */
  @Property({ type: 'datetime' })
  ts!: Date;

  /** Catalogue name, e.g. `bucket.created` (see AUDIT_EVENT_CATALOG). */
  @Property({ type: 'string', length: 64 })
  event!: string;

  /** The acting admin subject; null for events with no subject (e.g. admin.login.failed). */
  @Property({ type: 'string', length: 256, nullable: true })
  subject?: string | null;

  @Property({ type: 'string', length: 64, nullable: true })
  requestId?: string | null;

  @Property({ type: 'string', length: 256, nullable: true })
  bucket?: string | null;

  @Property({ type: 'string', length: 1024, nullable: true })
  objectKey?: string | null;

  @Property({ type: 'string', length: 64, nullable: true })
  keyId?: string | null;

  @Property({ type: 'string', length: 64, nullable: true })
  ip?: string | null;

  /** JSON of the remaining whitelisted fields (secret-stripped, size-capped). */
  @Property({ type: 'text', nullable: true })
  detail?: string | null;
}
