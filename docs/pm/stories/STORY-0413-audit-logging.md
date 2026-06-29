---
id: STORY-0413
title: Implement AuditService and event catalogue
epic: EPIC-05
status: done
size: S
risk: low
---

## User story
As an operator, I want every state-changing admin call to emit a structured Pino log line tagged `audit: true`, so that downstream tooling can index admin activity reliably.

## Description
Implement `apps/backend/src/admin/audit/audit.service.ts` per §5.9. Single method `emit(event: AuditEvent): void` that writes via `Logger('admin.audit').log({ ...event, audit: true })`. `AuditEvent` requires `event: string` and `subject: string`, with optional `requestId` and arbitrary additional keys. Document the canonical v1 event catalogue (in `AuditService` JSDoc) so callers in §5.5–§5.8, §5.2.4 emit consistent event names: `admin.login`, `admin.login.failed`, `admin.logout`, `admin.password.changed`, `bucket.created`, `bucket.deleted`, `bucket.versioning.changed`, `object.deleted`, `key.created`, `key.disabled`, `key.updated`, `key.deleted`, `settings.changed`.

## Acceptance criteria
- [x] `AuditService.emit(event)` produces a Pino record containing every field on `event` plus `audit: true`.
- [x] `AuditEvent.event` and `AuditEvent.subject` are required at the type level.
- [x] `AuditService` is exported by `AdminModule` so feature modules can depend on it without re-providing.
- [x] JSDoc above the `emit` method enumerates the v1 event catalogue verbatim from §5.9.
- [x] Read-only `GET` calls do not emit audit events.

## Tasks
- [TASK-1239] Implement `AuditService` with `AuditEvent` interface
- [TASK-1240] Document v1 event catalogue in JSDoc

## Test plan
- [TEST-0418] AuditService unit spec

## Dependencies
- Blocks: [STORY-0403], [STORY-0405], [STORY-0409], [STORY-0410], [STORY-0411], [STORY-0412]
- Blocked by: [STORY-0400], [EPIC-01] (nestjs-pino logger configured at app level)

## References
- `docs/WHITEPAPER.md` §5.9 (lines 7699–7746)
- Interfaces produced: `AuditService.emit`, `AuditEvent`
