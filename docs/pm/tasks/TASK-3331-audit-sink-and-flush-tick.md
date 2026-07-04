---
id: TASK-3331
title: Buffered dual-write sink + background flush/retention tick
story: STORY-1103
status: backlog
type: implementation
size: M
---

## Description
Make `AuditService.emit` durable without slowing request handlers. Add a singleton `AuditSink` that normalizes each event into a bounded in-memory ring buffer, and an `AuditFlushRunner` (a `ScheduledTask`) that batch-inserts drained rows inside a per-tick MikroORM `RequestContext` and prunes rows past retention. Wire `AuditSink` as `@Global()` so the several locally-provided `AuditService` instances resolve the same buffer; keep the existing Pino line intact.

## Files to create / modify
- `libs/nestjs/src/lib/admin/audit/audit-sink.ts` — new (`AuditSink`, `AuditRow`)
- `libs/nestjs/src/lib/admin/audit/audit-flush.runner.ts` — new (`AuditFlushRunner implements ScheduledTask`)
- `libs/nestjs/src/lib/admin/audit/audit.module.ts` — new (`@Global()` module: provides `AuditSink`, registers the runner under `SCHEDULED_TASKS`)
- `libs/nestjs/src/lib/admin/audit/audit.service.ts` — modify (dual-write to the optional sink)
- `libs/nestjs/src/lib/open-bucket-core.module.ts` — modify (import `AuditModule`)
- `libs/nestjs/src/lib/common/config/app-config.service.ts` + the env schema — modify (add `AUDIT_RETENTION_DAYS`, `AUDIT_FLUSH_MS`, `AUDIT_BUFFER_MAX`)
- `.env.example` — modify (document the three knobs)

## Implementation notes
- `AuditSink` (singleton) buffers, never touches the DB itself (kept off the request path):
  ```ts
  export interface AuditRow {
    id: string; ts: Date; event: string;
    subject: string | null; requestId: string | null; bucket: string | null;
    objectKey: string | null; keyId: string | null; ip: string | null;
    detail: string | null;
  }
  @Injectable()
  export class AuditSink {
    private buf: AuditRow[] = [];
    private dropped = 0;
    record(e: AuditEvent): void;      // normalize → AuditRow (uuid v7 id, ts = new Date()), push; if buf.length >= max, shift() oldest and dropped++
    drain(max = 1000): AuditRow[];    // splice up to max rows for the flusher
  }
  ```
  - Normalization maps known catalogue keys to columns (`subject`, `requestId`, `bucket`, `key`→`objectKey`, `keyId`, `ip`); everything else goes into `detail`.
  - **Secret stripping (do not regress EPIC-08):** before serializing `detail`, delete any key matching `/(secret|password|hash|token|authorization|cookie)/i`; `JSON.stringify` then hard-cap to ~2 KiB (drop `detail` if larger). The v1 catalogue never carries secrets, but this is defense-in-depth against future callers.
  - **DoS bound:** `max = config.auditBufferMax` (default 10_000). Drop-oldest keeps a burst (or a stalled flusher) from exhausting heap; increment `dropped` and let the flusher log a warning when non-zero.
- `AuditFlushRunner` mirrors `trash-purge.runner.ts` (`readonly name`, `readonly intervalMs`, `run()`), injecting `AuditSink` and `AuditLogRepository`:
  - `intervalMs = config.auditFlushMs` (default 2000).
  - `run()`: loop `drain()` while non-empty → `repo.insertMany(batch)`; then a once-per-day retention pass (guard on a stored `lastPruneDay`) calling `repo.pruneOlderThan(new Date(Date.now() - retentionDays*86_400_000))`. If `sink` reports drops since last tick, `log.warn`. The scheduler already wraps `run()` in a `RequestContext` and skips overlapping ticks, so no identity-map leakage and no pile-up.
- Register the runner: `{ provide: SCHEDULED_TASKS, useClass: AuditFlushRunner, multi: true }` inside `AuditModule` (import `SCHEDULED_TASKS` from `common/background/background.service`). `AuditModule` is `@Global()` (like `PersistenceModule`) and exports `AuditSink`.
- `AuditService.emit` change — keep Pino, add sink (optional so spec-export/unit tests without the global module still work):
  ```ts
  constructor(@Optional() private readonly sink?: AuditSink) {}
  emit(event: AuditEvent): void {
    this.logger.log({ ...event, audit: true });   // unchanged — operator tooling must not regress
    this.sink?.record(event);
  }
  ```
- Edge cases: an insert failure inside `run()` is caught by the scheduler's try/catch (rows already drained are lost, but the Pino line survived — acceptable, logged); on shutdown the scheduler awaits the in-flight tick, so a final flush completes. `AuditRow.ts` is set at `record()` time (emit time), not flush time, so ordering is faithful even under buffering.

## Acceptance criteria
- [ ] Calling `AuditService.emit(...)` still logs the `audit: true` Pino record AND enqueues one `AuditRow`.
- [ ] After one flush interval, emitted events are present in `audit_logs` with correct column mapping (`key`→`object_key`).
- [ ] A `detail` payload containing `secretAccessKey`/`password` persists with those keys removed; an oversized `detail` is dropped/truncated.
- [ ] With `AUDIT_BUFFER_MAX` exceeded, oldest rows are dropped (buffer length capped) and a warning is logged; the process memory stays bounded.
- [ ] Rows older than `AUDIT_RETENTION_DAYS` are removed by the tick; `nx test nestjs --testPathPattern=audit` passes.

## Test obligations
- Unit: covered by [TEST-1103] (sink normalization/stripping/bounding, runner flush+prune)
- E2E: covered by [TEST-1103] (emit → queryable row)
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-3330], [STORY-0413]
</content>
