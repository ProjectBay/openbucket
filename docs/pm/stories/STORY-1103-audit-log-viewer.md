---
id: STORY-1103
title: Audit-log viewer
epic: EPIC-12
status: backlog
size: M
risk: low
---

## User story
As an operator, I want a filterable console view over the audit events the backend already emits (admin logins, bucket/object mutations, key changes), so that I can investigate who changed what and when without grepping Pino JSON on the host.

## Description
Today `AuditService.emit` (`libs/nestjs/src/lib/admin/audit/audit.service.ts`) only writes a Pino line tagged `audit: true` — nothing is queryable. This Story makes the audit stream durable and browsable: a new `audit_logs` table + `AuditLogRepository`, a buffered dual-write sink flushed by a background tick (reusing the `ScheduledTask` scheduler), a read-only admin query API at `GET /api/admin/audit` with keyset pagination and filters by actor/event/bucket/time, and a signals-based Angular viewer at `/audit`. The Pino line stays (operators' existing tooling must not regress) and no read-only `GET` is audited (consistent with the v1 catalogue). Access stays admin-only behind the existing global `JwtAuthGuard`; secrets are never persisted.

## Acceptance criteria
- [ ] Every existing `AuditService.emit(...)` call also lands a row in `audit_logs` (dual-write); the Pino `audit: true` line is unchanged.
- [ ] `GET /api/admin/audit` returns events newest-first with keyset pagination (`limit` ≤ 200, opaque `cursor`) and optional filters `event`, `subject`, `bucket`, `from`, `to`; it is reachable only with a valid admin JWT.
- [ ] Filtered columns (`event`, `subject`, `bucket`, `ts`) are backed by indexes; no query performs an unbounded `%like%` full scan.
- [ ] Secret-bearing fields (secret/password/hash/token/authorization) are stripped before persistence and the `detail` JSON is size-capped; the in-memory buffer is bounded (drop-oldest) so a burst can never exhaust memory.
- [ ] Audit rows survive process restart, and rows older than `AUDIT_RETENTION_DAYS` (default 90) are pruned by the background tick.
- [ ] The `/audit` SPA page lists events with a filter bar (event dropdown, actor/bucket inputs, from/to datetimes) and a "Load more" cursor pager, using the regenerated `@openbucket/api-client`.
- [ ] `nx run api-client:check` passes (client regenerated for the new endpoints) and the OpenAPI export contains `listAuditEvents` + `getAuditCatalog`.

## Tasks
- [TASK-3330] Add AuditLog entity, repository, and migration
- [TASK-3331] Buffered dual-write sink + background flush/retention tick
- [TASK-3332] Audit query service, admin controller, and zod DTOs
- [TASK-3333] Regenerate @openbucket/api-client for the audit endpoints
- [TASK-3334] Build the signals-based audit-log viewer UI

## Test plan
- [TEST-1103] Audit-log viewer end-to-end

## Dependencies
- Blocks: —
- Blocked by: [STORY-0413] (`AuditService.emit` + the v1 event catalogue), [EPIC-08] (admin authz: the global `JwtAuthGuard` + `ThrottlerGuard` this Story reuses — do not regress). Not functionally blocked by the other EPIC-12 stories.

## References
- `libs/nestjs/src/lib/admin/audit/audit.service.ts` — `AuditService.emit`, `AuditEvent`, canonical event catalogue
- `libs/nestjs/src/lib/persistence/index.ts`, `libs/nestjs/src/lib/mikro-orm.config.ts`, `libs/nestjs/src/lib/persistence.module.ts` — entity registration
- `libs/nestjs/src/lib/persistence/entities/refresh-token.entity.ts`, `libs/nestjs/src/lib/persistence/repositories/refresh-token.repository.ts` — entity/repository + `@Index` patterns
- `libs/nestjs/src/lib/common/background/background.service.ts` (`ScheduledTask`, `SCHEDULED_TASKS`), `libs/nestjs/src/lib/common/background/trash-purge.runner.ts` — tick pattern to reuse
- `libs/nestjs/src/lib/admin/keys/keys-admin.controller.ts`, `libs/nestjs/src/lib/admin/objects/dto/list-objects-response.dto.ts` — controller + nestjs-zod DTO patterns
- `libs/nestjs/src/lib/admin/admin.module.ts` (`ADMIN_CONTROLLER_MODULES`), `apps/openbucket-backend/src/openapi-export.ts`, `libs/api-client/project.json` — routing + client generation
- `apps/openbucket-frontend/src/app/keys/keys.signal-store.ts`, `apps/openbucket-frontend/src/app/keys/keys-list.component.ts`, `apps/openbucket-frontend/src/app/app.routes.ts`, `apps/openbucket-frontend/src/app/shared/ui/list-state.component.ts` — SPA patterns to mirror
- Security posture (do not regress): `libs/nestjs/src/lib/s3/authz/policy-evaluator.ts`, `libs/nestjs/src/lib/storage/key-codec.ts` are S3-data-plane only and are NOT in this admin-plane path; authz here is the admin `JwtAuthGuard`.
- New deps: none — `uuid` (v7), `zod`, `nestjs-zod`, `@mikro-orm/*` are already dependencies; the SPA uses native `datetime-local` inputs (no new datepicker).
</content>
</invoke>
