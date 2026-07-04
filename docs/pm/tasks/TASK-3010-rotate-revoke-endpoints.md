---
id: TASK-3010
title: Add rotate + immediate-revoke endpoints and wire SigV4 cache invalidation
story: STORY-1001
status: backlog
type: implementation
size: M
---

## Description
Add `POST /api/admin/keys/:id/rotate` and `POST /api/admin/keys/:id/revoke` to
the admin key surface, and close a revocation gap: the admin `KeyService`
(`domain/keys/key.service.ts`) `update`/`delete` never invalidate the SigV4
hot-path cache in `storage/key.service.ts`, which caches a resolved key
(including `disabled: true`). That is harmless while only the root key is cached
(v1), but once [STORY-1000] enables sub-key SigV4 resolution a disabled/rotated
key could still verify from cache. Rotate mints a fresh secret (shown once);
revoke disables the key; both call `storage KeyService.invalidate(accessKeyId)`
synchronously so the change takes effect in-process immediately.

## Files to create / modify
- `libs/nestjs/src/lib/domain/keys/key.service.ts` — modify. Add `rotate(id)` and `revoke(id)`.
- `libs/nestjs/src/lib/admin/keys/keys-admin.controller.ts` — modify. Add the two `@Post(':id/rotate')` / `@Post(':id/revoke')` handlers; audit-emit; call SigV4 cache invalidation.
- `libs/nestjs/src/lib/admin/keys/dto/rotated-key.dto.ts` — new. Rotate response (mirrors `CreatedKeyDto` — the one-time secret).
- `libs/nestjs/src/lib/admin/keys/keys-admin.module.ts` — modify. Import the module that provides the **storage** `KeyService` (aliased to avoid the two-`KeyService` name clash) so the controller can invalidate the cache.
- `libs/nestjs/src/lib/storage/storage.module.ts` (or the module currently providing `storage/key.service.ts`) — modify. Add `KeyService` to `exports` if not already exported.
- `libs/nestjs/src/lib/admin/keys/keys-admin.controller.spec.ts` — modify. Cover rotate/revoke + invalidation (see [TEST-1001]).

## Implementation notes
- `rotate(id)` in the admin `KeyService`: `em.findOne(AccessKey, { id })`; if null return null. Generate a new secret exactly as `create` does — `randomBytes(30).toString('base64url')` (40 chars), `argon2.hash(secret, { type: argon2.argon2id })` — assign `row.secretHash`, `em.flush()`. Return `{ id, accessKeyId, secretAccessKey, label, role, scope, createdAt }`. Do **not** change `id`, `accessKeyId`, `scope`, or `label` — rotation is a secret roll, not a new key. (Secret storage for SigV4 sub-key verification is standardized by [STORY-1000]; rotate reuses whatever `create` writes so the two stay in lockstep.)
- `revoke(id)`: set `row.disabled = true`, `em.flush()`, return the row (or null). Distinct from `delete` (which removes the row) — revoke keeps the audit trail and the `accessKeyId` reserved.
- Controller wiring for immediate effect: inject the **storage** `KeyService` (the SigV4 one from `storage/key.service.ts`, which exposes `invalidate(accessKeyId: string)`) and call `invalidate(row.accessKeyId)` after a successful rotate/revoke/update/delete. Two classes are both named `KeyService`; import one with an alias, e.g. `import { KeyService as SigV4KeyService } from '../../storage/key.service'`, and add it to `KeysAdminModule` imports/providers via the module that owns it (export it there). `invalidate` is a no-op for the root key (`isRoot` guard already present) so root is unaffected.
- Retro-fix: also call `SigV4KeyService.invalidate(row.accessKeyId)` from the existing `update` (disable path) and `delete` handlers so every credential-state change is consistent, not just the new routes.
- `RotatedKeySchema`: identical shape to `CreatedKeySchema` (`id`, `accessKeyId`, `secretAccessKey`, `label`, `role`, `createdAt`) plus the optional `scope` echo added in [TASK-3011]. Keep the `SECURITY: secretAccessKey returned ONCE` comment from `keys-admin.controller.ts:69`.
- HTTP: `@Post(':id/rotate')` → 200 with `RotatedKeyDto`; `@Post(':id/revoke')` → 200 with `KeySummaryDto` (or 204). `@ApiOperation({ operationId: 'rotateKey' })` / `'revokeKey'` for the OpenAPI export consumed by [TASK-3014]. `NotFoundException` when `id` is unknown, mirroring `update`.
- Audit: emit `key.rotated` and `key.revoked` (`subject` = `req.user.username`, `keyId`, `requestId` = `req.openbucket.requestId`) exactly like the existing `key.*` emits. Catalogue entries added in [TASK-3014].
- Security / DoS: argon2id hashing is CPU-heavy; a rotate flood is a compute-DoS vector. Add a controller-level `@Throttle({ default: { limit: 10, ttl: 60_000 } })` on rotate (tighter than the 100/min `default` bucket in `admin.module.ts`) — the guard is already bound app-wide, so this only narrows. Revoke/rotate stay behind the global `JwtAuthGuard`. Never log or return the plaintext secret except in the single rotate response; `redact()` any `accessKeyId` in logs.
- Edge case: rotate/revoke on the env root key — the root key is never persisted (`storage/key.service.ts onModuleInit`), so it has no `AccessKey` row and these routes 404 for it, which is correct (root is rotated via env + `reloadRootFromEnv`, not this API).

## Acceptance criteria
- [ ] `nx test nestjs --testPathPattern=keys-admin.controller` passes: rotate returns a new `secretAccessKey`, keeps `id`/`accessKeyId`/`scope`, and re-hashes (`secretHash` changes); revoke sets `disabled=true`.
- [ ] Rotate and revoke both call `SigV4KeyService.invalidate(row.accessKeyId)` (asserted via a spy); `update`(disable) and `delete` do too.
- [ ] OpenAPI export (`nx run nestjs:openapi` / the spec build) contains `rotateKey` and `revokeKey` operationIds.
- [ ] Rotate is throttled at 10/min; a signed S3 request with a revoked key returns 403 in-process (covered E2E by [TEST-1001]).

## Test obligations
- Covered by [TEST-1001] (rotate/revoke unit + the "revocation is immediate on the S3 path" e2e).

## Dependencies
- Blocked by: [STORY-1000] (sub-key SigV4 resolution + `AccessKey.scope`), [TASK-3011] (the `scope` echo field in the response DTOs).
