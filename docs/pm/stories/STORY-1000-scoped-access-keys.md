---
id: STORY-1000
title: Scoped access keys enforced via the policy evaluator
epic: EPIC-11
status: backlog
size: L
risk: high
---

## User story

As an operator embedding OpenBucket in a multi-tenant app, I want to attach a
scope (an allowed bucket + key-prefix, or an inline policy document) to an access
key, so that I can hand each tenant a credential that can only touch its own
prefix while root keys stay unrestricted.

## Description

Today every access key is hard-coded `role = 'root'`
(`persistence/entities/access-key.entity.ts`) and, worse, DB sub-keys cannot even
sign a request — `storage/key.service.ts#getSecret` returns `null` for them
because SigV4 needs a plaintext secret and the row stores only an argon2id hash.
This Story makes access keys scopeable end to end: it adds a reversible
(encrypted-at-rest) secret so sub-keys can authenticate via SigV4, stores a
per-key **scope** (a compiled `PolicyDocument`), stamps it onto the request in
`SigV4Guard`, and enforces it in `PolicyAuthorizationGuard` by running the key's
scope through the existing EPIC-08 evaluator (`s3/authz/policy-evaluator.ts`)
*alongside* the bucket policy — implicit-deny for scoped keys, out-of-scope ⇒
403. Root keys carry no scope and keep the `defaultAllow: true` behaviour, so
scoping is additive and existing single-root deployments are byte-for-byte
unchanged.

## Acceptance criteria

- [ ] A key scoped to bucket `t-a`, prefix `tenant-a/` can PUT/GET/DELETE under
      `t-a/tenant-a/*` and receives `403 AccessDenied` for any other bucket or
      prefix (verified via `@aws-sdk/client-s3`).
- [ ] A prefix-scoped key issuing `ListObjectsV2` without a matching `prefix=`
      query (or with a non-matching one) is denied, so it cannot enumerate keys
      outside its scope.
- [ ] Root keys (the env `ROOT_ACCESS_KEY_ID` pair) are never scope-evaluated and
      behave exactly as before — no scope column, `defaultAllow: true`.
- [ ] A scoped sub-key can successfully SigV4-sign a request (the encrypted secret
      round-trips through `SecretCipher`); the plaintext secret is surfaced only
      once at creation and the argon2id hash is retained.
- [ ] An explicit `Deny` in the bucket policy still overrides a scope `Allow`
      (bucket policy and scope are ANDed; either denying ⇒ 403).
- [ ] Disabling or deleting a scoped key invalidates the `KeyService` cache so the
      next request is rejected within the existing cache window.
- [ ] `nx test nestjs` and the S3 conformance suite pass with no regression to the
      root-key path.

## Tasks

- [TASK-3000] Add scoped-key data model, scope schema, and prefix→policy compiler
- [TASK-3001] Add reversible secret storage so sub-keys can SigV4-authenticate
- [TASK-3002] Enforce the key scope in PolicyAuthorizationGuard and request context
- [TASK-3003] Accept and expose a key scope through the admin key API
- [TASK-3004] Extend the evaluator with StringLike s3:prefix for ListBucket scoping

## Test plan

- [TEST-1000] Scoped-key enforcement (unit + integration + e2e)

## Dependencies

- Blocks: [STORY-1001] (Per-key policy management API + console — the console mints
  and displays the scope this Story enforces)
- Blocked by: [STORY-0702] (EPIC-08 bucket-policy evaluation engine —
  `s3/authz/policy-evaluator.ts`, reused verbatim)

## References

- `libs/nestjs/src/lib/persistence/entities/access-key.entity.ts` (`role = 'root'`)
- `libs/nestjs/src/lib/s3/authz/policy-evaluator.ts` (`evaluatePolicy`, `defaultAllow`)
- `libs/nestjs/src/lib/s3/authz/policy-authorization.guard.ts`
- `libs/nestjs/src/lib/s3/authz/operation-action.ts` (`operationToAction`)
- `libs/nestjs/src/lib/s3/sigv4/sigv4.guard.ts`, `s3/sigv4/key.service.ts` (abstract token)
- `libs/nestjs/src/lib/storage/key.service.ts` (`getSecret`, `KeyLookupResult`, cache/invalidate)
- `libs/nestjs/src/lib/domain/keys/key.service.ts` (admin create/update/delete)
- `libs/nestjs/src/lib/admin/keys/keys-admin.controller.ts`, `admin/keys/dto/*`
- `libs/nestjs/src/lib/common/types/request.d.ts` (`OpenBucketRequestContext`)
- `libs/nestjs/src/lib/persistence/entities/types.ts` (`PolicyDocument`)
- Interfaces consumed: `evaluatePolicy` (STORY-0702), `operationToAction`
- Interfaces produced: `SecretCipher`, `compileScopeToPolicy`, `KeyScope` schema,
  `OpenBucketRequestContext.keyScope` / `.isRoot`
- New deps: none required (uses Node `crypto` AES-256-GCM; `@aws-sdk/client-s3`
  already a dev dependency for e2e)
