---
id: TASK-3004
title: Extend the evaluator with StringLike s3:prefix for ListBucket scoping
story: STORY-1000
status: backlog
type: implementation
size: S
---

## Description

Close the enumeration leak for prefix-scoped keys. A prefix scope grants
`s3:ListBucket` on the bucket ARN (there is no per-key ARN for a listing), so
without a prefix constraint a tenant key could `ListObjectsV2` the whole bucket and
read every key name. Teach the evaluator the one condition operator AWS uses for
this — `StringLike` on `s3:prefix` — and feed the request's `prefix` query into
the evaluation context, matching the compiled scope statement from TASK-3000.

## Files to create / modify

- `libs/nestjs/src/lib/s3/authz/policy-evaluator.ts` — modify (`PolicyEvaluationContext`
  gains `prefix?: string`; `evalConditionOperator` handles
  `StringLike`/`StringNotLike` `s3:prefix`)
- `libs/nestjs/src/lib/s3/authz/policy-evaluator.spec.ts` — modify (new cases)
- `libs/nestjs/src/lib/s3/authz/policy-authorization.guard.ts` — modify (populate
  `prefix` from `req.query.prefix` for ListBucket-class ops)

## Implementation notes

- Add to `PolicyEvaluationContext`: `prefix?: string` — the S3 request key prefix
  (from `?prefix=` on ListObjects/V2/Versions). Default `''` when absent.
- Extend `evalConditionOperator` with, mirroring the existing `return 'unknown'`
  fail-closed contract:
  ```ts
  if (operator === 'StringLike' && key === 's3:prefix') {
    return anyGlobMatches(values, ctx.prefix ?? '');
  }
  if (operator === 'StringNotLike' && key === 's3:prefix') {
    return !anyGlobMatches(values, ctx.prefix ?? '');
  }
  ```
  Reuse the existing private `globMatches`/`anyGlobMatches` (IAM `*`/`?` glob,
  anchored full match) — no new matcher. Keep the unknown-operator branch intact so
  every other operator still fails closed (Deny → satisfied, Allow → unsatisfied).
- The compiled scope (TASK-3000) emits `StringLike s3:prefix: ['<prefix>*',
  '<prefix>']`, so a request with `prefix=tenant-a/2024/` matches, `prefix=''` or
  `prefix=other/` does not → the `Allow` on the bucket ARN is withheld → with
  `defaultAllow:false` the scoped key is denied the list. An unprefixed
  `ListObjectsV2` from a prefix-scoped key is therefore correctly rejected.
- Guard change: only populate `ctx.prefix` for listing operations
  (`ListObjects`, `ListObjectsV2`, `ListObjectVersions`) so the condition is inert
  for object ops. Read from `req.query.prefix` (string | undefined).
- Security/DoS: `globMatches` compiles a small anchored regex from a bounded
  (TASK-3000-capped) pattern; no catastrophic-backtracking construct is introduced
  (only `.*` / `.` substitutions on escaped literals). This does not regress the
  two EPIC-08 operators (`Bool aws:SecureTransport`, `IpAddress aws:SourceIp`).

## Acceptance criteria

- [ ] `evaluatePolicy` allows a `StringLike s3:prefix` statement when
      `ctx.prefix` matches and denies (Allow withheld) when it does not.
- [ ] An unknown operator still fails closed exactly as before (existing specs green).
- [ ] A prefix-scoped key `ListObjectsV2` with the matching `prefix=` is allowed and
      with a missing/non-matching prefix is denied (403), via the guard.
- [ ] `nx test nestjs --testPathPattern="policy-evaluator"` passes with no change to
      the SecureTransport / SourceIp cases.

## Test obligations

- Unit: covered by [TEST-1000] (evaluator StringLike s3:prefix matrix)
- E2E: covered by [TEST-1000] (SDK ListObjectsV2 with/without prefix)
- Conformance: N/A

## Dependencies

- Blocked by: [STORY-0702] (evaluator); consumed by [TASK-3002]
