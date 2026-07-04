---
id: STORY-0902
title: Replication status, reconciliation & admin UI
epic: EPIC-10
status: backlog
size: M
risk: medium
---

## User story

As an operator, I want to see how far my replication to the external S3 target is
lagging, what the last failure was, and be able to trigger a reconcile/backfill of
any objects missing on the remote, so that I can trust cloud durability and recover
after a remote outage without dropping to the CLI or reading Pino logs.

## Description

This Story adds the observability + recovery surface on top of the durable
replication outbox delivered by [STORY-0900]. It produces a read-model service
that aggregates outbox depth (pending intents), replication lag (age of the oldest
pending intent), the last error, and a per-bucket breakdown; a JWT-guarded admin
REST surface under `/api/admin/replication`; a bounded, single-flight
reconcile/backfill job that lists local objects, diffs them against
`ListObjectsV2` on the remote target, and re-enqueues any missing/divergent object
into the existing outbox; and an Angular console page (signals-based) that shows
the status, streams reconcile progress, and lives beside the existing
backup/restore page. It consumes existing infra only — the `common/background`
tick, `domain/objects` listing, `storage/key-codec`, the global `JwtAuthGuard`,
throttler, and `AuditService` — and regenerates the committed `@openbucket/api-client`.

## Acceptance criteria

- [ ] `GET /api/admin/replication/status` returns instance-level `{ enabled, pendingCount, inflightCount, failedCount, oldestPendingAgeMs, lastError, perBucket[] }` and requires a valid admin JWT (401 without one).
- [ ] When no replication target is configured (`enabled: false`), the endpoint returns `200` with zeroed counters and the UI shows a "replication not configured" empty state rather than an error.
- [ ] `POST /api/admin/replication/reconcile` (optionally `{ bucket }`) starts at most one reconcile job at a time; a second concurrent request while a job is running returns `409 Conflict` and does not spawn a second scan.
- [ ] A reconcile of a bucket whose remote is missing N objects re-enqueues exactly those N objects into `replication_outbox` (verified by pending count delta) and is idempotent — a second reconcile after drain re-enqueues 0.
- [ ] Local keys are compared against the remote using the decoded S3 key (via `decodeKey` from `storage/key-codec`), so keys containing `/`, UTF-8, or percent-escapes reconcile correctly and are not double-counted.
- [ ] The reconcile runner is bounded: it pages local + remote in batches, yields to the event loop between batches, caps work per tick, and never holds the `EntityManager` open across a full scan (mirrors `LifecycleSweepRunner`).
- [ ] Remote target credentials/endpoint are never written to the audit log or returned in any DTO; `reconcile.started`/`reconcile.completed` audit events carry only `subject`, `bucket?`, `jobId`, counts.
- [ ] The Angular `/replication` page renders lag/depth/last-error stat cards, a per-bucket table, and a "Reconcile" action guarded by the shared confirm dialog; reconcile progress polls to completion with a toast.
- [ ] The committed `@openbucket/api-client` is byte-equal to a fresh `nx run api-client:generate` (new `ReplicationAdminService` + models present).

## Tasks

- [TASK-2720] Build the replication status read-model service and DTOs
- [TASK-2721] Add the admin replication controller and module wiring
- [TASK-2722] Implement the bounded reconcile/backfill job runner
- [TASK-2723] Build the Angular replication console page and signal store
- [TASK-2724] Regenerate the OpenAPI client and wire the byte-equal check

## Test plan

- [TEST-0902] Replication status aggregation and reconcile backfill

## Dependencies

- Blocks: —
- Blocked by: [STORY-0900] — consumes the `ReplicationOutbox` entity /
  `replication_outbox` table, `ReplicationService.enqueue(...)`, the resolved
  replication target config, and the S3 target client factory it introduces.
- Reuses [EPIC-08] security posture without regression: the global `JwtAuthGuard`
  (`admin/auth/jwt-auth.guard.ts`) authenticates every route; the `default`
  throttler bucket (`admin/admin.module.ts`) rate-limits them; reconcile is
  single-flight so it cannot be used to amplify load against the remote (DoS);
  local↔remote key comparison uses `storage/key-codec` `decodeKey`.

## References

- `libs/nestjs/src/lib/admin/backup/backup.controller.ts`, `backup.module.ts` — closest module/UI analog (a whole-instance admin job beside per-bucket).
- `libs/nestjs/src/lib/common/background/lifecycle-sweep.runner.ts`, `background.service.ts` — batched, no-pile-up, RequestContext-per-tick runner pattern.
- `libs/nestjs/src/lib/admin/buckets/buckets-admin.controller.ts`, `dto/lifecycle.dto.ts` — controller + nestjs-zod DTO (`.meta({ id })`) conventions.
- `libs/nestjs/src/lib/domain/objects/object.service.ts` (`list`, `statsFor`, `scanForLifecycle`) — indexed prefix range-scan reused for the local side of the diff.
- `libs/nestjs/src/lib/storage/key-codec.ts` (`decodeKey`) — local filename → S3 key.
- `libs/nestjs/src/lib/admin/admin.module.ts` (`ADMIN_CONTROLLER_MODULES`), `open-bucket.module.ts` (RouterModule children) — where the new module mounts.
- `libs/nestjs/src/lib/admin/audit/audit.service.ts` — audit event catalogue to extend.
- `apps/openbucket-frontend/src/app/backup-restore/backup-restore.component.ts`, `buckets/buckets.signal-store.ts`, `app.routes.ts`, `layout/sidebar/data/sidebar.data.ts`, `shared/ui/{stat-card,list-state,confirm-dialog,notify}` — SPA patterns.
- `libs/api-client/project.json` (`generate` / byte-equal `check` targets); `apps/openbucket-backend/project.json` (`openapi:export`).
- Interfaces consumed (from STORY-0900): `ReplicationOutbox` entity, `ReplicationService`, resolved target config, S3 target client factory.
- Interfaces produced: `ReplicationStatusService`, `ReconcileService` / `ReconcileRunner`, `ReplicationAdminController`, `ReplicationAdminModule`, `ReplicationAdminService` (client).
- Existing deps reused: `@aws-sdk/client-s3` (already in `package.json`), `nestjs-zod`, `zod`.
</content>
</invoke>
