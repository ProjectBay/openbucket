---
id: TEST-1103
title: Audit-log viewer end-to-end
covers: [STORY-1103, TASK-3330, TASK-3331, TASK-3332, TASK-3333, TASK-3334]
status: backlog
level: integration
---

## Goal
Verify the audit stream is persisted durably, queryable through an admin-only API with keyset paging and filters, secret-safe and DoS-bounded, and browsable in the SPA — without regressing the existing Pino audit line or the EPIC-08 admin authz posture.

## Setup
- Backend: Nest `TestingModule` booting `PersistenceModule` against a temp `DATA_DIR` (libsql file, migrations run on init), plus `AuditModule`, `AuditAdminModule`, and `AuthModule` for JWT minting. Use the `Clock` fake where a runner drives time (as `trash-purge` tests do). `supertest` for HTTP cases.
- Frontend: Angular `TestBed` with `AuditSignalStore` and a mocked `AuditAdminService` (return canned `AuditPageDto`/`AuditCatalogDto`).
- Fixture: a seed helper that emits N catalogue events via `AuditService.emit` (mix of `admin.login`, `admin.login.failed` (null subject), `bucket.created`, `object.deleted`, `key.created`) across a spread of timestamps.

## Cases

### TASK-3330 — entity, repository, migration
1. Given a fresh DB, when migrations run, then table `audit_logs` and indexes `ix_audit_ts`, `ix_audit_event_ts`, `ix_audit_subject_ts`, `ix_audit_bucket_ts` exist.
2. Given 5 `AuditRow`s, when `insertMany` then `query({ limit: 10 })`, then all 5 come back ordered `ts desc, id desc`.
3. Given rows straddling a `(ts, id)` cursor, when `query({ before: cursor, limit: 2 })`, then only rows strictly older than the cursor are returned, and `query` fetches `limit + 1` to signal `hasMore`.
4. Given rows older and newer than a cutoff, when `pruneOlderThan(cutoff)`, then only older rows are deleted and the deleted count is returned.

### TASK-3331 — sink + flush/retention tick
5. Given `AuditService.emit({ event:'bucket.created', subject:'admin', bucket:'b1' })`, then the Pino `Logger.log` is still called with `{ ...event, audit: true }` (existing TEST-0418 behavior intact) AND `AuditSink` buffers one row.
6. Given buffered events, when `AuditFlushRunner.run()` executes, then rows appear in `audit_logs` with correct column mapping — in particular a `key` field maps to `object_key`.
7. Given an event whose extra fields include `secretAccessKey`/`password`/`token`, when flushed, then the persisted `detail` JSON contains none of those keys.
8. Given `AUDIT_BUFFER_MAX = 3` and 5 rapid emits, then the buffer never exceeds 3 (oldest dropped), a drop warning is logged, and the process does not accumulate unbounded rows.
9. Given rows older than `AUDIT_RETENTION_DAYS` and a Clock advanced past a day boundary, when the tick runs, then the stale rows are pruned.

### TASK-3332 — query API
10. Given no `Authorization` header, when `GET /api/admin/audit`, then 401 (global `JwtAuthGuard`); with a valid admin JWT, then 200 with `{ items, nextCursor }`.
11. Given seeded events, when `GET /api/admin/audit?event=key.created`, then only `key.created` rows return; `?subject=admin`, `?bucket=b1`, and `?from=&to=` each narrow correctly and are exact-match (no cross-bucket bleed).
12. Given more rows than `limit`, when paging with the returned `nextCursor`, then the second page continues with no overlap and the final page returns `nextCursor: null`.
13. Given `?limit=500`, then 422 (DTO cap 200); given `?cursor=not-base64`, then 400.
14. When the OpenAPI spec is exported, then it contains `listAuditEvents` and `getAuditCatalog`; `GET /api/admin/audit/catalog` returns the static event-name list.
15. Given a `GET /api/admin/audit`, then NO new `audit_logs` row is written (read-only GETs are not audited).

### TASK-3333 — client generation
16. When `nx run api-client:generate` runs, then `AuditAdminService` + `AuditEvent`/`AuditPageDto`/`AuditCatalogDto` models are emitted and `nx run api-client:check` passes with no drift.

### TASK-3334 — SPA viewer
17. Given `AuditSignalStore.refresh()` with a mocked service, then `items` populates newest-first and `loading` toggles true→false around the call.
18. Given a page with `nextCursor`, when `loadMore()`, then the store appends (not replaces) and `hasMore()` reflects the new cursor; changing a filter resets the cursor and replaces items.
19. Given `AuditLogComponent` rendered, then it shows Time/Event/Actor/Target/IP/Request columns, populates the event dropdown from `getAuditCatalog`, and `detail` is rendered via interpolation (never `innerHTML`).
20. Given the router config, then `/audit` lazy-loads `AuditLogComponent` behind `[authGuard, mustNotRotateGuard]` and the sidebar entry navigates to it; `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass.

## Tooling
- Framework: jest + supertest (backend), Angular TestBed (frontend)
- Runner: `nx test nestjs --testPathPattern=audit`, `nx run api-client:check`, `nx test openbucket-frontend`, `nx build openbucket-frontend`

## Pass criteria
- [ ] Cases 1–4 (persistence) pass.
- [ ] Cases 5–9 (sink/flush/retention, secret-stripping, buffer bound) pass.
- [ ] Cases 10–15 (auth, filters, paging, validation, no-audit-on-GET) pass.
- [ ] Case 16 (client generation gate) passes.
- [ ] Cases 17–20 (SPA store + component + routing) pass.

## References
- `libs/nestjs/src/lib/admin/audit/audit.service.ts`, `libs/nestjs/src/lib/admin/audit/audit.service.spec.ts` (TEST-0418 baseline)
- `libs/nestjs/src/lib/common/background/trash-purge.runner.ts` (Clock-driven tick test pattern)
- `apps/openbucket-backend/src/openapi-export.ts`, `libs/api-client/project.json`
- `apps/openbucket-frontend/src/app/keys/keys.signal-store.ts`, `.../keys/keys-list.component.ts`
</content>
