---
id: STORY-1001
title: Per-key policy management API + console
epic: EPIC-11
status: backlog
size: M
risk: medium
---

## User story
As an operator embedding OpenBucket in a multi-tenant app, I want to create,
rotate, and immediately revoke access keys **with a bucket/prefix scope** and
inspect a key's effective permissions from the admin API and console, so that I
can hand each tenant a credential that only touches their own data and cut it
off the moment it leaks — without restarting the process or hand-editing
policy JSON.

## Description
This Story adds the **management surface** for the scoped access keys that
[STORY-1000] enforces on the S3 path. It extends the existing admin key surface
(`admin/keys/keys-admin.controller.ts`, `domain/keys/key.service.ts`) and the
console (`apps/openbucket-frontend/src/app/keys/`) with: create-with-scope,
`POST :id/rotate` (mint a fresh secret, shown once, same `id`/`accessKeyId`/
`scope`), `POST :id/revoke` (disable **and** synchronously invalidate the SigV4
cache so revocation is immediate), and read-only effective-permissions
inspection (`GET :id/effective-permissions` + `POST :id/simulate`) that reuses
the EPIC-08 evaluator `s3/authz/policy-evaluator.ts` so the console shows exactly
what the request path will decide. It produces new nestjs-zod DTOs, a regenerated
`@openbucket/api-client`, new audit events (`key.rotated`, `key.revoked`), and a
signals-based console (scope builder, row actions, permissions panel).

## Acceptance criteria
- [ ] `POST /api/admin/keys` accepts an optional `scope` object, validates it, and persists it via `KeyService.create`; the create response and `GET /api/admin/keys` listing both surface `scope`.
- [ ] `POST /api/admin/keys/:id/rotate` returns a new `secretAccessKey` **exactly once**, re-hashes it with argon2id, leaves `id`/`accessKeyId`/`scope`/`label` unchanged, and invalidates the SigV4 `storage/key.service.ts` cache so the previous secret stops verifying in-process.
- [ ] `POST /api/admin/keys/:id/revoke` sets `disabled = true` and calls `KeyService(storage).invalidate` synchronously; a signed S3 request with that key returns `403` within the same process with no cache-TTL wait.
- [ ] `GET /api/admin/keys/:id/effective-permissions` returns the compiled scope `PolicyDocument` plus an allow/deny matrix computed by `evaluatePolicy`; a `role: 'root'` key reports `scoped: false` and allow across the matrix (`defaultAllow: true`).
- [ ] `POST /api/admin/keys/:id/simulate` returns `allow`/`deny` for a supplied `{ action, resource }` consistent with `PolicyAuthorizationGuard` (scoped keys evaluate with `defaultAllow: false`).
- [ ] Every state-changing route emits its audit event (`key.created`, `key.rotated`, `key.revoked`, `key.disabled`, `key.deleted`) through `AuditService.emit`.
- [ ] Scope validation rejects > 20 buckets, a prefix > 1024 bytes, and unknown `s3:*` actions; a scope can only narrow (scoped keys default-deny outside their scope — no escalation past root).
- [ ] Console: the create dialog has a scope builder; the key row menu has **Rotate** (opens the one-time secret dialog) and **Revoke**; an effective-permissions panel renders the matrix — all `ChangeDetectionStrategy.OnPush`, signals-based.
- [ ] No regression: existing key CRUD e2e and `policy-evaluator` unit specs pass; `role: 'root'` keys remain unrestricted.

## Tasks
- [TASK-3010] Add rotate + immediate-revoke endpoints and wire SigV4 cache invalidation
- [TASK-3011] Surface key scope through the create and summary admin DTOs with escalation-safe validation
- [TASK-3012] Add effective-permissions inspection and single-action simulate endpoints
- [TASK-3013] Build the console scope builder, rotate/revoke actions, and effective-permissions panel
- [TASK-3014] Regenerate the api-client + OpenAPI and extend the audit event catalogue

## Test plan
- [TEST-1001] Key policy management — API, evaluator reuse, and console

## Dependencies
- Blocks: —
- Blocked by: [STORY-1000] (the `AccessKey.scope` column, SigV4 sub-key secret resolution, and `PolicyAuthorizationGuard` reading a key's inline policy). This Story consumes those; it does not re-invent the scope column or the S3-path enforcement.
- Reuses (EPIC-08): [STORY-0702] `evaluatePolicy` / `operationToAction`, the `default` admin throttler bucket (`admin.module.ts`), and `storage/key.service.ts` `invalidate`.

## References
- `libs/nestjs/src/lib/admin/keys/keys-admin.controller.ts` (`listKeys`/`createKey`/`updateKey`/`deleteKey`, guarded by `JwtAuthGuard`)
- `libs/nestjs/src/lib/admin/keys/dto/{create-key,created-key,key-summary,update-key}.dto.ts` (nestjs-zod `createZodDto`)
- `libs/nestjs/src/lib/domain/keys/key.service.ts` (`create`/`update`/`delete`, argon2id hashing, uuid v7 `id`, `AKIA…` `accessKeyId`)
- `libs/nestjs/src/lib/storage/key.service.ts` (`getSecret` cache, `invalidate`, `redact`) — the hot-path SigV4 lookup
- `libs/nestjs/src/lib/s3/authz/policy-evaluator.ts` (`evaluatePolicy`, `defaultAllow`), `operation-action.ts` (`operationToAction`), `policy-authorization.guard.ts`
- `libs/nestjs/src/lib/persistence/entities/access-key.entity.ts` + `entities/types.ts` (`PolicyDocument`)
- `libs/nestjs/src/lib/admin/audit/audit.service.ts` (event catalogue), `libs/nestjs/src/lib/admin/admin.module.ts` (`default`/`login` throttlers)
- `apps/openbucket-frontend/src/app/keys/{keys-list.component,keys.signal-store,key-create-dialog.component,key-secret-once-dialog.component}.ts`
- `libs/api-client/src/lib/api/keys-admin.service.ts` (OpenAPI-generated; regenerated by [TASK-3014])
- New deps: none at runtime (reuses `argon2`, already a dependency). Test tooling: `@aws-sdk/client-s3` for the scoped-key S3-path e2e in [TEST-1001].
