---
id: TASK-3003
title: Accept and expose a key scope through the admin key API
story: STORY-1000
status: backlog
type: implementation
size: M
---

## Description

Let an admin mint a scoped key and read a key's scope back. Extend the create-key
DTO with an optional `scope`, compile it (TASK-3000) and persist it (TASK-3001) via
the domain `KeyService`, expose the scope on the key-summary responses (never the
secret), and invalidate the `storage/key.service.ts` cache when a key is
disabled/deleted so revocation takes effect. The console surface itself is
STORY-1001; this Task delivers the API contract it consumes.

## Files to create / modify

- `libs/nestjs/src/lib/admin/keys/dto/create-key.dto.ts` — modify (add optional
  `scope` on `CreateKeySchema`, reusing the `KeyScope` zod schema from TASK-3000)
- `libs/nestjs/src/lib/admin/keys/dto/key-summary.dto.ts` — modify (add
  `scope: KeyScopeView | null`)
- `libs/nestjs/src/lib/admin/keys/dto/created-key.dto.ts` — modify (echo `scope`)
- `libs/nestjs/src/lib/admin/keys/keys-admin.controller.ts` — modify (pass `scope`
  through `create`; invalidate cache on `update`/`delete`)
- `libs/nestjs/src/lib/domain/keys/key.service.ts` — modify (`CreateKeyInput`
  gains `scope?: KeyScope`; compile + store `scopePolicy`; `delete`/`update` call
  `storageKeys.invalidate(accessKeyId)`)
- `libs/nestjs/src/lib/admin/keys/keys-admin.controller.spec.ts` — modify

## Implementation notes

- `CreateKeySchema` (nestjs-zod, `.strict()`) adds `scope: KeyScope.optional()`.
  When present, `domain/keys/key.service.ts#create` calls
  `compileScopeToPolicy(scope)` and stores `scopePolicy = JSON.stringify(doc)`;
  when absent, `scopePolicy = null` (root-equivalent unrestricted sub-key — still
  a sub-key, still SigV4-capable via TASK-3001, just unscoped). Keep `role` forced
  to `'root'` for now (roles are STORY-1002); scope is orthogonal to role.
- `KeySummaryDto` must NOT leak the secret; it returns the **authored** scope view
  (a compact `{ kind, bucket, prefix }` or `{ kind:'policy' }`) reconstructed from
  the stored document, or `null`. Store the authored form is optional — simplest
  is to render a summary from `scopePolicy` (bucket + prefix parsed back out of the
  first Resource ARN). Prefer persisting the authored `scope` JSON too if a faithful
  round-trip is needed for the console; if so add a note but do not expand scope
  beyond this Task.
- Revocation: `KeysAdminController.update` (disable) and `delete` must call
  `storageKeys.invalidate(row.accessKeyId)` so the in-memory cache does not keep
  serving a revoked key. Inject the `storage/key.service.ts` `KeyService` into the
  domain service or controller (mind the two `KeyService` classes — alias on import
  as the module already does: `StorageKeyService`).
- Audit: reuse the existing `AuditService.emit` calls; add `scope: !!dto.scope` (a
  boolean, never the policy body) to the `key.created` event so mints are auditable
  without logging tenant ARNs.
- Validation/DoS: the `KeyScope` schema already bounds `prefix` length and the
  serialized policy size (TASK-3000); reject at the DTO boundary so oversized or
  malformed scopes never reach the DB (returns 400 via the global `ZodValidation`
  pipe).

## Acceptance criteria

- [ ] `POST /api/admin/keys` with a `scope` persists a compiled `scopePolicy` and
      returns the secret once; without `scope` behaves as today.
- [ ] `GET /api/admin/keys` returns each key's scope summary and never a secret.
- [ ] Disabling or deleting a key calls `invalidate` on the storage cache.
- [ ] An invalid scope (bad bucket name, oversized policy) yields `400`.
- [ ] OpenAPI export contains the `scope` field on the create/summary schemas.
- [ ] `nx test nestjs --testPathPattern="keys-admin"` passes.

## Test obligations

- Unit: covered by [TEST-1000] (controller create-with-scope, invalidate-on-revoke)
- E2E: covered by [TEST-1000] (mint scoped key → use it → revoke → denied)
- Conformance: N/A

## Dependencies

- Blocked by: [TASK-3000], [TASK-3001]
