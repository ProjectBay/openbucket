---
id: TASK-3011
title: Surface key scope through the create and summary admin DTOs with escalation-safe validation
story: STORY-1001
status: backlog
type: implementation
size: M
---

## Description
Expose the `AccessKey.scope` field added by [STORY-1000] through the admin key
API. Extend `CreateKeySchema` with an optional `scope`, echo `scope` on
`CreatedKeyDto`/`RotatedKeyDto`/`KeySummaryDto`, and compile the operator-facing
scope shorthand into the inline `PolicyDocument` that [STORY-1000]'s
`PolicyAuthorizationGuard` enforces. Validation is escalation-safe and DoS-bounded.

## Files to create / modify
- `libs/nestjs/src/lib/admin/keys/dto/scope.dto.ts` — new. `KeyScopeSchema` (zod) + `compileScopeToPolicy(scope, accessKeyId)`.
- `libs/nestjs/src/lib/admin/keys/dto/create-key.dto.ts` — modify. Add `scope: KeyScopeSchema.optional()`.
- `libs/nestjs/src/lib/admin/keys/dto/created-key.dto.ts` — modify. Add `scope` (nullable) echo.
- `libs/nestjs/src/lib/admin/keys/dto/key-summary.dto.ts` — modify. Add `scope` (nullable) so listings show it.
- `libs/nestjs/src/lib/admin/keys/dto/rotated-key.dto.ts` — modify. Add `scope` echo (from [TASK-3010]).
- `libs/nestjs/src/lib/domain/keys/key.service.ts` — modify. `CreateKeyInput`/`CreatedKey` carry `scope`; persist it; return it in `list`/`create`/`rotate`.
- `libs/nestjs/src/lib/admin/keys/keys-admin.controller.ts` — modify. Pass `dto.scope` through `create`; map `scope` into all response projections.

## Implementation notes
- Operator-facing shorthand (`KeyScopeSchema`), `.strict()`:
  ```ts
  const S3_ACTIONS = ['s3:GetObject','s3:PutObject','s3:DeleteObject',
    's3:ListBucket','s3:GetBucketLocation','s3:ListBucketMultipartUploads',
    's3:AbortMultipartUpload'] as const;
  export const KeyScopeSchema = z.object({
    buckets: z.array(z.string().min(1).max(63)).min(1).max(20),
    prefix: z.string().max(1024).optional(),          // key prefix, e.g. "tenant-a/"
    actions: z.array(z.enum(S3_ACTIONS)).min(1).max(S3_ACTIONS.length).optional(),
  }).strict();
  ```
  `actions` defaults to the full read/write set when omitted. Store the **compiled** `PolicyDocument` in `AccessKey.scope` (the shape `PolicyAuthorizationGuard` reads); keep the shorthand only as API sugar.
- `compileScopeToPolicy(scope, accessKeyId): PolicyDocument` builds one `Allow` statement per the exact `PolicyDocument` grammar in `entities/types.ts` (`Version: '2012-10-17'`, `Effect: 'Allow'`, `Principal: { AWS: accessKeyId }`): object-level actions → `Resource: arn:aws:s3:::<bucket>/<prefix>*`; bucket-level actions (`s3:ListBucket`, `s3:GetBucketLocation`, `s3:ListBucketMultipartUploads`) → `Resource: arn:aws:s3:::<bucket>`. This mirrors the ARN construction in `policy-authorization.guard.ts:41` (`arn:aws:s3:::${bucket}[/${key}]`) so effective-permissions ([TASK-3012]) and the S3 path agree byte-for-byte.
- Escalation safety: scoped keys are **default-deny** (`evaluatePolicy(..., { defaultAllow: false })` per EPIC-08 scoped-key semantics), so a compiled scope can only *grant* within its own `Allow` and cannot widen past root. Never emit an `Effect: Deny` or a `Resource: '*'` from the compiler; only enumerate the operator's buckets. Reject bucket names that are not DNS-safe (`^[a-z0-9][a-z0-9.-]{1,62}$`) to avoid smuggling glob metacharacters (`*`, `?`) that `globMatches` in `policy-evaluator.ts` would over-expand.
- DoS bounds: `buckets` ≤ 20, `prefix` ≤ 1024 bytes, `actions` from a closed enum — a scope can't produce an unbounded statement set. The prefix is a data value, not a filesystem path, but bound it like the 255-byte segment discipline in `storage/key-codec.ts` to keep compiled ARNs small.
- `role: 'root'` keys have `scope = null` and stay unrestricted (`defaultAllow: true`); the admin API must reject a `scope` on a create that would also be `role: 'root'` — v1 `create` hard-codes `role: 'root'` (`keys-admin.controller.ts:62`); a scoped create sets `role: 'scoped'` (introduced by [STORY-1000]). If `scope` is present, pass `role: 'scoped'`; if absent, `role: 'root'` as today.
- Response projection: `scope` is echoed as the compiled `PolicyDocument | null` (not the shorthand) so the console and effective-permissions render exactly what is enforced.

## Acceptance criteria
- [ ] `nx test nestjs --testPathPattern=scope` passes: `compileScopeToPolicy({ buckets:['tenant-a'], prefix:'uploads/' }, 'AKIA…')` yields an `Allow` on `arn:aws:s3:::tenant-a/uploads/*` (+ the bucket ARN for `s3:ListBucket`) with `Principal.AWS` = the key id.
- [ ] Create with `scope` persists it and sets `role: 'scoped'`; create without `scope` is unchanged (`role: 'root'`, `scope: null`).
- [ ] Validation rejects 21 buckets, a 1025-byte prefix, a non-DNS bucket name, and an action outside the enum with a 400 (nestjs-zod).
- [ ] `GET /api/admin/keys` and the create/rotate responses include `scope`.

## Test obligations
- Covered by [TEST-1001] (scope compilation, validation bounds, and the create-with-scope round-trip).

## Dependencies
- Blocked by: [STORY-1000] (`AccessKey.scope` column, `role: 'scoped'`, `defaultAllow: false` for scoped keys on the S3 path).
