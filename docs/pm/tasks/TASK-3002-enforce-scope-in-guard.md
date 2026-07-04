---
id: TASK-3002
title: Enforce the key scope in PolicyAuthorizationGuard and request context
story: STORY-1000
status: backlog
type: implementation
size: L
---

## Description

Wire the scope through the request lifecycle and enforce it. Extend the request
context with the resolved key scope and a root flag, have `SigV4Guard` stamp them
from the `getSecret` result, and change `PolicyAuthorizationGuard` to run the
key's scope through `evaluatePolicy` with **implicit deny** (`defaultAllow: false`)
alongside the existing bucket-policy evaluation. Root keys are never scope-checked
and keep the current `defaultAllow: true` behaviour, preserving the single-root
deployment exactly.

## Files to create / modify

- `libs/nestjs/src/lib/common/types/request.d.ts` — modify (add
  `keyScope?: PolicyDocument | null` and `isRoot?: boolean` to
  `OpenBucketRequestContext`)
- `libs/nestjs/src/lib/s3/sigv4/key.service.ts` — modify (abstract `AccessKey`
  shape gains `isRoot: boolean` and `scopePolicy: string | null`)
- `libs/nestjs/src/lib/s3/s3.module.ts` — modify (the `useFactory` adapter maps
  `KeyLookupResult.isRoot` / `.scopePolicy` onto the SigV4 `AccessKey`)
- `libs/nestjs/src/lib/s3/sigv4/sigv4.guard.ts` — modify (stamp `req.openbucket.
  isRoot` / `.keyScope` in both `checkHeader` and the presigned branch)
- `libs/nestjs/src/lib/s3/sigv4/presigned.ts` — modify (return/stamp the same
  fields resolved during presigned verification)
- `libs/nestjs/src/lib/s3/authz/policy-authorization.guard.ts` — modify (add the
  scope evaluation)
- `libs/nestjs/src/lib/s3/authz/policy-authorization.guard.spec.ts` — new/modify

## Implementation notes

- `SigV4Guard.checkHeader` already calls `this.keys.getSecret(parsed.accessKeyId)`.
  After a verified signature, set:
  `req.openbucket.isRoot = key.isRoot;`
  `req.openbucket.keyScope = key.scopePolicy ? parseScopePolicy(key.scopePolicy) : null;`
  (`parseScopePolicy` from TASK-3000 — fail-closed on corruption). Do the same in
  `verifyPresigned` so presigned URLs are scoped too (do not regress STORY-0104).
- `PolicyAuthorizationGuard.canActivate`, after computing `action` and `resource`
  and evaluating the bucket policy: if `req.openbucket.isRoot !== true` and a
  `keyScope` is present, run a **second** evaluation:
  ```ts
  const scopeDecision = evaluatePolicy(
    req.openbucket.keyScope,
    { action, resource, principal: req.openbucket.accessKeyId ?? '*',
      secureTransport: req.secure === true, sourceIp: req.ip ?? '',
      prefix: /* ListBucket query prefix, TASK-3004 */ },
    { defaultAllow: false },  // scoped keys are implicit-deny
  );
  if (scopeDecision === 'deny') throw new AccessDeniedError('Access Denied: out of key scope');
  ```
  Effective decision = bucket policy AND scope: an explicit bucket `Deny` still
  overrides (unchanged); a scope that does not `Allow` the action/resource denies
  even when the bucket has no policy. Order the scope check so a bucket-policy
  `Deny` is not masked.
- Important subtlety: today the guard early-returns `true` when the bucket has no
  policy (`tryGetPolicyDoc` → null). For a scoped key that early-return must NOT
  skip the scope check — restructure so bucket-policy absence still falls through
  to scope evaluation when `!isRoot`.
- A scoped key with no `bucket` on the request (service-scope op, e.g.
  `ListBuckets`/`s3:ListAllMyBuckets`) must be denied unless its scope explicitly
  allows it — a tenant key should not enumerate all buckets. Handle the
  `bucket === undefined` branch for non-root before the current `return true`.
- The evaluator and `operationToAction` are reused unchanged; principal is the
  SigV4-resolved `accessKeyId`, so compiled scope statements can safely use
  `Principal: '*'`.
- Security: this closes CWE-862 for sub-keys; the presigned branch is the easy
  regression to miss — assert it in tests. No timing surface added (evaluation is
  post-auth).

## Acceptance criteria

- [ ] A scoped key is denied (403) for an in-bucket key outside its prefix and
      allowed inside it; root is unaffected.
- [ ] Bucket-policy `Deny` overrides a scope `Allow`; scope `deny`/no-allow blocks
      even when the bucket has no policy.
- [ ] A scoped key calling `ListBuckets` is denied unless its scope allows
      `s3:ListAllMyBuckets`.
- [ ] Presigned requests from a scoped key are enforced identically to header-signed.
- [ ] Root path produces byte-identical behaviour to pre-change (regression suite).
- [ ] `nx test nestjs --testPathPattern="policy-authorization"` passes.

## Test obligations

- Unit: covered by [TEST-1000] (guard matrix: root vs scoped × in/out of scope)
- E2E: covered by [TEST-1000] (SDK PUT/GET/LIST + presigned)
- Conformance: covered by [TEST-1000] (root-path no-regression)

## Dependencies

- Blocked by: [TASK-3000], [TASK-3001], [TASK-3004]
