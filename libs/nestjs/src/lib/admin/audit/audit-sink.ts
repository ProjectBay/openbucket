import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';

import type { AuditEvent } from './audit.service';
import type { AuditRow } from '../../persistence/repositories/audit-log.repository';

export type { AuditRow } from '../../persistence/repositories/audit-log.repository';

/** Columns lifted out of the event onto their own {@link AuditRow} field. Every
 *  other event field is folded into `detail`. `key` maps to the `objectKey`
 *  column (the catalogue uses `key`, the row/DB uses `object_key`). */
const COLUMN_KEYS = new Set(['event', 'subject', 'requestId', 'bucket', 'key', 'keyId', 'ip']);

/** Any `detail` key matching this is dropped before serialization — defence in
 *  depth so a future caller can never persist a credential (EPIC-08). */
const SECRET_KEY_RE = /(secret|password|hash|token|authorization|cookie)/i;

/** Hard cap on the serialized `detail` JSON. Larger payloads are dropped, not
 *  truncated (truncation would yield invalid JSON the query API can't parse). */
const DETAIL_MAX_BYTES = 2048;

/** Coerce a scalar-ish value to a nullable string for a fixed column. */
function toStr(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  return typeof v === 'string' ? v : String(v);
}

/**
 * Bounded in-memory audit buffer (STORY-1103, TASK-3331). `AuditService.emit`
 * calls {@link record} on the request path — it only normalizes + pushes, never
 * touching the DB — and the {@link AuditFlushRunner} tick {@link drain}s batches
 * off the request path. A singleton (provided `@Global` by AuditModule) so the
 * several locally-provided `AuditService` instances share one buffer.
 *
 * DoS bound: at `max` rows the oldest is dropped (a stalled flusher or a burst
 * can't exhaust the heap); `dropped` is surfaced so the flusher can warn.
 */
@Injectable()
export class AuditSink {
  private buf: AuditRow[] = [];
  private dropped = 0;

  constructor(private readonly max = 10_000) {}

  /** Normalize an event to a row (uuid-v7 id, `ts = now`) and enqueue it. */
  record(e: AuditEvent): void {
    const detail: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(e)) {
      if (COLUMN_KEYS.has(k) || v === undefined) continue;
      if (SECRET_KEY_RE.test(k)) continue; // never persist a secret
      detail[k] = v;
    }

    let detailJson: string | null = null;
    const keys = Object.keys(detail);
    if (keys.length > 0) {
      try {
        const json = JSON.stringify(detail);
        detailJson = Buffer.byteLength(json, 'utf8') <= DETAIL_MAX_BYTES ? json : null;
      } catch {
        detailJson = null; // non-serializable (e.g. a cycle) → drop detail
      }
    }

    const row: AuditRow = {
      id: uuidv7(),
      ts: new Date(),
      event: e.event,
      subject: toStr(e.subject),
      requestId: toStr(e.requestId),
      bucket: toStr(e.bucket),
      objectKey: toStr(e.key),
      keyId: toStr(e.keyId),
      ip: toStr(e.ip),
      detail: detailJson,
    };

    this.buf.push(row);
    if (this.buf.length > this.max) {
      this.buf.shift(); // drop the oldest
      this.dropped++;
    }
  }

  /** Splice up to `max` buffered rows for the flusher (oldest first). */
  drain(max = 1000): AuditRow[] {
    return this.buf.splice(0, max);
  }

  /** Number of currently buffered rows (test/observability). */
  get size(): number {
    return this.buf.length;
  }

  /** Read-and-reset the drop counter since the last call (flusher warns on > 0). */
  takeDropped(): number {
    const n = this.dropped;
    this.dropped = 0;
    return n;
  }
}
