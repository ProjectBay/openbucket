---
id: TASK-2120
title: Implement bucket-policy evaluation on the S3 request path
story: STORY-0702
status: ready
type: implementation
size: L
---

## Description
Remediate audit finding [11] (CWE-862, Missing Authorization). Bucket policies are stored and echoed but never evaluated: `SigV4Guard.canActivate` authenticates the signature and stamps `req.openbucket.accessKeyId` (`sigv4.guard.ts:98`), then returns — no controller, guard, interceptor, or service ever reads `bucket.policy` on the request path. `PutBucketPolicy` returns 200 and `GetBucketPolicy` echoes the exact document, giving the operator false assurance that `Deny` statements and `Condition` clauses (`aws:SecureTransport`, `aws:SourceIp`) are enforced when they are silent no-ops. This Task implements a real policy evaluator invoked after signature verification and enforces it on every S3 controller.

## Files to create / modify
- `libs/nestjs/src/lib/s3/authz/policy-evaluator.ts` — new. Pure function `evaluatePolicy(policy, ctx)` implementing action/resource/principal/condition matching with deny-overrides.
- `libs/nestjs/src/lib/s3/authz/operation-action.ts` — new. Map `req.openbucket.operation` (e.g. `GetObject`, `DeleteObject`, `PutObject`, `ListObjectsV2`) to its `s3:*` action name.
- `libs/nestjs/src/lib/s3/authz/policy-authorization.guard.ts` — new. `PolicyAuthorizationGuard` (`CanActivate`) that runs after `SigV4Guard`, loads `bucket.policy` via `BucketService.getPolicyDoc`, and throws `AccessDeniedError` on an explicit deny / unmet condition.
- `libs/nestjs/src/lib/s3/controllers/object.controller.ts` — modify. Add `PolicyAuthorizationGuard` to `@UseGuards(...)` after `SigV4Guard` (:40).
- `libs/nestjs/src/lib/s3/controllers/bucket.controller.ts` — modify. Same (:31).
- `libs/nestjs/src/lib/s3/controllers/multipart.controller.ts` — modify. Same (:18).
- `libs/nestjs/src/lib/s3/controllers/service.controller.ts` — modify. Same (:18) — service-level ops (ListBuckets) have no bucket policy, so the guard no-ops when `req.openbucket.bucket` is unset.
- `libs/nestjs/src/lib/s3/authz/policy-evaluator.spec.ts` — new. Unit spec (see [TEST-0702]).

## Implementation notes
- The vulnerability, verbatim from finding [11]: "`SigV4Guard.canActivate` verifies the signature and stamps `req.openbucket.accessKeyId` (sigv4.guard.ts:98) and returns; no controller or service ever loads or evaluates the bucket policy." The `PolicyDocument` type already models the full IAM grammar (`types.ts:68–78`: `Effect: 'Allow' | 'Deny'`, `Principal`, `Action`, `Resource`, `Condition?`) but grep finds zero references to `Effect`/`Statement` on the request path — provably no evaluator exists.
- `BucketService.putPolicy` (`bucket.service.ts:497`) and `setPolicy` (`:746`) persist the JSON verbatim (validated only as a non-array object at `:506`, not against the IAM shape); `getPolicyDoc` (`:739`) returns the stored `PolicyDocument`. The evaluator consumes `getPolicyDoc`; do not re-parse.
- Intended fix, per finding [11] fix note (longer-term track a): "implement a real evaluator on the request path — a guard/interceptor after SigV4 that loads the bucket policy, matches Action/Resource against the resolved operation and key, applies explicit-Deny-overrides-Allow, and enforces the Condition operators actually advertised (IpAddress/aws:SourceIp, Bool/aws:SecureTransport)."
- Evaluation algorithm: (1) if no `bucket.policy`, default-allow (single root credential — preserves current behavior). (2) Resolve the requested action from `req.openbucket.operation` via `operation-action.ts` and the resource ARN `arn:aws:s3:::<bucket>[/<key>]`. (3) Iterate `policy.Statement`: a statement matches when `Action` (glob, e.g. `s3:*`, `s3:Get*`), `Resource` (glob incl. `/*`), and `Principal` (`*` in the single-root model) all match AND every `Condition` operator holds. (4) Apply **deny-overrides**: any matching `Effect: Deny` → throw `AccessDeniedError`; else if a matching `Allow` or no policy statement targets the action → allow; an explicit-deny always wins.
- Condition operators to support (advertised set only): `Bool` with key `aws:SecureTransport` (derive from `req.secure` / `X-Forwarded-Proto`, respecting the app's `trust proxy 'loopback'` setting) and `IpAddress`/`NotIpAddress` with key `aws:SourceIp` (CIDR match against `req.ip`). Unknown condition operators/keys must fail **closed** for a `Deny` statement (treat as matched) and not silently allow.
- Bind after SigV4 so `req.openbucket.accessKeyId`, `.bucket`, `.key`, and `.operation` are populated (`operation` is set by `@S3Operation` via the OperationDispatcherInterceptor; see `request.d.ts` `OpenBucketRequestContext`).
- CWE: **CWE-862 Missing Authorization**. Note: the single-tenant/root-only model means this is a missing *compensating* control (network/TLS/action-scoped `Deny`), not cross-tenant IDOR — do not over-claim; the primary SigV4 credential check already works.

## Acceptance criteria
- [ ] `nx test nestjs --testPathPattern=policy-evaluator` passes: `evaluatePolicy` returns deny for a matching `Deny` statement even when an `Allow` also matches (deny-overrides).
- [ ] E2E: a bucket with a policy `Deny s3:GetObject on arn:aws:s3:::b/*` returns `403 AccessDenied` for `GET /b/key`; deleting the policy returns `200` — asserted in [TEST-0702].
- [ ] E2E: a `Deny` gated by `Bool aws:SecureTransport=false` blocks a plain-HTTP GET and allows the same GET over TLS; a `Deny` gated by `IpAddress aws:SourceIp` outside the allowed CIDR blocks the request.
- [ ] No regression: the existing S3 CRUD/multipart e2e and conformance suites pass unchanged for buckets with no policy.

## Test obligations
- Unit: covered by [TEST-0702] (evaluator matching, deny-overrides, condition operators, action mapping).
- E2E: covered by [TEST-0702] (guard wired into the controller tree; Deny blocks GET).
- Conformance: N/A — bucket-policy evaluation is not part of the existing aws-cli conformance matrix; regression-guarded by not breaking [TEST-0119]/[TEST-0120].

## Dependencies
- Blocked by: [STORY-0700], [TASK-2100] (land the critical fail-open admin-auth fix first), [STORY-0111] (policy storage `putPolicy`/`getPolicyDoc`), [STORY-0103] (`SigV4Guard`, `req.openbucket.accessKeyId`), [STORY-0100] (`@S3Operation`/`req.openbucket.operation`).

## References
- White-box security audit, 2026-07-04 — finding [11] (CWE-862).
- `libs/nestjs/src/lib/s3/sigv4/sigv4.guard.ts:98`, `libs/nestjs/src/lib/domain/buckets/bucket.service.ts:489,497,739,746`, `libs/nestjs/src/lib/persistence/entities/types.ts:68–78`, `libs/nestjs/src/lib/s3/controllers/{object,bucket,multipart,service}.controller.ts`
- `docs/pm/S11-DECISIONS.md` #6 (deferral being closed), `docs/ARCHITECTURE.md` §206, §216
