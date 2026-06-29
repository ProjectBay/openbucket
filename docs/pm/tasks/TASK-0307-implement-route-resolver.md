---
id: TASK-0307
title: Implement RouteResolver with BUCKET_NAME_RE validation
story: STORY-0101
status: done
type: implementation
size: S
---

## Description
Implement `RouteResolver.resolve(req)` per §2.2. The resolver validates `req.openbucket.kind === 's3'`, validates the bucket name against `BUCKET_NAME_RE`, rejects `..`, and returns `{ bucket, key }` with `key = ob.keyRaw ?? ''`.

## Files to create / modify
- `apps/backend/src/s3/routing/route-resolver.ts` — new

## Implementation notes
- Verbatim from §2.2 (lines 1269–1306):
  - `const BUCKET_NAME_RE = /^[a-z0-9][a-z0-9.\-]{1,61}[a-z0-9]$/;`
  - `@Injectable() export class RouteResolver { resolve(req: Request): { bucket: string; key: string } { ... } }`
  - Throws `InvalidBucketNameError('')` when `!ob || ob.kind !== 's3'` or `bucket === null`.
  - Throws `InvalidBucketNameError(bucket)` when `!BUCKET_NAME_RE.test(bucket) || bucket.includes('..')`.
  - Returns `{ bucket, key: ob.keyRaw ?? '' }`.
- Invariants the classifier guarantees (§2.2 lines 1309–1318):
  1. Path style: `host` is the configured endpoint; first path segment is the bucket; rest is the key.
  2. Virtual-host style: `host` matches `<bucket>.<endpoint>`; full path minus leading `/` is the key.
  3. Leading/trailing whitespace stripped from bucket; key percent-decoded once.

## Acceptance criteria
- [ ] `nx test backend --testPathPattern=route-resolver.spec.ts` passes valid+invalid name cases.
- [ ] Both addressing styles produce identical `(bucket, key)` for equivalent URLs (tested by fixture).

## Test obligations
- Unit: covered by [TEST-0101]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0306], [STORY-0105]

## References
- `docs/WHITEPAPER.md` §2.2 (lines 1243–1323)
