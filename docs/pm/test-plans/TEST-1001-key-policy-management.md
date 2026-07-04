---
id: TEST-1001
title: Key policy management — API, evaluator reuse, and console
covers: [STORY-1001, TASK-3010, TASK-3011, TASK-3012, TASK-3013, TASK-3014]
status: backlog
level: e2e
---

## Goal
Verify the per-key policy management surface end to end: scope create/echo,
secret rotation (shown once, re-hashed), immediate revocation on the S3 path,
effective-permissions/simulate parity with `PolicyAuthorizationGuard`, the audit
events, and the console flows — without regressing root-key behaviour or the
EPIC-08 authz posture.

## Setup
- Runner: `nx test nestjs` (unit/controller specs) and `nx e2e nestjs-e2e` (HTTP + S3 path); `nx test openbucket-frontend` for console specs.
- Backend: a booted app with an admin JWT (reuse the existing admin-auth e2e login helper) and the libsql test DB migrated (incl. the [STORY-1000] `AccessKey.scope` column). `ROOT_ACCESS_KEY_ID`/`ROOT_SECRET_ACCESS_KEY` from env as usual.
- S3 client for the revocation/scope e2e: `@aws-sdk/client-s3` pointed at the app, signing with a minted sub-key's `accessKeyId` + one-time `secretAccessKey`.
- Fixtures: a shared `compileScopeToPolicy` fixture (from [TASK-3011]) reused by both the controller specs and the `policy-evaluator` assertions so simulate and the guard are checked against the same compiled document.
- Frontend: `KeysSignalStore` with a mocked `KeysAdminService`; spartan-ng test harness for the dialogs/menu.

## Cases

1. **Create with scope round-trips ([TASK-3011]).** Given `POST /api/admin/keys` with `{ label:'tenant-a', scope:{ buckets:['tenant-a'], prefix:'uploads/', actions:['s3:GetObject','s3:PutObject','s3:ListBucket'] } }`, then the response is 201 with `role:'scoped'`, a one-time `secretAccessKey`, and `scope` = the compiled `PolicyDocument` (`Allow` on `arn:aws:s3:::tenant-a/uploads/*` for object actions and `arn:aws:s3:::tenant-a` for `s3:ListBucket`, `Principal.AWS` = the new `accessKeyId`); `GET /api/admin/keys` lists the key with the same `scope`.

2. **Scope validation bounds ([TASK-3011]).** Given creates with (a) 21 buckets, (b) a 1025-byte prefix, (c) bucket `"a*b"` (non-DNS / glob metachar), (d) `actions:['s3:PutBucketPolicy']` (outside the enum) — each returns 400 from the nestjs-zod pipe and persists nothing.

3. **Create without scope is unchanged ([TASK-3011]).** Given `{ label:'ci' }`, then `role:'root'`, `scope:null`, and the response matches the pre-Story `CreatedKeyDto` shape (no regression).

4. **Rotate re-mints the secret once ([TASK-3010]).** Given a key, when `POST /api/admin/keys/:id/rotate`, then a new `secretAccessKey` is returned once, `secretHash` in the DB changes, `id`/`accessKeyId`/`scope`/`label` are unchanged, and a second identical call yields a different secret again (idempotency not assumed).

5. **Rotation invalidates the SigV4 cache ([TASK-3010]).** Spy on the storage `KeyService.invalidate`; rotate and revoke each call `invalidate(row.accessKeyId)` exactly once; `update`(disable) and `delete` also call it. The env root key (no DB row) is untouched (`isRoot` guard).

6. **Revocation is immediate on the S3 path ([TASK-3010], e2e).** Given a scoped sub-key that can `GET arn:aws:s3:::tenant-a/uploads/x` (verified as a 200 via `@aws-sdk/client-s3`), when `POST /api/admin/keys/:id/revoke`, then the very next signed `GetObject` with that key returns 403 in the same process — no cache-TTL wait.

7. **Effective-permissions matrix ([TASK-3012]).** Given the case-1 scoped key, `GET /api/admin/keys/:id/effective-permissions` returns `scoped:true`, echoes `scope`, and a matrix where `s3:GetObject`/`s3:PutObject` on `arn:aws:s3:::tenant-a/uploads/*` = `allow`, `s3:DeleteObject` = `deny` (not granted), and any action on `arn:aws:s3:::other-bucket/*` = `deny`.

8. **Root key reports unrestricted ([TASK-3012]).** Given a `role:'root'` key, effective-permissions returns `scoped:false` and every matrix cell = `allow` (evaluated with `defaultAllow:true`).

9. **Simulate parity with the guard ([TASK-3012]).** For a table of `{action, resource}` pairs, `POST /api/admin/keys/:id/simulate` returns the same `allow`/`deny` that `evaluatePolicy(compiledScope, ctx, { defaultAllow: role==='root' })` returns for the identical ctx — asserted against the shared fixture so the console can never diverge from `PolicyAuthorizationGuard`. `action` accepts both `GetObject` and `s3:GetObject` (normalized via `operationToAction`).

10. **Audit events emitted ([TASK-3010], [TASK-3014]).** With an `AuditService.emit` spy: create → `key.created`, rotate → `key.rotated`, revoke → `key.revoked`, disable via PATCH → `key.disabled`, delete → `key.deleted`; each carries `subject` (= admin username), `keyId`, and `requestId`.

11. **Rotate is throttled ([TASK-3010]).** 11 rapid `POST :id/rotate` calls from one principal: the 11th returns 429 (the `@Throttle({ default:{ limit:10, ttl:60_000 } })` override), while normal admin routes stay at 100/min.

12. **Unknown id ([TASK-3010], [TASK-3012]).** rotate/revoke/effective-permissions/simulate on a non-existent `:id` all return 404 and change no state.

13. **api-client surface ([TASK-3014]).** The regenerated `KeysAdminService` exposes `rotateKey`, `revokeKey`, `getKeyEffectivePermissions`, `simulateKeyAction`; `CreatedKeyDto`/`KeySummaryDto`/`CreateKeyDto` include `scope` — verified by the console specs compiling and by asserting the methods exist.

14. **Console: scoped create + one-time secret ([TASK-3013]).** In `key-create-dialog`, enabling the scope block and submitting calls `store.create({ label, scope })`; the returned secret opens `KeySecretOnceDialogComponent` exactly once. Submitting with the scope block off calls `store.create({ label })`.

15. **Console: rotate/revoke/permissions actions ([TASK-3013]).** The row menu Rotate opens the secret-once dialog with the rotate response; Revoke (after confirm) flips the row to disabled via `store.revoke`; Permissions opens the panel and renders the matrix from `getKeyEffectivePermissions`; the simulate input round-trips a decision. All components are `OnPush` + signals (no NgRx).
