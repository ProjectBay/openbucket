---
id: TEST-1000
title: Scoped-key enforcement across compiler, cipher, evaluator, guard, and API
covers: [STORY-1000, TASK-3000, TASK-3001, TASK-3002, TASK-3003, TASK-3004]
status: backlog
level: e2e
---

## Goal

Prove that a scoped access key can only act within its allowed bucket + prefix (or
inline policy), that root keys are never scope-restricted, and that the scope is
enforced by the same `evaluatePolicy` engine as bucket policies — with an explicit
bucket `Deny` still overriding a scope `Allow`, and revocation taking effect
immediately. Verify the enabling plumbing (reversible secret so a sub-key can sign,
`s3:prefix` list constraint) end to end.

## Setup

- Runner: `nx test nestjs` (unit) and `nx e2e nestjs-e2e` (SDK).
- Fixtures: a booted app with `ROOT_ACCESS_KEY_ID`/`ROOT_SECRET_ACCESS_KEY` set;
  MikroORM/libsql on a temp file; migration `..._access_key_scope` applied.
- Clients: `@aws-sdk/client-s3` configured with (a) the root pair and (b) a minted
  scoped sub-key pair returned once from `POST /api/admin/keys`.
- Buckets `t-a` and `t-b` pre-created by root; objects seeded under
  `t-a/tenant-a/…`, `t-a/other/…`, and `t-b/…`.
- Admin JWT for the `/api/admin/keys` calls (existing auth fixture).

## Cases

1. **[TASK-3000] Prefix→policy compiler.** Given
   `{kind:'prefix',bucket:'t-a',prefix:'tenant-a/'}`, `compileScopeToPolicy`
   returns an object `Allow` on `arn:aws:s3:::t-a/tenant-a/*` and a bucket `Allow`
   on `arn:aws:s3:::t-a` carrying `StringLike s3:prefix: ['tenant-a/*','tenant-a/']`.
   A prefix containing `*` is escaped; `parseScopePolicy('{bad json')` returns a
   deny-all document (`Statement: []`).
2. **[TASK-3001] Secret cipher + sub-key signing.** `decrypt(encrypt(s)) === s`;
   a byte-flipped ciphertext throws. `storage/getSecret` returns
   `{isRoot:false, scopePolicy}` for a DB row and `{isRoot:true, scopePolicy:null}`
   for the env root; a disabled sub-key returns `null`. A freshly minted sub-key
   completes a real SigV4 `PutObject` (proves the plaintext round-trips).
3. **[TASK-3004] Evaluator s3:prefix.** `evaluatePolicy` with a `StringLike
   s3:prefix` statement allows when `ctx.prefix='tenant-a/2024/'` and withholds the
   Allow when `ctx.prefix=''` or `'other/'`; the two EPIC-08 operators
   (`Bool aws:SecureTransport`, `IpAddress aws:SourceIp`) still pass unchanged; an
   unknown operator still fails closed.
4. **[TASK-3002] Guard matrix (unit).** With `isRoot:false` + a compiled scope:
   `s3:PutObject` on `t-a/tenant-a/x` ⇒ allow; on `t-a/other/x` ⇒ deny; on
   `t-b/x` ⇒ deny. With `isRoot:true` ⇒ allow regardless (no scope eval). A bucket
   policy `Deny` on `t-a/tenant-a/x` overrides the scope Allow ⇒ deny. A scoped key
   with no bucket (ListBuckets) ⇒ deny unless scope allows `s3:ListAllMyBuckets`.
5. **[TASK-3002/3004] Scoped key over the wire (e2e).** Using the scoped-key SDK
   client: `PutObject`/`GetObject`/`DeleteObject` under `t-a/tenant-a/*` succeed;
   the same ops on `t-a/other/*` and any `t-b/*` return `403 AccessDenied`.
   `ListObjectsV2({Bucket:'t-a', Prefix:'tenant-a/'})` succeeds; the same with no
   `Prefix` or `Prefix:'other/'` returns `403`. A **presigned** GET minted by the
   scoped key is enforced identically (in-scope 200, out-of-scope 403).
6. **[TASK-3003] Admin API + revocation.** `POST /api/admin/keys` with a `scope`
   returns the secret once and a scope summary; `GET` lists the scope and never a
   secret; an invalid scope (bad bucket, oversized policy) ⇒ `400`. After
   `PATCH :id {disabled:true}` (or `DELETE`), the cache is invalidated and the next
   scoped-key request is rejected.
7. **Root no-regression.** The full root-key SDK/conformance flow (bucket CRUD,
   object CRUD, multipart, listing) behaves byte-identically to pre-change; no
   scope column is populated for the root key.

## Tooling

- Framework: jest | @aws-sdk/client-s3 | supertest (admin API)
- Runner: `nx test nestjs`, `nx e2e nestjs-e2e`

## Pass criteria

- [ ] All seven cases pass.
- [ ] Out-of-scope object and list requests return `403 AccessDenied`; in-scope
      succeed.
- [ ] Bucket-policy `Deny` overrides scope `Allow`.
- [ ] Revocation (disable/delete) denies the next request via cache invalidation.
- [ ] Root path shows zero behavioural change and the EPIC-08 evaluator operators
      are untouched.

## References

- `libs/nestjs/src/lib/s3/authz/policy-evaluator.ts`,
  `s3/authz/policy-authorization.guard.ts`, `s3/sigv4/sigv4.guard.ts`
- `libs/nestjs/src/lib/storage/key.service.ts`, `domain/keys/key.service.ts`
- `libs/nestjs/src/lib/admin/keys/keys-admin.controller.ts`
