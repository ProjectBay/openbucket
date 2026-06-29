---
id: STORY-0101
title: RouteResolver for virtual-host vs path-style routing
epic: EPIC-02
status: done
size: S
risk: low
---

## User story
As a developer, I want a single `RouteResolver` that returns the canonical `(bucket, key)` pair from `req.openbucket`, so that controllers work identically under path-style and virtual-host-style addressing without parsing URLs themselves.

## Description
Realize §2.2 of the white paper. The classifier middleware (owned by EPIC-01) attaches `req.openbucket` with the pre-classified `kind`, `style`, `bucket`, and `keyRaw`. `RouteResolver.resolve()` validates the bucket name against the canonical regex, rejects `..` traversal, and surfaces the `(bucket, key)` pair. Every controller in STORY-0100 consumes this resolver instead of reading URL segments directly.

## Acceptance criteria
- [x] `RouteResolver.resolve(req)` returns `{ bucket, key }` per §2.2; key precedence `keyRaw` > `key` > `''` (the M0 classifier sets `key`; the §2.2-aware classifier in STORY-0103/SigV4 will set `keyRaw`).
- [x] Throws `InvalidBucketNameError` for buckets failing `BUCKET_NAME_RE` or containing `..` (TEST-0101 cases 3–6).
- [x] Throws `InvalidBucketNameError('')` for `kind !== 's3'` or missing bucket (cases 1, 2).
- [x] Path-style and virtual-host-style produce identical `(bucket, key)` (case 7); empty/null `keyRaw` returns `key = ''` (case 8).

## Tasks
- [TASK-0307] Implement RouteResolver with BUCKET_NAME_RE validation

## Test plan
- [TEST-0101] RouteResolver unit

## Implementation notes
- `InvalidBucketNameError` (S3 code `InvalidBucketName`, HTTP 400) was added
  to `s3/errors/s3-error.ts` here rather than waiting for STORY-0105 — the
  resolver needs it. The full §2.6 taxonomy still lands in 0105; this is a
  single forward-declared entry to keep the resolver self-contained.
- `OpenBucketRequestContext` was extended with `keyRaw?: string`. The M0
  classifier still sets `key` (percent-decoded); the SigV4 work in STORY-0103
  will set `keyRaw` (raw, for canonicalization). The resolver prefers
  `keyRaw` when present so the SigV4 transition is non-breaking.
- The §2.2 reference signature uses `bucket: string | null`; our M0
  classifier stores `bucket: string | undefined`. The resolver treats both
  as missing (`!bucket`), so the contract is satisfied either way.
- TEST-0100's `fakeReq` was updated from `bucket: 'b'` to `bucket: 'bkt'`
  (3-char minimum per `BUCKET_NAME_RE`).

## Dependencies
- Blocks: [STORY-0100], [STORY-0103], [STORY-0117]
- Blocked by: [EPIC-01], [STORY-0105]

## References
- `docs/WHITEPAPER.md` §2.2 (lines 1243–1323)
- Interfaces consumed: `req.openbucket` (defined in STORY-0100), `InvalidBucketNameError` (defined in STORY-0105)
- Interfaces produced: `RouteResolver`
