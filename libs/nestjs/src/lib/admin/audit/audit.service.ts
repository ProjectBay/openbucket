import { Injectable, Logger, Optional } from '@nestjs/common';

import { AuditSink } from './audit-sink';

/**
 * The canonical v1 audit-event catalogue — the single source of truth for the
 * event names callers may `emit` and the filter dropdown the viewer exposes
 * (STORY-1103). Kept next to the JSDoc table below; `AuditQueryService.catalog`
 * returns it so the SPA needs no `distinct` table scan.
 */
export const AUDIT_EVENT_CATALOG = [
  'admin.login',
  'admin.login.failed',
  'admin.logout',
  'admin.password.changed',
  'bucket.created',
  'bucket.deleted',
  'bucket.versioning.changed',
  'bucket.tagging.changed',
  'bucket.encryption.changed',
  'bucket.lifecycle.changed',
  'bucket.cors.changed',
  'bucket.objectlock.changed',
  'bucket.policy.changed',
  'object.deleted',
  'object.tagging.changed',
  'object.retention.changed',
  'object.legalhold.changed',
  'object.presigned',
  'object.searched',
  'key.created',
  'key.disabled',
  'key.updated',
  'key.rotated',
  'key.revoked',
  'key.deleted',
  'settings.changed',
  'admin.user.created',
  'admin.user.role.changed',
  'admin.user.password.reset',
  'admin.user.deleted',
  'replication.reconcile.started',
  'replication.reconcile.completed',
  'integrity.scrub.started',
] as const;

/**
 * A structured admin audit event (§5.9). `event` and `subject` are always
 * required; callers add event-specific fields (e.g. `bucket`, `keyId`, `ip`)
 * via the open index signature. `requestId` is populated by the request-id
 * middleware when present.
 */
export interface AuditEvent {
  event: string;
  subject: string;
  requestId?: string;
  [k: string]: unknown;
}

/**
 * Structured admin-event emitter (§5.9): the audit log for state-changing admin
 * actions. Every event is written as a Pino record under context `admin.audit`
 * with `audit: true` so downstream tooling can index admin activity reliably.
 * Read-only `GET` calls are NOT audited at v1 — they would dwarf the stream.
 *
 * Canonical v1 event catalogue (callers must use these names):
 *
 * | Event                       | Emitted when              | Required fields                 |
 * |-----------------------------|---------------------------|---------------------------------|
 * | `admin.login`               | successful login          | `subject`, `ip`                 |
 * | `admin.login.failed`        | failed login attempt      | `username`, `ip` (no `subject`) |
 * | `admin.logout`              | logout call               | `subject`                       |
 * | `admin.password.changed`    | password rotated          | `subject`                       |
 * | `bucket.created`            | new bucket                | `subject`, `bucket`             |
 * | `bucket.deleted`            | bucket dropped            | `subject`, `bucket`             |
 * | `bucket.versioning.changed` | versioning toggled        | `subject`, `bucket`, `from`, `to` |
 * | `bucket.tagging.changed`    | bucket tags set/cleared   | `subject`, `bucket`             |
 * | `bucket.encryption.changed` | default encryption set    | `subject`, `bucket`             |
 * | `bucket.lifecycle.changed`  | lifecycle rules set       | `subject`, `bucket`             |
 * | `bucket.cors.changed`       | CORS rules set/cleared    | `subject`, `bucket`             |
 * | `bucket.objectlock.changed` | object-lock config set    | `subject`, `bucket`             |
 * | `bucket.policy.changed`     | bucket policy set/cleared | `subject`, `bucket`             |
 * | `object.deleted`            | object purge via admin    | `subject`, `bucket`, `key`      |
 * | `object.tagging.changed`    | object tags set/cleared   | `subject`, `bucket`, `key`      |
 * | `object.retention.changed`  | object retention set      | `subject`, `bucket`, `key`      |
 * | `object.legalhold.changed`  | object legal hold set     | `subject`, `bucket`, `key`      |
 * | `object.presigned`          | presigned URL minted      | `subject`, `bucket`, `key`, `expiresIn` |
 * | `object.searched`           | cross-bucket search run   | `subject`, `mode`, `hasTag`, `count` (never the raw `q`) |
 * | `key.created`               | access key minted         | `subject`, `keyId`              |
 * | `key.disabled`              | access key disabled       | `subject`, `keyId`              |
 * | `key.updated`               | access key edited         | `subject`, `keyId`              |
 * | `key.rotated`               | access key secret rolled  | `subject`, `keyId`              |
 * | `key.revoked`               | access key revoked (disabled) | `subject`, `keyId`          |
 * | `key.deleted`               | access key removed        | `subject`, `keyId`              |
 * | `settings.changed`          | settings update           | `subject`, `field`              |
 * | `admin.user.created`        | admin user created        | `subject`, `target`, `role`     |
 * | `admin.user.role.changed`   | admin role reassigned     | `subject`, `target`, `from`, `to` |
 * | `admin.user.password.reset` | admin password reset by peer | `subject`, `target`          |
 * | `admin.user.deleted`        | admin user deleted        | `subject`, `target`             |
 * | `replication.reconcile.started`   | reconcile job accepted | `subject`, `jobId`, `bucket?` |
 * | `replication.reconcile.completed` | reconcile job finished | `subject`, `jobId`, `localScanned`, `remoteScanned`, `missingRequeued` |
 *
 * NOTE: the replication reconcile events NEVER carry the remote target's
 * endpoint, bucket, or credentials — only the local job id/counts/subject.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger('admin.audit');

  /**
   * The durable sink is `@Optional`: spec-export and unit tests construct
   * `AuditService` without the `@Global` AuditModule, and the Pino line must
   * still fire in that case (operator tooling must not regress).
   */
  constructor(@Optional() private readonly sink?: AuditSink) {}

  emit(event: AuditEvent): void {
    // nestjs-pino flattens the object argument into the JSON record, so each
    // field on `event` becomes a top-level key alongside `audit: true`.
    this.logger.log({ ...event, audit: true });
    // Dual-write to the buffered durable store (drained by AuditFlushRunner).
    this.sink?.record(event);
  }
}
